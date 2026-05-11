# Meta Reuse Notes

Date: 2026-05-11

## Source

The project will reuse the user's existing Meta Marketing API implementation from:

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/.claude.pre-split-backup/skills/meta-ads-analyzer
```

The reusable script has been copied into this repo:

```text
scripts/fetch_meta_data.py
```

## Existing Connection History

An earlier Tourlive Meta analysis was found at:

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260426_투어라이브_2주_성과분석
```

That analysis states the data came from:

```text
~/.claude-personal/skills/meta-ads-analyzer/scripts/fetch_meta_data.py
```

with actions:

```text
list_campaigns
fetch_insights
fetch_trend
fetch_breakdown
```

The credential source is the existing single-account config:

```text
/Users/aiden/Library/Mobile Documents/com~apple~CloudDocs/Claude/side-projects/marketing/260209_meta_daily_report/config.py
```

The ad account ID from that config is:

```text
act_10202125972212509
```

The copied script now includes this config path as a fallback.

Connection was re-tested on 2026-05-11 for 2026-05-10 data and returned 3 active campaigns:

- `CONV_100원 가이드북_250529`
- `CONV_셀프투어_251204`
- `CONV_웨비나_전환_260313`

## What It Already Supports

The script already handles:

- Credential loading from `FACEBOOK_ACCESS_TOKEN` and `AD_ACCOUNT_ID`.
- Fallback loading from existing `config.py` locations.
- Meta Graph API pagination.
- Campaign list lookup for a date range.
- Campaign, ad set, and ad-level insights.
- Weekly trend queries.
- Placement breakdown queries.
- Derived metrics:
  - CTR
  - CVR
  - CPC
  - CPA
  - ROAS
  - CPM

## Best First Dashboard Query

For a previous-day dashboard, the core command is:

```bash
python scripts/fetch_meta_data.py \
  --action fetch_insights \
  --level campaign \
  --since YYYY-MM-DD \
  --until YYYY-MM-DD
```

For deeper drilldowns:

```bash
python scripts/fetch_meta_data.py \
  --action fetch_insights \
  --level adset \
  --since YYYY-MM-DD \
  --until YYYY-MM-DD
```

```bash
python scripts/fetch_meta_data.py \
  --action fetch_insights \
  --level ad \
  --since YYYY-MM-DD \
  --until YYYY-MM-DD
```

## Credentials Needed

Local environment:

```bash
export FACEBOOK_ACCESS_TOKEN="..."
export AD_ACCOUNT_ID="act_..."
```

GitHub Actions:

- `FACEBOOK_ACCESS_TOKEN`
- `AD_ACCOUNT_ID`
- Optional: `META_API_VERSION`

## Notes for Dashboard Integration

The script prints JSON to stdout. The dashboard build job can redirect the output into generated files:

```bash
python scripts/fetch_meta_data.py \
  --action fetch_insights \
  --level campaign \
  --since "$YESTERDAY" \
  --until "$YESTERDAY" \
  > public/data/meta_campaigns.json
```

The current script defaults to Graph API `v21.0` unless `META_API_VERSION` is set. Before production deployment, confirm whether the existing access token and account still support that version.
