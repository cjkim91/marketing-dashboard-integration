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
# Funnel stage counters use `sessions` (with an eventName filter) so the value
# is "sessions where the event fired" — properly bounded by total sessions.
# `eventCount` would over-count because a single session can fire view_item
# multiple times (e.g. viewing several products).
GA4_EVENT_METRICS = ["sessions", "totalRevenue"]

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
    parser = argparse.ArgumentParser(
        description="Build marketing dashboard JSON via incremental daily files.",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "backfill", "incremental", "refresh", "merge-only"],
        default="auto",
        help=(
            "auto         — daily/ 비었으면 backfill, 아니면 incremental (기본)\n"
            "backfill     — 지난 N일 전체를 7일 청크로 받아 daily/* 채움 (--lookback-days)\n"
            "incremental  — 최근 7일만 받아 해당 daily/* 덮어쓰기 (rolling refresh)\n"
            "refresh      — --since / --until 명시 윈도우를 받아 해당 daily/* 덮어쓰기\n"
            "merge-only   — API 호출 없이 daily/*를 dashboard.json으로만 머지"
        ),
    )
    parser.add_argument("--since", default=None, help="refresh 모드의 시작일 YYYY-MM-DD")
    parser.add_argument("--until", default=None, help="refresh 모드의 종료일 YYYY-MM-DD")
    parser.add_argument(
        "--lookback-days", type=int, default=90,
        help="backfill 모드에서 받을 일수. auto 모드 첫 백필도 이 값을 사용.",
    )
    parser.add_argument(
        "--rolling-days", type=int, default=7,
        help="incremental 모드에서 매번 갱신할 최근 일수.",
    )
    parser.add_argument(
        "--daily-dir", default="public/data/daily",
        help="일자별 raw JSON 저장 경로. {date}.json 파일이 모인다.",
    )
    parser.add_argument(
        "--output", default="public/data/dashboard.json",
        help="머지된 결과 파일 경로. 프론트엔드가 직접 읽는다.",
    )
    parser.add_argument("--ga4-property-id", default=os.environ.get("GA4_PROPERTY_ID", "311666548"))
    parser.add_argument("--skip-ga4", action="store_true")
    parser.add_argument("--skip-meta", action="store_true")
    return parser.parse_args()


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
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["sessions"], event_name="view_item"
    )
    device_cart = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["sessions"], event_name="add_to_cart"
    )
    device_checkout = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["sessions"], event_name="begin_checkout"
    )
    device_purchase = run_ga4_report(
        property_id, since, until, GA4_DEVICE_DIMENSIONS, ["sessions", "totalRevenue"],
        event_name="purchase"
    )

    print("  GA4: fetching landing page data …")
    landing_traffic = run_ga4_report(
        property_id, since, until, GA4_LANDING_DIMENSIONS, GA4_LANDING_METRICS, limit=2000
    )
    landing_purchase = run_ga4_report(
        property_id, since, until, GA4_LANDING_DIMENSIONS, ["sessions", "totalRevenue"],
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

    # ── Funnel stage counts: "sessions where event fired" ────────────────────
    # GA4 returns the metric as `sessions` when used with an eventName filter.
    for row in detail_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["detail_views"] += int(row.get("sessions", 0) or 0)

    for row in cart_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["cart_adds"] += int(row.get("sessions", 0) or 0)

    for row in checkout_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["checkout_starts"] += int(row.get("sessions", 0) or 0)

    for row in purchase_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["purchases"] += int(row.get("sessions", 0) or 0)
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
            dev_merged[key]["detail_views"] += int(row.get("sessions", 0) or 0)
    for row in device_cart:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["cart_adds"] += int(row.get("sessions", 0) or 0)
    for row in device_checkout:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["checkout_starts"] += int(row.get("sessions", 0) or 0)
    for row in device_purchase:
        key = device_key(row)
        if key in dev_merged:
            dev_merged[key]["purchases"] += int(row.get("sessions", 0) or 0)
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
            land_merged[key]["purchases"] += int(row.get("sessions", 0) or 0)
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
            "basis": "sessions (단일 세션 단위 집계)",
            "traffic": "GA4 sessions",
            "detail_view": "GA4 sessions where eventName=view_item",
            "cart": "GA4 sessions where eventName=add_to_cart",
            "checkout": "GA4 sessions where eventName=begin_checkout",
            "purchase": "GA4 sessions where eventName=purchase",
        },
        "rows": rows,
        "device_rows": device_rows_out,
        "landing_rows": landing_rows_out,
    }


# ── Meta build ────────────────────────────────────────────────────────────────

def _date_chunks(since: str, until: str, days: int) -> list[tuple[str, str]]:
    """Split [since, until] inclusive into windows of `days`."""
    start = datetime.fromisoformat(since).date()
    end   = datetime.fromisoformat(until).date()
    out: list[tuple[str, str]] = []
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=days - 1), end)
        out.append((cur.isoformat(), nxt.isoformat()))
        cur = nxt + timedelta(days=1)
    return out


def meta_api_rows(cfg: dict[str, Any], since: str, until: str, level: str,
                  chunk_days: int = 30) -> list[dict[str, Any]]:
    """
    Meta /insights at campaign/adset/ad level. We chunk by `chunk_days` to stay
    under Meta's "Please reduce the amount of data" limit on long windows
    combined with `time_increment=1`.
    """
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
    rows: list[dict[str, Any]] = []
    for chunk_since, chunk_until in _date_chunks(since, until, chunk_days):
        params = {
            "fields": ",".join(fields),
            "level": level,
            "time_increment": 1,
            "time_range": json.dumps({"since": chunk_since, "until": chunk_until}),
            "limit": 5000,
            "access_token": cfg["token"],
            "action_report_time": "impression",
        }
        rows.extend(paginate(url, params))
    return rows


def meta_placement_rows(cfg: dict[str, Any], since: str, until: str,
                        chunk_days: int = 14) -> list[dict[str, Any]]:
    """
    Placement breakdown is much heavier per day (publisher × position × ad).
    Use a smaller window (14 days) to stay well under Meta's data limit.
    """
    fields = [
        "date_start", "date_stop",
        "campaign_id", "campaign_name",
        "adset_id", "adset_name",
        "ad_id", "ad_name",
        "impressions", "spend", "clicks",
        "actions", "action_values",
    ]
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    rows: list[dict[str, Any]] = []
    for chunk_since, chunk_until in _date_chunks(since, until, chunk_days):
        params = {
            "fields": ",".join(fields),
            "level": "ad",
            "breakdowns": "publisher_platform,platform_position",
            "time_increment": 1,
            "time_range": json.dumps({"since": chunk_since, "until": chunk_until}),
            "limit": 5000,
            "access_token": cfg["token"],
            "action_report_time": "impression",
        }
        rows.extend(paginate(url, params))
    return rows


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


# ── Incremental persistence (daily JSON files) ─────────────────────────────────

# Each daily file lives at `<daily_dir>/<YYYY-MM-DD>.json` and contains every
# row whose `date` == that calendar day. The file holds GA4 (rows / device_rows
# / landing_rows) plus Meta (campaigns / adsets / ads / placements) bundled
# together. The merged view (`dashboard.json`) is generated by concatenating
# all daily files — no live API calls needed.

DAILY_BUCKETS = (
    ("ga4", "rows"),
    ("ga4", "device_rows"),
    ("ga4", "landing_rows"),
    ("meta", "campaigns"),
    ("meta", "adsets"),
    ("meta", "ads"),
    ("meta", "placements"),
)


def fetch_window(args: argparse.Namespace, since: str, until: str) -> dict[str, Any]:
    """Hit GA4 + Meta APIs for [since, until]. Returns the full payload."""
    print(f"Fetching window: {since} → {until}")
    payload: dict[str, Any] = {}

    if args.skip_ga4:
        payload["ga4"] = {
            "rows": [], "device_rows": [], "landing_rows": [],
            "has_checkout": False, "has_cart": False,
            "property_id": args.ga4_property_id,
            "funnel_definition": {},
        }
    else:
        print("GA4:")
        payload["ga4"] = build_ga4(args.ga4_property_id, since, until)
        print(
            f"  → {len(payload['ga4']['rows'])} rows, "
            f"{len(payload['ga4']['device_rows'])} device, "
            f"{len(payload['ga4']['landing_rows'])} landing"
        )

    if args.skip_meta:
        payload["meta"] = {"campaigns": [], "adsets": [], "ads": [], "placements": []}
    else:
        print("Meta:")
        payload["meta"] = build_meta(since, until)
        print(
            f"  → {len(payload['meta']['campaigns'])} campaign, "
            f"{len(payload['meta']['adsets'])} adset, "
            f"{len(payload['meta']['ads'])} ad, "
            f"{len(payload['meta']['placements'])} placement rows"
        )
    return payload


def split_payload_by_date(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """
    Group every row by its `date` field. Returns {date: {ga4: {…}, meta: {…}}}.
    Days with no rows on any side are still emitted (with empty lists) so a
    delete-and-insert refresh can clear a previously-existing daily file.
    """
    out: dict[str, dict[str, Any]] = {}

    def bucket(date: str) -> dict[str, Any]:
        if date not in out:
            out[date] = {
                "date": date,
                "ga4":  {"rows": [], "device_rows": [], "landing_rows": []},
                "meta": {"campaigns": [], "adsets": [], "ads": [], "placements": []},
            }
        return out[date]

    for section, key in DAILY_BUCKETS:
        for row in payload.get(section, {}).get(key, []) or []:
            d = row.get("date")
            if not d:
                continue
            bucket(d)[section][key].append(row)

    return out


def write_daily_files(daily_dir: Path, dates: list[str], buckets: dict[str, dict[str, Any]]) -> None:
    """Delete-and-insert each given date. Empty days are written as empty lists."""
    daily_dir.mkdir(parents=True, exist_ok=True)
    now_iso = datetime.now(timezone.utc).isoformat()
    for d in dates:
        bucket = buckets.get(d, {
            "date": d,
            "ga4":  {"rows": [], "device_rows": [], "landing_rows": []},
            "meta": {"campaigns": [], "adsets": [], "ads": [], "placements": []},
        })
        bucket["fetched_at"] = now_iso
        path = daily_dir / f"{d}.json"
        path.write_text(json.dumps(bucket, ensure_ascii=False, indent=2))
    print(f"Wrote {len(dates)} daily files into {daily_dir}/")


def merge_daily_files(daily_dir: Path, ga4_property_id: str, account_id: str | None) -> dict[str, Any]:
    """
    Read every <date>.json under daily_dir and reconstruct the full dashboard
    payload in the schema the front-end expects.
    """
    if not daily_dir.exists():
        return _empty_dashboard(ga4_property_id, account_id)

    files = sorted(daily_dir.glob("*.json"))
    if not files:
        return _empty_dashboard(ga4_property_id, account_id)

    ga4_rows: list[dict[str, Any]] = []
    ga4_dev:  list[dict[str, Any]] = []
    ga4_land: list[dict[str, Any]] = []
    meta_camp: list[dict[str, Any]] = []
    meta_adset: list[dict[str, Any]] = []
    meta_ad:   list[dict[str, Any]] = []
    meta_plac: list[dict[str, Any]] = []
    dates: list[str] = []

    for f in files:
        day = json.loads(f.read_text())
        dates.append(day.get("date") or f.stem)
        ga4 = day.get("ga4", {}) or {}
        meta = day.get("meta", {}) or {}
        ga4_rows.extend(ga4.get("rows", []) or [])
        ga4_dev.extend(ga4.get("device_rows", []) or [])
        ga4_land.extend(ga4.get("landing_rows", []) or [])
        meta_camp.extend(meta.get("campaigns", []) or [])
        meta_adset.extend(meta.get("adsets", []) or [])
        meta_ad.extend(meta.get("ads", []) or [])
        meta_plac.extend(meta.get("placements", []) or [])

    dates.sort()
    since = dates[0]
    until = dates[-1]
    has_cart = any((r.get("cart_adds") or 0) > 0 for r in ga4_rows)
    has_checkout = any((r.get("checkout_starts") or 0) > 0 for r in ga4_rows)

    now_utc = datetime.now(timezone.utc)
    return {
        "generated_at": now_utc.isoformat(),
        "generated_at_kst": now_utc.astimezone(KST).isoformat(),
        "data_through": until,
        "expected_through": kst_yesterday(),
        "period": {"since": since, "until": until},
        "defaults": {"granularity": "day"},
        "ga4": {
            "property_id": ga4_property_id,
            "has_checkout": has_checkout,
            "has_cart": has_cart,
            "funnel_definition": {
                "basis": "sessions (단일 세션 단위 집계)",
                "traffic": "GA4 sessions",
                "detail_view": "GA4 sessions where eventName=view_item",
                "cart": "GA4 sessions where eventName=add_to_cart",
                "checkout": "GA4 sessions where eventName=begin_checkout",
                "purchase": "GA4 sessions where eventName=purchase",
            },
            "rows": ga4_rows,
            "device_rows": ga4_dev,
            "landing_rows": ga4_land,
        },
        "meta": {
            "account_id": account_id or "",
            "campaigns": meta_camp,
            "adsets": meta_adset,
            "ads": meta_ad,
            "placements": meta_plac,
        },
    }


def _empty_dashboard(ga4_property_id: str, account_id: str | None) -> dict[str, Any]:
    now_utc = datetime.now(timezone.utc)
    return {
        "generated_at": now_utc.isoformat(),
        "generated_at_kst": now_utc.astimezone(KST).isoformat(),
        "data_through": None,
        "expected_through": kst_yesterday(),
        "period": {"since": None, "until": None},
        "defaults": {"granularity": "day"},
        "ga4": {
            "property_id": ga4_property_id,
            "has_checkout": False, "has_cart": False,
            "funnel_definition": {}, "rows": [], "device_rows": [], "landing_rows": [],
        },
        "meta": {
            "account_id": account_id or "",
            "campaigns": [], "adsets": [], "ads": [], "placements": [],
        },
    }


def date_range(since: str, until: str) -> list[str]:
    """Inclusive list of YYYY-MM-DD strings between since and until."""
    s = datetime.fromisoformat(since).date()
    u = datetime.fromisoformat(until).date()
    out = []
    cur = s
    while cur <= u:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    daily_dir = Path(args.daily_dir)
    output    = Path(args.output)

    # ── Pick mode ─────────────────────────────────────────────────────────────
    mode = args.mode
    if mode == "auto":
        has_existing = daily_dir.exists() and any(daily_dir.glob("*.json"))
        mode = "incremental" if has_existing else "backfill"
        print(f"auto → {mode} ({'daily/ 채워져 있음' if has_existing else 'daily/ 비어 있음 → 90일 백필'})")

    # ── Determine fetch window ────────────────────────────────────────────────
    fetch_pairs: list[tuple[str, str]] = []
    until_default = kst_yesterday()
    if mode == "backfill":
        until = args.until or until_default
        since_d = datetime.fromisoformat(until).date() - timedelta(days=args.lookback_days - 1)
        since = since_d.isoformat()
        # Chunk into 7-day windows so Meta placement breakdown never trips the limit
        fetch_pairs = _date_chunks(since, until, days=7)
        print(f"Backfill window: {since} → {until} (7-day chunks: {len(fetch_pairs)})")
    elif mode == "incremental":
        until = args.until or until_default
        since_d = datetime.fromisoformat(until).date() - timedelta(days=args.rolling_days - 1)
        since = since_d.isoformat()
        fetch_pairs = [(since, until)]
        print(f"Incremental window: {since} → {until}")
    elif mode == "refresh":
        if not args.since or not args.until:
            raise SystemExit("--since and --until are required for --mode refresh")
        fetch_pairs = _date_chunks(args.since, args.until, days=7)
        print(f"Refresh window: {args.since} → {args.until} (7-day chunks: {len(fetch_pairs)})")
    elif mode == "merge-only":
        print("merge-only: API 호출 생략, daily/* 만 머지한다.")
        fetch_pairs = []

    # ── Fetch + write daily files (delete-and-insert) ─────────────────────────
    account_id: str | None = None
    for since, until in fetch_pairs:
        payload = fetch_window(args, since, until)
        # Remember Meta account ID for the merged view
        if not account_id and payload.get("meta", {}).get("account_id"):
            account_id = payload["meta"]["account_id"]
        elif not account_id:
            account_id = payload.get("meta", {}).get("account_id")
        # Group rows by date and write each date's file (overwrites any prior).
        buckets = split_payload_by_date(payload)
        all_dates_in_window = date_range(since, until)
        write_daily_files(daily_dir, all_dates_in_window, buckets)

    # ── Try to recover account_id from existing daily files (merge-only path) ─
    if account_id is None and daily_dir.exists():
        for f in sorted(daily_dir.glob("*.json"), reverse=True):
            try:
                data = json.loads(f.read_text())
                aid = (data.get("meta") or {}).get("campaigns") or []
                # account_id isn't carried per-day; fall back to env / config
                break
            except Exception:
                continue
    if account_id is None:
        try:
            cfg = load_config()
            account_id = cfg.get("account_id")
        except SystemExit:
            account_id = None
        except Exception:
            account_id = None

    # ── Merge all daily files → dashboard.json ────────────────────────────────
    merged = merge_daily_files(daily_dir, args.ga4_property_id, account_id)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(merged, ensure_ascii=False, indent=2))
    period = merged.get("period", {})
    print(
        f"Wrote {output}  ({period.get('since')} → {period.get('until')}, "
        f"{len(merged['ga4']['rows'])} GA4 rows, "
        f"{len(merged['meta']['campaigns'])} Meta campaign rows)"
    )


if __name__ == "__main__":
    main()
