# Data Connection Checklist

Date: 2026-05-11

Use this checklist before starting the HTML dashboard build.

## Meta

The existing Meta Marketing API script has been copied to:

```text
scripts/fetch_meta_data.py
```

### Required Environment

```bash
export FACEBOOK_ACCESS_TOKEN="..."
export AD_ACCOUNT_ID="act_..."
```

### Yesterday Connection Test

```bash
python scripts/fetch_meta_data.py \
  --action fetch_insights \
  --level campaign \
  --since YYYY-MM-DD \
  --until YYYY-MM-DD
```

Connection is confirmed when:

- The command returns valid JSON.
- `period.since` and `period.until` match the requested date.
- `total` exists.
- `campaigns` is an array.

## GA4

### Recommended Local Python Setup

Use a project virtual environment before installing dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

### Required Environment

```bash
export GA4_PROPERTY_ID="123456789"
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
```

### Yesterday Connection Test

```bash
python scripts/fetch_ga4_data.py \
  --since YYYY-MM-DD \
  --until YYYY-MM-DD \
  --dimensions date,sessionSource,sessionMedium,sessionCampaignName \
  --metrics sessions,totalUsers,conversions,totalRevenue
```

Connection is confirmed when:

- The command returns valid JSON.
- `source` is `ga4`.
- `rows` is an array.
- No permission or credential error appears.

## After Both Connections Work

Start the dashboard build with this data shape:

```text
public/data/
  meta_campaigns.json
  ga4_campaigns.json
  dashboard.json
```

`dashboard.json` should be a normalized summary file generated from the raw platform outputs. The HTML app should read from `dashboard.json` first, then use raw files only for drilldowns.
