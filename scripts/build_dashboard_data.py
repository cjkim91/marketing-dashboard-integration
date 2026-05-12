#!/usr/bin/env python3
"""
Build normalized dashboard data from GA4 and Meta Marketing API.

The generated JSON is intentionally excluded from git by default because it may
contain client performance data.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fetch_ga4_data import _build_oauth_credentials, _load_client, _parse_metric_value
from fetch_meta_data import (
    calc_derived,
    extract_action_value,
    extract_monetary_value,
    load_config,
    paginate,
)


# ── GA4 report definitions ────────────────────────────────────────────────────

GA4_DIMENSIONS = ["date", "sessionSource", "sessionMedium", "sessionCampaignName"]
GA4_TRAFFIC_METRICS = [
    "sessions", "totalUsers", "newUsers", "totalRevenue",
    "bounceRate", "averageSessionDuration", "engagementRate",
]
GA4_EVENT_METRICS = ["eventCount", "totalRevenue"]

GA4_DEVICE_DIMENSIONS = ["date", "deviceCategory"]
GA4_DEVICE_METRICS = [
    "sessions", "totalUsers", "newUsers", "totalRevenue",
    "bounceRate", "averageSessionDuration",
]

GA4_LANDING_DIMENSIONS = ["date", "landingPage"]
GA4_LANDING_METRICS = [
    "sessions", "totalUsers", "bounceRate", "averageSessionDuration", "totalRevenue",
]


# ── Date helpers (always rolls through yesterday KST) ─────────────────────────

KST = ZoneInfo("Asia/Seoul")


def kst_yesterday() -> str:
    return (datetime.now(KST).date() - timedelta(days=1)).isoformat()


def kst_days_ago(days: int) -> str:
    return (datetime.now(KST).date() - timedelta(days=days)).isoformat()


# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build marketing dashboard JSON.")
    parser.add_argument(
        "--since",
        default=None,
        help="Start date YYYY-MM-DD. Defaults to 90 days before yesterday (KST).",
    )
    parser.add_argument(
        "--until",
        default=None,
        help="End date YYYY-MM-DD. Defaults to yesterday (KST) so the dashboard "
             "always reflects through the previous full day.",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=90,
        help="When --since is omitted, fetch this many days ending at --until.",
    )
    parser.add_argument("--output", default="public/data/dashboard.json")
    parser.add_argument("--ga4-property-id", default=os.environ.get("GA4_PROPERTY_ID", "311666548"))
    parser.add_argument("--skip-ga4", action="store_true")
    parser.add_argument("--skip-meta", action="store_true")
    args = parser.parse_args()

    if not args.until:
        args.until = kst_yesterday()
    if not args.since:
        args.since = (
            datetime.fromisoformat(args.until).date() - timedelta(days=args.lookback_days - 1)
        ).isoformat()
    return args


# ── GA4 helpers ───────────────────────────────────────────────────────────────

def display_date(value: str) -> str:
    if "-" in value:
        return value
    return datetime.strptime(value, "%Y%m%d").strftime("%Y-%m-%d")


def key_from_row(row: dict[str, Any]) -> tuple[str, str, str, str]:
    return (
        display_date(str(row.get("date", ""))),
        str(row.get("sessionSource", "(not set)")),
        str(row.get("sessionMedium", "(not set)")),
        str(row.get("sessionCampaignName", "(not set)")),
    )


def device_key(row: dict[str, Any]) -> tuple[str, str]:
    return (display_date(str(row.get("date", ""))), str(row.get("deviceCategory", "unknown")))


def landing_key(row: dict[str, Any]) -> tuple[str, str]:
    return (display_date(str(row.get("date", ""))), str(row.get("landingPage", "(not set)")))


def channel_name(source: str, medium: str) -> str:
    source_l = source.lower()
    medium_l = medium.lower()
    if source == "(direct)" or medium == "(none)":
        return "Direct"
    if "facebook" in source_l or source_l in {"fb", "ig", "instagram"} or medium_l in {"ads", "paid"}:
        return "Paid Social"
    if medium_l in {"cpc", "ppc", "paidsearch", "pmax"}:
        return "Paid Search"
    if "organic" in medium_l:
        return "Organic"
    if medium_l in {"email", "kakao_bms"}:
        return "CRM"
    if medium_l == "affiliate":
        return "Affiliate"
    if medium_l == "referral":
        return "Referral"
    return "Other"


def run_ga4_report(
    property_id: str,
    since: str,
    until: str,
    dimensions: list[str],
    metrics: list[str],
    event_name: str | None = None,
    limit: int = 100000,
) -> list[dict[str, Any]]:
    (
        BetaAnalyticsDataClient,
        DateRange,
        Dimension,
        Metric,
        RunReportRequest,
        Credentials,
    ) = _load_client()
    from google.analytics.data_v1beta.types import Filter, FilterExpression

    credentials = _build_oauth_credentials(Credentials)
    client = (
        BetaAnalyticsDataClient(credentials=credentials)
        if credentials
        else BetaAnalyticsDataClient()
    )
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=since, end_date=until)],
        dimensions=[Dimension(name=name) for name in dimensions],
        metrics=[Metric(name=name) for name in metrics],
        limit=limit,
    )
    if event_name:
        request.dimension_filter = FilterExpression(
            filter=Filter(
                field_name="eventName",
                string_filter=Filter.StringFilter(
                    match_type=Filter.StringFilter.MatchType.EXACT,
                    value=event_name,
                ),
            )
        )
    response = client.run_report(request)
    rows: list[dict[str, Any]] = []
    for row in response.rows:
        item: dict[str, Any] = {}
        for idx, dimension in enumerate(dimensions):
            item[dimension] = row.dimension_values[idx].value
        for idx, metric in enumerate(metrics):
            item[metric] = _parse_metric_value(row.metric_values[idx].value)
        rows.append(item)
    return rows


def _bounce_pct(row: dict[str, Any]) -> float:
    """GA4 bounceRate is returned as 0–1 decimal; convert to 0–100 %."""
    return round(float(row.get("bounceRate", 0) or 0) * 100, 2)


def _avg_duration(row: dict[str, Any]) -> float:
    return round(float(row.get("averageSessionDuration", 0) or 0), 1)


def empty_ga4_row(date_value: str, source: str, medium: str, campaign: str) -> dict[str, Any]:
    return {
        "date": date_value,
        "source": source,
        "medium": medium,
        "campaign": campaign,
        "channel": channel_name(source, medium),
        "sessions": 0,
        "users": 0,
        "new_users": 0,
        "detail_views": 0,
        "cart_adds": 0,
        "checkout_starts": 0,
        "purchases": 0,
        "revenue": 0.0,
        "bounce_rate": 0.0,
        "avg_session_duration": 0.0,
        "engagement_rate": 0.0,
        "bounce_sessions": 0.0,
        "total_duration": 0.0,
    }


def add_ga4_rates(row: dict[str, Any]) -> None:
    sessions = row.get("sessions", 0)
    details = row.get("detail_views", 0)
    cart_adds = row.get("cart_adds", 0)
    checkouts = row.get("checkout_starts", 0)
    purchases = row.get("purchases", 0)
    row["detail_view_rate"] = round(details / sessions * 100, 2) if sessions else 0
    row["cart_rate"] = round(cart_adds / sessions * 100, 2) if sessions else 0
    row["checkout_rate"] = round(checkouts / sessions * 100, 2) if sessions else 0
    row["purchase_rate"] = round(purchases / sessions * 100, 2) if sessions else 0
    row["detail_to_purchase_rate"] = round(purchases / details * 100, 2) if details else 0
    row["checkout_to_purchase_rate"] = round(purchases / checkouts * 100, 2) if checkouts else 0
    row["aov"] = round(row.get("revenue", 0) / purchases, 2) if purchases else 0


# ── GA4 main build ────────────────────────────────────────────────────────────

def build_ga4(property_id: str, since: str, until: str) -> dict[str, Any]:
    print("  GA4: fetching traffic rows …")
    traffic_rows = run_ga4_report(property_id, since, until, GA4_DIMENSIONS, GA4_TRAFFIC_METRICS)

    print("  GA4: fetching view_item events …")
    detail_rows = run_ga4_report(
        property_id, since, until, GA4_DIMENSIONS, GA4_EVENT_METRICS, event_name="view_item"
    )

    print("  GA4: fetching add_to_cart events …")
    cart_rows = run_ga4_report(
        property_id, since, until, GA4_DIMENSIONS, GA4_EVENT_METRICS, event_name="add_to_cart"
    )

    print("  GA4: fetching begin_checkout events …")
    checkout_rows = run_ga4_report(
        property_id, since, until, GA4_DIMENSIONS, GA4_EVENT_METRICS, event_name="begin_checkout"
    )

    print("  GA4: fetching purchase events …")
    purchase_rows = run_ga4_report(
        property_id, since, until, GA4_DIMENSIONS, GA4_EVENT_METRICS, event_name="purchase"
    )

    print("  GA4: fetching device breakdown …")
    device_traffic = run_ga4_report(property_id, since, until, GA4_DEVICE_DIMENSIONS, GA4_DEVICE_METRICS)
    device_detail = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["eventCount"], event_name="view_item"
    )
    device_cart = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["eventCount"], event_name="add_to_cart"
    )
    device_checkout = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["eventCount"], event_name="begin_checkout"
    )
    device_purchase = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["eventCount", "totalRevenue"],
        event_name="purchase"
    )

    print("  GA4: fetching landing page data …")
    landing_traffic = run_ga4_report(
        property_id, since, until, GA4_LANDING_DIMENSIONS, GA4_LANDING_METRICS, limit=2000
    )
    landing_purchase = run_ga4_report(
        property_id, since, until, GA4_LANDING_DIMENSIONS, ["eventCount", "totalRevenue"],
        event_name="purchase", limit=2000,
    )

    # ── Merge main rows ───────────────────────────────────────────────────────
    merged: dict[tuple, dict[str, Any]] = {}

    for row in traffic_rows:
        key = key_from_row(row)
        date_value, source, medium, campaign = key
        br = _bounce_pct(row)
        dur = _avg_duration(row)
        sessions = int(row.get("sessions", 0) or 0)
        merged[key] = {
            "date": date_value,
            "source": source,
            "medium": medium,
            "campaign": campaign,
            "channel": channel_name(source, medium),
            "sessions": sessions,
            "users": int(row.get("totalUsers", 0) or 0),
            "new_users": int(row.get("newUsers", 0) or 0),
            "detail_views": 0,
            "checkout_starts": 0,
            "purchases": 0,
            "revenue": float(row.get("totalRevenue", 0) or 0),
            "bounce_rate": br,
            "avg_session_duration": dur,
            "engagement_rate": round(float(row.get("engagementRate", 0) or 0) * 100, 2),
            "bounce_sessions": round(br * sessions / 100, 2),
            "total_duration": round(dur * sessions, 2),
        }

    for row in detail_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["detail_views"] += int(row.get("eventCount", 0) or 0)

    for row in cart_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["cart_adds"] += int(row.get("eventCount", 0) or 0)

    for row in checkout_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["checkout_starts"] += int(row.get("eventCount", 0) or 0)

    for row in purchase_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["purchases"] += int(row.get("eventCount", 0) or 0)
        purchase_revenue = float(row.get("totalRevenue", 0) or 0)
        if purchase_revenue:
            merged[key]["revenue"] = purchase_revenue

    rows = sorted(merged.values(), key=lambda r: (r["date"], -r["sessions"]))
    for row in rows:
        add_ga4_rates(row)

    has_checkout = any(r.get("checkout_starts", 0) > 0 for r in rows)
    has_cart = any(r.get("cart_adds", 0) > 0 for r in rows)

    # ── Device rows ───────────────────────────────────────────────────────────
    dev_merged: dict[tuple, dict[str, Any]] = {}
    for row in device_traffic:
        key = device_key(row)
        date_value, device = key
        br = _bounce_pct(row)
        dur = _avg_duration(row)
        sessions = int(row.get("sessions", 0) or 0)
        dev_merged[key] = {
            "date": date_value,
            "device_category": device,
            "sessions": sessions,
            "users": int(row.get("totalUsers", 0) or 0),
            "new_users": int(row.get("newUsers", 0) or 0),
            "detail_views": 0,
            "cart_adds": 0,
            "checkout_starts": 0,
            "purchases": 0,
            "revenue": float(row.get("totalRevenue", 0) or 0),
            "bounce_rate": br,
            "avg_session_duration": dur,
            "bounce_sessions": round(br * sessions / 100, 2),
            "total_duration": round(dur * sessions, 2),
        }
    for row in device_detail:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["detail_views"] += int(row.get("eventCount", 0) or 0)
    for row in device_cart:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["cart_adds"] += int(row.get("eventCount", 0) or 0)
    for row in device_checkout:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["checkout_starts"] += int(row.get("eventCount", 0) or 0)
    for row in device_purchase:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["purchases"] += int(row.get("eventCount", 0) or 0)
            pr = float(row.get("totalRevenue", 0) or 0)
            if pr:
                dev_merged[key]["revenue"] = pr

    device_rows_out = sorted(dev_merged.values(), key=lambda r: (r["date"], -r["sessions"]))
    for row in device_rows_out:
        add_ga4_rates(row)

    # ── Landing page rows ─────────────────────────────────────────────────────
    land_merged: dict[tuple, dict[str, Any]] = {}
    for row in landing_traffic:
        key = landing_key(row)
        date_value, lp = key
        br = _bounce_pct(row)
        dur = _avg_duration(row)
        sessions = int(row.get("sessions", 0) or 0)
        land_merged[key] = {
            "date": date_value,
            "landing_page": lp,
            "sessions": sessions,
            "users": int(row.get("totalUsers", 0) or 0),
            "purchases": 0,
            "revenue": float(row.get("totalRevenue", 0) or 0),
            "bounce_rate": br,
            "avg_session_duration": dur,
            "bounce_sessions": round(br * sessions / 100, 2),
            "total_duration": round(dur * sessions, 2),
        }
    for row in landing_purchase:
        key = landing_key(row)
        if key in land_merged:
            land_merged[key]["purchases"] += int(row.get("eventCount", 0) or 0)
            pr = float(row.get("totalRevenue", 0) or 0)
            if pr:
                land_merged[key]["revenue"] = pr

    landing_rows_out = sorted(land_merged.values(), key=lambda r: (r["date"], -r["sessions"]))
    for row in landing_rows_out:
        sessions = row.get("sessions", 0)
        purchases = row.get("purchases", 0)
        row["purchase_rate"] = round(purchases / sessions * 100, 2) if sessions else 0

    return {
        "property_id": property_id,
        "has_checkout": has_checkout,
        "has_cart": has_cart,
        "funnel_definition": {
            "traffic": "sessions",
            "detail_view": "GA4 eventName=view_item",
            "cart": "GA4 eventName=add_to_cart",
            "checkout": "GA4 eventName=begin_checkout",
            "purchase": "GA4 eventName=purchase",
        },
        "rows": rows,
        "device_rows": device_rows_out,
        "landing_rows": landing_rows_out,
    }


# ── Meta build ────────────────────────────────────────────────────────────────

def meta_api_rows(cfg: dict[str, Any], since: str, until: str, level: str) -> list[dict[str, Any]]:
    fields = [
        "date_start", "date_stop",
        "campaign_id", "campaign_name",
        "impressions", "reach", "spend", "clicks",
        "actions", "action_values",
    ]
    if level in {"adset", "ad"}:
        fields.extend(["adset_id", "adset_name", "frequency"])
    if level == "ad":
        fields.extend(["ad_id", "ad_name"])

    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": ",".join(fields),
        "level": level,
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 5000,
        "access_token": cfg["token"],
        "action_report_time": "impression",
    }
    return paginate(url, params)


def meta_placement_rows(cfg: dict[str, Any], since: str, until: str) -> list[dict[str, Any]]:
    fields = [
        "date_start", "date_stop",
        "campaign_id", "campaign_name",
        "adset_id", "adset_name",
        "ad_id", "ad_name",
        "impressions", "spend", "clicks",
        "actions", "action_values",
    ]
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": ",".join(fields),
        "level": "ad",
        "breakdowns": "publisher_platform,platform_position",
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 5000,
        "access_token": cfg["token"],
        "action_report_time": "impression",
    }
    return paginate(url, params)


def parse_meta_metrics(row: dict[str, Any]) -> dict[str, Any]:
    actions = row.get("actions", [])
    action_values = row.get("action_values", [])
    conversions = (
        extract_action_value(actions, "offsite_conversion.fb_pixel_purchase")
        + extract_action_value(actions, "offsite_conversion.fb_pixel_lead")
        + extract_action_value(actions, "lead")
        + extract_action_value(actions, "onsite_conversion.lead_grouped")
    )
    conversion_value = (
        extract_monetary_value(action_values, "offsite_conversion.fb_pixel_purchase")
        + extract_monetary_value(action_values, "offsite_conversion.fb_pixel_lead")
    )
    item: dict[str, Any] = {
        "impressions": int(row.get("impressions", 0) or 0),
        "reach": int(row.get("reach", 0) or 0),
        "clicks": int(row.get("clicks", 0) or 0),
        "spend": round(float(row.get("spend", 0) or 0), 2),
        "conversions": conversions,
        "conversion_value": round(conversion_value, 2),
        "frequency": round(float(row.get("frequency", 0) or 0), 2),
    }
    calc_derived(item)
    return item


def normalize_meta_level(rows: list[dict[str, Any]], level: str) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item: dict[str, Any] = {
            "date": row.get("date_start", ""),
            "campaign_id": row.get("campaign_id", ""),
            "campaign_name": row.get("campaign_name", ""),
        }
        if level in {"adset", "ad"}:
            item["adset_id"] = row.get("adset_id", "")
            item["adset_name"] = row.get("adset_name", "")
        if level == "ad":
            item["ad_id"] = row.get("ad_id", "")
            item["ad_name"] = row.get("ad_name", "")
        item.update(parse_meta_metrics(row))
        out.append(item)
    return out


def normalize_placements(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item: dict[str, Any] = {
            "date": row.get("date_start", ""),
            "campaign_id": row.get("campaign_id", ""),
            "campaign_name": row.get("campaign_name", ""),
            "adset_id": row.get("adset_id", ""),
            "adset_name": row.get("adset_name", ""),
            "ad_id": row.get("ad_id", ""),
            "ad_name": row.get("ad_name", ""),
            "publisher_platform": row.get("publisher_platform", "unknown"),
            "platform_position": row.get("platform_position", "unknown"),
        }
        item["placement"] = f"{item['publisher_platform']} / {item['platform_position']}"
        item.update(parse_meta_metrics(row))
        out.append(item)
    return out


def build_meta(since: str, until: str) -> dict[str, Any]:
    cfg = load_config()
    print("  Meta: fetching campaign insights …")
    campaigns = normalize_meta_level(meta_api_rows(cfg, since, until, "campaign"), "campaign")
    print("  Meta: fetching adset insights …")
    adsets = normalize_meta_level(meta_api_rows(cfg, since, until, "adset"), "adset")
    print("  Meta: fetching ad insights …")
    ads = normalize_meta_level(meta_api_rows(cfg, since, until, "ad"), "ad")
    print("  Meta: fetching placement breakdown …")
    placements = normalize_placements(meta_placement_rows(cfg, since, until))
    return {
        "account_id": cfg["account_id"],
        "campaigns": campaigns,
        "adsets": adsets,
        "ads": ads,
        "placements": placements,
    }


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    print(f"Building dashboard data: {args.since} → {args.until}")

    now_utc = datetime.now(timezone.utc)
    now_kst = now_utc.astimezone(KST)
    payload: dict[str, Any] = {
        "generated_at": now_utc.isoformat(),
        "generated_at_kst": now_kst.isoformat(),
        # Last fully-included calendar day in this snapshot. Front-end uses this
        # to surface "data through" freshness independent of generation time.
        "data_through": args.until,
        "expected_through": kst_yesterday(),
        "period": {"since": args.since, "until": args.until},
        "defaults": {"granularity": "day"},
    }

    if args.skip_ga4:
        payload["ga4"] = {
            "rows": [], "device_rows": [], "landing_rows": [],
            "has_checkout": False, "has_cart": False,
        }
    else:
        print("GA4:")
        payload["ga4"] = build_ga4(args.ga4_property_id, args.since, args.until)
        print(
            f"  → {len(payload['ga4']['rows'])} rows, "
            f"{len(payload['ga4']['device_rows'])} device rows, "
            f"{len(payload['ga4']['landing_rows'])} landing rows"
        )

    if args.skip_meta:
        payload["meta"] = {"campaigns": [], "adsets": [], "ads": [], "placements": []}
    else:
        print("Meta:")
        payload["meta"] = build_meta(args.since, args.until)
        print(
            f"  → {len(payload['meta']['campaigns'])} campaign rows, "
            f"{len(payload['meta']['adsets'])} adset rows, "
            f"{len(payload['meta']['ads'])} ad rows, "
            f"{len(payload['meta']['placements'])} placement rows"
        )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
