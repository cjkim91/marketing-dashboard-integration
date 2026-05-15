#!/usr/bin/env python3
"""
Meta Marketing API 데이터 조회 스크립트
meta-ads-analyzer 스킬에서 사용

사용법:
  python fetch_meta_data.py --action list_campaigns --since 2026-01-01 --until 2026-02-09
  python fetch_meta_data.py --action fetch_insights --level campaign --since 2026-01-01 --until 2026-02-09
  python fetch_meta_data.py --action fetch_insights --level adset --campaign_ids 123,456 --since 2026-01-01 --until 2026-02-09
  python fetch_meta_data.py --action fetch_insights --level ad --campaign_ids 123 --since 2026-01-01 --until 2026-02-09
  python fetch_meta_data.py --action fetch_trend --level adset --campaign_ids 123 --since 2026-01-01 --until 2026-02-09
  python fetch_meta_data.py --action fetch_breakdown --campaign_ids 123 --since 2026-01-01 --until 2026-02-09
"""

import argparse
import json
import os
import sys
from pathlib import Path


# ── 설정 로딩 ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    """
    자격증명을 로드한다. 우선순위:
    1. 환경변수 (FACEBOOK_ACCESS_TOKEN, AD_ACCOUNT_ID)
    2. 프로젝트 config.py (Meta_ads_daily_report/config.py)
    """
    token = os.environ.get("FACEBOOK_ACCESS_TOKEN")
    account_id = os.environ.get("AD_ACCOUNT_ID")

    # 환경변수에 없으면 config.py에서 로드
    if not token or not account_id:
        config_candidates = [
            Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/Meta_ads_daily_report/config.py",
            Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260209_meta_daily_report/config.py",
            Path.cwd() / "config.py",
            Path.cwd().parent / "config.py",
            Path(__file__).parent.parent.parent.parent / "Meta_ads_daily_report/config.py",
        ]

        config_loaded = False
        for config_path in config_candidates:
            if config_path.exists():
                import importlib.util
                spec = importlib.util.spec_from_file_location("config", config_path)
                cfg = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(cfg)
                token = token or getattr(cfg, "FACEBOOK_ACCESS_TOKEN", None)
                account_id = account_id or getattr(cfg, "AD_ACCOUNT_ID", None)
                config_loaded = True
                break

        if not config_loaded and (not token or not account_id):
            print("❌ 자격증명을 찾을 수 없습니다.", file=sys.stderr)
            print("   환경변수 FACEBOOK_ACCESS_TOKEN, AD_ACCOUNT_ID를 설정하거나", file=sys.stderr)
            print("   Meta_ads_daily_report/config.py를 확인하세요.", file=sys.stderr)
            sys.exit(1)

    if account_id and not account_id.startswith("act_"):
        account_id = f"act_{account_id}"

    return {
        "token": token,
        "account_id": account_id,
        # Meta는 v24.0 미만을 2026-06-09에 사용 중단한다. v25.0이 최신 권장.
        "api_version": os.environ.get("META_API_VERSION", "v25.0"),
    }


# ── API 공통 호출 ──────────────────────────────────────────────────────────────

def api_get(url: str, params: dict) -> dict:
    """Meta Graph API GET 요청. 에러 시 예외 발생."""
    try:
        import requests
    except ImportError:
        print("❌ requests 라이브러리가 없습니다. pip install requests 를 실행하세요.", file=sys.stderr)
        sys.exit(1)

    resp = requests.get(url, params=params, timeout=30)
    data = resp.json()

    if "error" in data:
        err = data["error"]
        print(f"❌ Meta API 에러 [{err.get('code')}]: {err.get('message')}", file=sys.stderr)
        sys.exit(1)

    if resp.status_code != 200:
        print(f"❌ HTTP {resp.status_code}: {resp.text}", file=sys.stderr)
        sys.exit(1)

    return data


def paginate(base_url: str, params: dict) -> list:
    """페이지네이션을 처리하며 모든 결과를 반환한다."""
    all_data = []
    url = base_url

    while url:
        result = api_get(url, params)
        all_data.extend(result.get("data", []))

        next_url = result.get("paging", {}).get("next")
        url = next_url
        params = {}  # next URL에는 이미 params가 포함됨

    return all_data


# ── 액션: 캠페인 목록 조회 ─────────────────────────────────────────────────────

def list_campaigns(cfg: dict, since: str, until: str) -> None:
    """지정 기간에 집행된 캠페인 목록 조회 (ID, 이름, 상태, 광고비)."""
    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": "campaign_id,campaign_name,spend",
        "level": "campaign",
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 500,
        "access_token": cfg["token"],
    }

    rows = paginate(url, params)

    if not rows:
        print(json.dumps({"campaigns": [], "period": {"since": since, "until": until}}))
        return

    campaigns = []
    seen = set()
    for row in rows:
        cid = row.get("campaign_id")
        if cid and cid not in seen:
            seen.add(cid)
            campaigns.append({
                "id": cid,
                "name": row.get("campaign_name", "Unknown"),
                "spend": float(row.get("spend", 0)),
                "status": "ACTIVE",
            })

    campaigns.sort(key=lambda x: x["spend"], reverse=True)

    output = {
        "period": {"since": since, "until": until},
        "total_campaigns": len(campaigns),
        "campaigns": campaigns,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


# ── 액션: 인사이트 조회 ────────────────────────────────────────────────────────

def fetch_insights(
    cfg: dict,
    level: str,
    since: str,
    until: str,
    campaign_ids: list[str] | None,
) -> None:
    """캠페인/광고세트/소재 레벨 인사이트 조회."""
    base_fields = [
        "date_start", "date_stop",
        "campaign_id", "campaign_name",
        "impressions", "reach", "spend",
        "clicks", "cpc", "ctr",
        "actions", "action_values",
    ]

    if level == "adset":
        base_fields += ["adset_id", "adset_name", "frequency"]
    elif level == "ad":
        base_fields += ["adset_id", "adset_name", "ad_id", "ad_name"]

    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": ",".join(base_fields),
        "level": level,
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 5000,
        "access_token": cfg["token"],
        "action_report_time": "impression",
    }

    if campaign_ids:
        params["filtering"] = json.dumps([
            {"field": "campaign.id", "operator": "IN", "value": campaign_ids}
        ])

    rows = paginate(url, params)
    result = aggregate_insights(rows, level, since, until)
    print(json.dumps(result, ensure_ascii=False, indent=2))


# ── 액션: 주별 추이 조회 ───────────────────────────────────────────────────────

def fetch_trend(
    cfg: dict,
    level: str,
    since: str,
    until: str,
    campaign_ids: list[str] | None,
) -> None:
    """
    주별(7일 단위) 추이 데이터 조회.
    전체 추이(total_trend) + 광고세트/소재별 추이(entities)를 반환한다.
    """
    base_fields = [
        "date_start", "date_stop",
        "campaign_id", "campaign_name",
        "impressions", "spend", "clicks",
        "actions", "action_values",
    ]

    if level in ("adset", "ad"):
        base_fields += ["adset_id", "adset_name"]
    if level == "ad":
        base_fields += ["ad_id", "ad_name"]

    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": ",".join(base_fields),
        "level": level,
        "time_increment": 7,  # 주별 집계
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 5000,
        "access_token": cfg["token"],
        "action_report_time": "impression",
    }

    if campaign_ids:
        params["filtering"] = json.dumps([
            {"field": "campaign.id", "operator": "IN", "value": campaign_ids}
        ])

    rows = paginate(url, params)
    result = aggregate_trend(rows, level, since, until)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def aggregate_trend(rows: list, level: str, since: str, until: str) -> dict:
    """주별 집계: 전체 추이(total_trend) + 엔티티별 추이(entities)."""
    total_trend: dict = {}   # week_start → 누적 지표
    entity_map: dict = {}    # entity_id → {id, name, trend}

    for row in rows:
        parsed = parse_row(row)
        week_start = row.get("date_start", "")
        week_end = row.get("date_stop", "")

        # 전체 추이
        if week_start not in total_trend:
            total_trend[week_start] = {
                "week_start": week_start, "week_end": week_end,
                "spend": 0, "impressions": 0, "clicks": 0,
                "conversions": 0, "conversion_value": 0,
            }
        _add_core(total_trend[week_start], parsed)

        # 엔티티별 추이
        if level == "adset":
            eid = row.get("adset_id", "")
            ename = row.get("adset_name", "Unknown")
        elif level == "ad":
            eid = row.get("ad_id", "")
            ename = row.get("ad_name", "Unknown")
        else:
            eid = row.get("campaign_id", "")
            ename = row.get("campaign_name", "Unknown")

        if eid not in entity_map:
            entity_map[eid] = {"id": eid, "name": ename, "trend": {}}

        if week_start not in entity_map[eid]["trend"]:
            entity_map[eid]["trend"][week_start] = {
                "week_start": week_start, "week_end": week_end,
                "spend": 0, "impressions": 0, "clicks": 0,
                "conversions": 0, "conversion_value": 0,
            }
        _add_core(entity_map[eid]["trend"][week_start], parsed)

    # 파생 지표 계산
    total_weeks = []
    for w in sorted(total_trend.values(), key=lambda x: x["week_start"]):
        calc_derived(w)
        total_weeks.append(w)

    entities_out = []
    for e in sorted(
        entity_map.values(),
        key=lambda x: sum(v.get("spend", 0) for v in x["trend"].values()),
        reverse=True,
    ):
        weeks_out = []
        for w in sorted(e["trend"].values(), key=lambda x: x["week_start"]):
            calc_derived(w)
            weeks_out.append(w)
        e["trend"] = weeks_out
        entities_out.append(e)

    return {
        "level": level,
        "period": {"since": since, "until": until},
        "total_trend": total_weeks,
        "entities": entities_out,
    }


# ── 액션: 지면(Placement) 분석 ────────────────────────────────────────────────

def fetch_breakdown(
    cfg: dict,
    since: str,
    until: str,
    campaign_ids: list[str] | None,
) -> None:
    """
    소재별 게재 위치(publisher_platform × platform_position) 분석.
    reach는 breakdown 모드에서 집계 불가하므로 제외.
    """
    base_fields = [
        "campaign_id", "campaign_name",
        "adset_id", "adset_name",
        "ad_id", "ad_name",
        "impressions", "spend", "clicks",
        "actions", "action_values",
    ]

    url = f"https://graph.facebook.com/{cfg['api_version']}/{cfg['account_id']}/insights"
    params = {
        "fields": ",".join(base_fields),
        "level": "ad",
        "breakdowns": "publisher_platform,platform_position",
        "time_range": json.dumps({"since": since, "until": until}),
        "limit": 5000,
        "access_token": cfg["token"],
        "action_report_time": "impression",
    }

    if campaign_ids:
        params["filtering"] = json.dumps([
            {"field": "campaign.id", "operator": "IN", "value": campaign_ids}
        ])

    rows = paginate(url, params)
    result = aggregate_breakdown(rows, since, until)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def aggregate_breakdown(rows: list, since: str, until: str) -> dict:
    """소재별 지면 교차 집계: 캠페인 > 광고세트 > 소재 > 지면."""
    campaign_map: dict = {}

    for row in rows:
        spend = float(row.get("spend", 0))
        impressions = int(row.get("impressions", 0))
        clicks = int(row.get("clicks", 0))
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

        c_id = row.get("campaign_id", "")
        c_name = row.get("campaign_name", "")
        a_id = row.get("adset_id", "")
        a_name = row.get("adset_name", "")
        ad_id = row.get("ad_id", "")
        ad_name = row.get("ad_name", "Unknown")
        platform = row.get("publisher_platform", "unknown")
        position = row.get("platform_position", "unknown")
        placement_key = f"{platform}|{position}"

        if c_id not in campaign_map:
            campaign_map[c_id] = {"id": c_id, "name": c_name, "adsets": {}}
        adsets = campaign_map[c_id]["adsets"]

        if a_id not in adsets:
            adsets[a_id] = {"id": a_id, "name": a_name, "ads": {}}
        ads = adsets[a_id]["ads"]

        if ad_id not in ads:
            ads[ad_id] = {"id": ad_id, "name": ad_name, "placements": {}}
        placements = ads[ad_id]["placements"]

        if placement_key not in placements:
            placements[placement_key] = {
                "publisher_platform": platform,
                "platform_position": position,
                "spend": 0, "impressions": 0, "clicks": 0,
                "conversions": 0, "conversion_value": 0,
            }

        pl = placements[placement_key]
        pl["spend"] += spend
        pl["impressions"] += impressions
        pl["clicks"] += clicks
        pl["conversions"] += conversions
        pl["conversion_value"] += conversion_value

    # 파생 지표 계산 + 지출 비중 추가
    campaigns_out = []
    for c in campaign_map.values():
        adsets_out = []
        for a in c["adsets"].values():
            ads_out = []
            for ad in a["ads"].values():
                total_spend = sum(p["spend"] for p in ad["placements"].values())
                placements_out = []
                for pl in sorted(ad["placements"].values(), key=lambda x: x["spend"], reverse=True):
                    calc_derived(pl)
                    pl["spend_share"] = round(pl["spend"] / total_spend * 100, 1) if total_spend > 0 else 0
                    placements_out.append(pl)
                ad["placements"] = placements_out
                ads_out.append(ad)
            ads_out.sort(
                key=lambda x: sum(p.get("spend", 0) for p in x["placements"]),
                reverse=True,
            )
            a["ads"] = ads_out
            adsets_out.append(a)
        c["adsets"] = adsets_out
        campaigns_out.append(c)

    return {
        "level": "placement_breakdown",
        "period": {"since": since, "until": until},
        "campaigns": campaigns_out,
    }


# ── 공통 파싱/집계 헬퍼 ────────────────────────────────────────────────────────

def extract_action_value(actions: list, action_type: str) -> int:
    if not actions:
        return 0
    for a in actions:
        if a.get("action_type") == action_type:
            return int(float(a.get("value", 0)))
    return 0


def extract_monetary_value(action_values: list, action_type: str) -> float:
    if not action_values:
        return 0.0
    for a in action_values:
        if a.get("action_type") == action_type:
            return float(a.get("value", 0))
    return 0.0


def parse_row(row: dict) -> dict:
    """단일 API row → 표준 지표 딕셔너리."""
    spend = float(row.get("spend", 0))
    impressions = int(row.get("impressions", 0))
    reach = int(row.get("reach", 0))
    clicks = int(row.get("clicks", 0))
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

    ctr = clicks / impressions * 100 if impressions > 0 else 0
    cvr = conversions / clicks * 100 if clicks > 0 else 0
    cpc = spend / clicks if clicks > 0 else 0
    cpa = spend / conversions if conversions > 0 else 0
    roas = conversion_value / spend if spend > 0 else 0
    cpm = spend / impressions * 1000 if impressions > 0 else 0

    return {
        "spend": round(spend, 2),
        "impressions": impressions,
        "reach": reach,
        "clicks": clicks,
        "conversions": conversions,
        "conversion_value": round(conversion_value, 2),
        "ctr": round(ctr, 4),
        "cvr": round(cvr, 4),
        "cpc": round(cpc, 2),
        "cpa": round(cpa, 2),
        "roas": round(roas, 4),
        "cpm": round(cpm, 2),
        "frequency": float(row.get("frequency", 0)),
    }


def _add_core(target: dict, src: dict) -> None:
    """핵심 원시 지표만 누적 (파생 지표 제외, reach 제외)."""
    for k in ("spend", "impressions", "clicks", "conversions", "conversion_value"):
        target[k] = target.get(k, 0) + src.get(k, 0)


def add_metrics(target: dict, src: dict) -> None:
    """원시 지표 누적 (reach 포함)."""
    for k in ("spend", "impressions", "reach", "clicks", "conversions", "conversion_value"):
        target[k] = target.get(k, 0) + src.get(k, 0)


def calc_derived(d: dict) -> None:
    """누적값에서 파생 지표 재계산."""
    imp = d.get("impressions", 0)
    clk = d.get("clicks", 0)
    conv = d.get("conversions", 0)
    spend = d.get("spend", 0)
    cv = d.get("conversion_value", 0)

    d["ctr"] = round(clk / imp * 100, 4) if imp > 0 else 0
    d["cvr"] = round(conv / clk * 100, 4) if clk > 0 else 0
    d["cpc"] = round(spend / clk, 2) if clk > 0 else 0
    d["cpa"] = round(spend / conv, 2) if conv > 0 else 0
    d["roas"] = round(cv / spend, 4) if spend > 0 else 0
    d["cpm"] = round(spend / imp * 1000, 2) if imp > 0 else 0


def aggregate_insights(rows: list, level: str, since: str, until: str) -> dict:
    """rows를 캠페인 > 광고세트 > 소재 계층으로 집계."""
    total: dict = {
        "spend": 0, "impressions": 0, "reach": 0,
        "clicks": 0, "conversions": 0, "conversion_value": 0,
    }
    campaign_map: dict = {}

    for row in rows:
        parsed = parse_row(row)
        add_metrics(total, parsed)

        c_name = row.get("campaign_name", "Unknown")
        c_id = row.get("campaign_id", "")

        if c_id not in campaign_map:
            campaign_map[c_id] = {
                "id": c_id, "name": c_name,
                "spend": 0, "impressions": 0, "reach": 0,
                "clicks": 0, "conversions": 0, "conversion_value": 0,
                "adsets": {},
            }
        add_metrics(campaign_map[c_id], parsed)

        if level in ("adset", "ad"):
            a_id = row.get("adset_id", "")
            a_name = row.get("adset_name", "Unknown")
            adsets = campaign_map[c_id]["adsets"]

            if a_id not in adsets:
                adsets[a_id] = {
                    "id": a_id, "name": a_name,
                    "spend": 0, "impressions": 0, "reach": 0,
                    "clicks": 0, "conversions": 0, "conversion_value": 0,
                    "frequency_sum": 0.0, "days": 0,
                    "ads": {},
                }
            add_metrics(adsets[a_id], parsed)
            adsets[a_id]["frequency_sum"] += float(row.get("frequency", 0))
            adsets[a_id]["days"] += 1

        if level == "ad":
            ad_id = row.get("ad_id", "")
            ad_name = row.get("ad_name", "Unknown")
            adset_node = campaign_map[c_id]["adsets"][row.get("adset_id", "")]
            ads = adset_node["ads"]

            if ad_id not in ads:
                ads[ad_id] = {
                    "id": ad_id, "name": ad_name,
                    "spend": 0, "impressions": 0, "reach": 0,
                    "clicks": 0, "conversions": 0, "conversion_value": 0,
                }
            add_metrics(ads[ad_id], parsed)

    # 파생 지표 계산 + 정리
    calc_derived(total)

    campaigns_out = []
    for c in sorted(campaign_map.values(), key=lambda x: x["spend"], reverse=True):
        calc_derived(c)

        adsets_out = []
        for a in sorted(c["adsets"].values(), key=lambda x: x["spend"], reverse=True):
            calc_derived(a)
            days = a.get("days", 1) or 1
            a["frequency"] = round(a["frequency_sum"] / days, 2)
            del a["frequency_sum"], a["days"]

            ads_out = []
            for ad in sorted(a.get("ads", {}).values(), key=lambda x: x["spend"], reverse=True):
                calc_derived(ad)
                ads_out.append(ad)
            a["ads"] = ads_out
            adsets_out.append(a)

        c["adsets"] = adsets_out
        campaigns_out.append(c)

    return {
        "level": level,
        "period": {"since": since, "until": until},
        "total": total,
        "campaigns": campaigns_out,
    }


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Meta Marketing API 데이터 조회")
    parser.add_argument("--action", required=True,
                        choices=["list_campaigns", "fetch_insights", "fetch_trend", "fetch_breakdown"],
                        help="실행할 액션")
    parser.add_argument("--level", default="campaign",
                        choices=["campaign", "adset", "ad"],
                        help="인사이트/추이 레벨 (fetch_insights, fetch_trend 시 사용)")
    parser.add_argument("--since", required=True, help="시작 날짜 (YYYY-MM-DD)")
    parser.add_argument("--until", required=True, help="종료 날짜 (YYYY-MM-DD)")
    parser.add_argument("--campaign_ids", default=None,
                        help="필터할 캠페인 ID (쉼표 구분). 없으면 전체")
    args = parser.parse_args()

    cfg = load_config()

    campaign_ids = None
    if args.campaign_ids:
        campaign_ids = [cid.strip() for cid in args.campaign_ids.split(",") if cid.strip()]

    if args.action == "list_campaigns":
        list_campaigns(cfg, args.since, args.until)
    elif args.action == "fetch_insights":
        fetch_insights(cfg, args.level, args.since, args.until, campaign_ids)
    elif args.action == "fetch_trend":
        fetch_trend(cfg, args.level, args.since, args.until, campaign_ids)
    elif args.action == "fetch_breakdown":
        fetch_breakdown(cfg, args.since, args.until, campaign_ids)


if __name__ == "__main__":
    main()
