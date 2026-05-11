#!/usr/bin/env python3
"""
GA4 Data API report fetcher for the marketing dashboard.

Usage:
  python scripts/fetch_ga4_data.py \
    --since 2026-05-10 \
    --until 2026-05-10 \
    --dimensions date,sessionSourceMedium \
    --metrics sessions,totalUsers,conversions,totalRevenue
"""

import argparse
import json
import os
import sys
from typing import Any


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _load_client():
    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
        from google.oauth2.credentials import Credentials
    except ImportError:
        print(
            "Missing dependency: google-analytics-data. "
            "Install it with `pip install -r requirements.txt`.",
            file=sys.stderr,
        )
        sys.exit(1)

    return BetaAnalyticsDataClient, DateRange, Dimension, Metric, RunReportRequest, Credentials


def _build_oauth_credentials(credentials_class):
    client_id = os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_OAUTH_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        return None

    return credentials_class(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=["https://www.googleapis.com/auth/analytics.readonly"],
    )


def run_report(
    property_id: str,
    since: str,
    until: str,
    dimensions: list[str],
    metrics: list[str],
    limit: int,
) -> dict[str, Any]:
    (
        BetaAnalyticsDataClient,
        DateRange,
        Dimension,
        Metric,
        RunReportRequest,
        Credentials,
    ) = _load_client()

    credentials = _build_oauth_credentials(Credentials)
    client = BetaAnalyticsDataClient(credentials=credentials) if credentials else BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{property_id}",
        date_ranges=[DateRange(start_date=since, end_date=until)],
        dimensions=[Dimension(name=name) for name in dimensions],
        metrics=[Metric(name=name) for name in metrics],
        limit=limit,
        return_property_quota=True,
    )

    response = client.run_report(request)
    rows = []
    for row in response.rows:
        item: dict[str, Any] = {}
        for idx, dimension in enumerate(dimensions):
            item[dimension] = row.dimension_values[idx].value
        for idx, metric in enumerate(metrics):
            raw_value = row.metric_values[idx].value
            item[metric] = _parse_metric_value(raw_value)
        rows.append(item)

    quota = None
    if response.property_quota:
        quota = {
            "tokens_per_day": _quota_status(response.property_quota.tokens_per_day),
            "tokens_per_hour": _quota_status(response.property_quota.tokens_per_hour),
            "concurrent_requests": _quota_status(response.property_quota.concurrent_requests),
            "server_errors_per_project_per_hour": _quota_status(
                response.property_quota.server_errors_per_project_per_hour
            ),
            "potentially_thresholded_requests_per_hour": _quota_status(
                response.property_quota.potentially_thresholded_requests_per_hour
            ),
        }

    return {
        "source": "ga4",
        "property_id": property_id,
        "period": {"since": since, "until": until},
        "dimensions": dimensions,
        "metrics": metrics,
        "row_count": response.row_count,
        "rows": rows,
        "property_quota": quota,
    }


def _parse_metric_value(value: str) -> int | float | str:
    try:
        as_float = float(value)
    except ValueError:
        return value

    if as_float.is_integer():
        return int(as_float)
    return as_float


def _quota_status(status) -> dict[str, int] | None:
    if not status:
        return None
    return {
        "consumed": status.consumed,
        "remaining": status.remaining,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch GA4 Data API report data as JSON.")
    parser.add_argument("--property-id", default=os.environ.get("GA4_PROPERTY_ID"))
    parser.add_argument("--since", required=True, help="Start date (YYYY-MM-DD).")
    parser.add_argument("--until", required=True, help="End date (YYYY-MM-DD).")
    parser.add_argument("--dimensions", required=True, help="Comma-separated GA4 dimensions.")
    parser.add_argument("--metrics", required=True, help="Comma-separated GA4 metrics.")
    parser.add_argument("--limit", type=int, default=10000)
    args = parser.parse_args()

    if not args.property_id:
        print("Missing GA4 property ID. Set GA4_PROPERTY_ID or pass --property-id.", file=sys.stderr)
        sys.exit(1)

    result = run_report(
        property_id=args.property_id,
        since=args.since,
        until=args.until,
        dimensions=_split_csv(args.dimensions),
        metrics=_split_csv(args.metrics),
        limit=args.limit,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
