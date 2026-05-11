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
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fetch_ga4_data import _build_oauth_credentials, _load_client, _parse_metric_value
from fetch_meta_data import (
    calc_derived,
    extract_action_value,
    extract_monetary_value,
    load_config,
    paginate,
)


GA4_DIMENSIONS = ["date", "sessionSource", "sessionMedium", "sessionCampaignName"]
GA4_TRAFFIC_METRICS = ["sessions", "totalUsers", "totalRevenue"]
GA4_EVENT_METRICS = ["eventCount", "totalRevenue"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build marketing dashboard JSON.")
    parser.add_argument("--since", required=True, help="Start date, YYYY-MM-DD.")
    parser.add_argument("--until", required=True, help="End date, YYYY-MM-DD.")
    parser.add_argument("--output", default="public/data/dashboard.json")
    parser.add_argument("--ga4-property-id", default=os.environ.get("GA4_PROPERTY_ID", "311666548"))
    parser.add_argument("--skip-ga4", action="store_true")
    parser.add_argument("--skip-meta", action="store_true")
    return parser.parse_args()


def ymd(value: str) -> str:
    return datetime.strptime(value, "%Y-%m-%d").strftime("%Y%m%d")


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
    client = BetaAnalyticsDataClient(credentials=credentials) if credentials else BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=since, end_date=until)],
        dimensions=[Dimension(name=name) for name in dimensions],
        metrics=[Metric(name=name) for name in metrics],
        limit=100000,
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


def build_ga4(property_id: str, since: str, until: str) -> dict[str, Any]:
    traffic_rows = run_ga4_report(
        property_id,
        since,
        until,
        GA4_DIMENSIONS,
        GA4_TRAFFIC_METRICS,
    )
    detail_rows = run_ga4_report(
        property_id,
        since,
        until,
        GA4_DIMENSIONS,
        GA4_EVENT_METRICS,
        event_name="view_item",
    )
    purchase_rows = run_ga4_report(
        property_id,
        since,
        until,
        GA4_DIMENSIONS,
        GA4_EVENT_METRICS,
        event_name="purchase",
    )

    merged: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    for row in traffic_rows:
        key = key_from_row(row)
        date_value, source, medium, campaign = key
        merged[key] = {
            "date": date_value,
            "source": source,
            "medium": medium,
            "campaign": campaign,
            "channel": channel_name(source, medium),
            "sessions": int(row.get("sessions", 0) or 0),
            "users": int(row.get("totalUsers", 0) or 0),
            "detail_views": 0,
            "purchases": 0,
            "revenue": float(row.get("totalRevenue", 0) or 0),
        }

    for row in detail_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["detail_views"] += int(row.get("eventCount", 0) or 0)

    for row in purchase_rows:
        key = key_from_row(row)
        if key not in merged:
            date_value, source, medium, campaign = key
            merged[key] = empty_ga4_row(date_value, source, medium, campaign)
        merged[key]["purchases"] += int(row.get("eventCount", 0) or 0)
        purchase_revenue = float(row.get("totalRevenue", 0) or 0)
        if purchase_revenue:
            merged[key]["revenue"] = purchase_revenue

    rows = sorted(merged.values(), key=lambda item: (item["date"], -item["sessions"]))
    for row in rows:
        add_ga4_rates(row)

    return {
        "property_id": property_id,
        "funnel_definition": {
            "traffic": "sessions",
            "detail_view": "GA4 eventName=view_item",
            "purchase": "GA4 eventName=purchase",
        },
        "rows": rows,
    }


def empty_ga4_row(date_value: str, source: str, medium: str, campaign: str) -> dict[str, Any]:
    return {
        "date": date_value,
        "source": source,
        "medium": medium,
        "campaign": campaign,
        "channel": channel_name(source, medium),
        "sessions": 0,
        "users": 0,
        "detail_views": 0,
        "purchases": 0,
        "revenue": 0.0,
    }


def add_ga4_rates(row: dict[str, Any]) -> None:
    sessions = row.get("sessions", 0)
    details = row.get("detail_views", 0)
    purchases = row.get("purchases", 0)
    row["detail_view_rate"] = round(details / sessions * 100, 2) if sessions else 0
    row["purchase_rate"] = round(purchases / sessions * 100, 2) if sessions else 0
    row["detail_to_purchase_rate"] = round(purchases / details * 100, 2) if details else 0


def meta_api_rows(cfg: dict[str, Any], since: str, until: str, level: str) -> list[dict[str, Any]]:
    fields = [
        "date_start",
        "date_stop",
        "campaign_id",
        "campaign_name",
        "impressions",
        "reach",
        "spend",
        "clicks",
        "actions",
        "action_values",
    ]
    if level in {"adset", "ad"}:
        fields.extend(["adset_id", "adset_name"])
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
        "date_start",
        "date_stop",
        "campaign_id",
        "campaign_name",
        "adset_id",
        "adset_name",
        "ad_id",
        "ad_name",
        "impressions",
        "spend",
        "clicks",
        "actions",
        "action_values",
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
    item = {
        "impressions": int(row.get("impressions", 0) or 0),
        "reach": int(row.get("reach", 0) or 0),
        "clicks": int(row.get("clicks", 0) or 0),
        "spend": round(float(row.get("spend", 0) or 0), 2),
        "conversions": conversions,
        "conversion_value": round(conversion_value, 2),
    }
    calc_derived(item)
    return item


def normalize_meta_level(rows: list[dict[str, Any]], level: str) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item = {
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
        item = {
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
    campaigns = normalize_meta_level(meta_api_rows(cfg, since, until, "campaign"), "campaign")
    adsets = normalize_meta_level(meta_api_rows(cfg, since, until, "adset"), "adset")
    ads = normalize_meta_level(meta_api_rows(cfg, since, until, "ad"), "ad")
    placements = normalize_placements(meta_placement_rows(cfg, since, until))
    return {
        "account_id": cfg["account_id"],
        "campaigns": campaigns,
        "adsets": adsets,
        "ads": ads,
        "placements": placements,
    }


def main() -> None:
    args = parse_args()
    payload: dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": {"since": args.since, "until": args.until},
        "defaults": {"granularity": "week"},
    }

    if args.skip_ga4:
        payload["ga4"] = {"rows": []}
    else:
        payload["ga4"] = build_ga4(args.ga4_property_id, args.since, args.until)

    if args.skip_meta:
        payload["meta"] = {"campaigns": [], "adsets": [], "ads": [], "placements": []}
    else:
        payload["meta"] = build_meta(args.since, args.until)

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
