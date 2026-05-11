# Marketing Dashboard Data Integration Plan

Date: 2026-05-11

## Goal

Build a client-shareable HTML marketing dashboard that combines GA4 and Meta Ads data, can be maintained through GitHub, and can evolve over time without redesigning the data pipeline every time the UI changes.

## Recommended Direction

Use a small backend/data layer even if the final client-facing output is HTML. The dashboard should not call GA4 or Meta directly from browser JavaScript because credentials, API quotas, and client visibility become hard to control.

Recommended first version:

1. Fetch data on a schedule.
2. Normalize it into a small warehouse or local generated JSON files.
3. Render a static or lightweight HTML dashboard from that normalized data.
4. Publish through GitHub Pages, Vercel, Netlify, Cloudflare Pages, or a private client portal.

## GA4 Integration Options

### Option A: GA4 Data API

Best for dashboard metrics similar to the GA4 UI:

- Sessions, users, conversions, revenue, events, pages, source/medium, campaign dimensions.
- Server-side scheduled pulls every 5-15 minutes for near-current dashboard needs.
- Official method: Google Analytics Data API `runReport`.
- Authentication: OAuth user account or service account. For automation, service account is preferred when allowed by property access setup.

Use this for:

- KPI cards.
- Trend charts.
- Channel/campaign breakdowns.
- Client-facing summaries that should match GA4-style reporting.

### Option B: GA4 Realtime API

Best for "right now" widgets:

- Active users.
- Events or conversions in the last 30 minutes.
- Current traffic source/page style monitoring.
- Official method: Google Analytics Data API `runRealtimeReport`.

Use this sparingly. It is useful as a live pulse, not as the primary truth for performance reporting.

### Option C: GA4 BigQuery Export

Best for durable reporting and joining with Meta:

- Raw event-level GA4 export.
- Daily export for stable historical reporting.
- Streaming export for current-day event data within minutes.
- SQL joins with campaign metadata, UTM mappings, CRM/revenue data, and Meta spend.

Recommended production path:

- Enable GA4 BigQuery Export.
- Use Daily export for stable history.
- Use Streaming export for current-day near-realtime views.
- Use Data API for GA4 UI-aligned metrics where needed.

Important caveat:

BigQuery export data may differ from the GA4 interface because it is raw event/user-level data and excludes some GA4 report-layer additions. Streaming export can also have gaps and attribution limitations, so daily export should be used for finalized numbers.

## Meta Integration Options

### Option A: Meta Ads MCP / CLI

Meta's April 2026 Ads AI Connectors are promising for operator workflows:

- MCP server for AI tools.
- CLI for terminal/agent workflows.
- OAuth-based setup.
- Useful for analysis, reporting, campaign management, catalog work, and diagnostics.

Best use in this dashboard project:

- Internal operator workflow.
- Ad-hoc campaign audits.
- Pulling report snapshots through a controlled script if the CLI is stable in the target environment.
- Future campaign-management automation, with human review.

Risk:

The MCP/CLI path is new and may be better suited to agent-assisted operations than a deterministic backend data pipeline. For a client dashboard, we should treat it as an accelerator, not the only dependency.

### Option B: Meta Marketing API

Best for stable scheduled ingestion:

- Campaign, ad set, ad, creative metadata.
- Insights: spend, impressions, reach, clicks, CTR, CPC, CPM, conversions, purchase value, ROAS where available.
- Hourly or daily scheduled jobs.

Recommended production path:

- Use Meta Marketing API or official CLI if it provides stable JSON output and auth suitable for scheduled jobs.
- Store raw API responses for traceability.
- Normalize to a shared schema with GA4.

## Proposed Data Model

Minimum normalized tables or JSON datasets:

- `platform_accounts`: account IDs, display names, timezone, currency.
- `campaigns`: platform, campaign ID, name, status, objective, start/end dates.
- `adsets`: Meta ad set metadata when needed.
- `ads`: Meta ad metadata when needed.
- `daily_platform_metrics`: date, platform, account, campaign, spend, impressions, clicks, CTR, CPC, CPM.
- `daily_site_metrics`: date, source, medium, campaign, sessions, users, conversions, revenue.
- `realtime_site_metrics`: timestamp, active users, top pages, realtime conversions.
- `campaign_mapping`: UTM campaign/source/medium to Meta campaign/adset/ad IDs where automatic matching is insufficient.

## Refresh Strategy

Practical default:

- Every 5 minutes: GA4 Realtime API for active/current widgets.
- Every 15-30 minutes: GA4 Data API for current-day aggregate metrics.
- Every 30-60 minutes: Meta insights for current-day campaign spend/performance.
- Daily after data settles: BigQuery daily export or Data API reconciliation for finalized historical metrics.

Dashboard freshness labels should be explicit:

- "Realtime: last 30 min"
- "Today so far: updated HH:mm"
- "Finalized through YYYY-MM-DD"

## Suggested Repository Shape

```text
marketing-dashboard/
  README.md
  .env.example
  package.json
  src/
    dashboard/
      index.html
      app.ts
      styles.css
    ingest/
      ga4.ts
      meta.ts
      normalize.ts
    data/
      schema.ts
  public/
    data/
      dashboard.json
      realtime.json
  scripts/
    fetch-ga4.ts
    fetch-meta.ts
    build-dashboard.ts
  docs/
    DATA_INTEGRATION_PLAN.md
```

## Hosting Options

### Simple client sharing

- Generate static HTML + JSON.
- Host on GitHub Pages, Netlify, Vercel, or Cloudflare Pages.
- Keep secrets in GitHub Actions or hosting provider environment variables.
- Generated data can be published as static JSON if it is safe for clients to see.

### More controlled client sharing

- Use a small serverless backend.
- Dashboard calls `/api/dashboard`.
- API reads from BigQuery, a database, or private object storage.
- Add basic auth, password protection, or client-specific routes.

## Security Notes

- Never expose GA4 service account JSON, OAuth refresh tokens, Meta tokens, or CLI auth files in browser code or GitHub.
- Keep raw data private unless the client is explicitly allowed to see it.
- Prefer read-only permissions for dashboard ingestion.
- Separate "reporting read" credentials from "campaign management write" credentials.

## My Recommendation

Start with a static HTML dashboard backed by scheduled server-side ingestion:

1. GA4 Data API for report-like metrics.
2. GA4 Realtime API for live pulse widgets.
3. Meta Marketing API or official Meta Ads CLI JSON output for spend/performance.
4. BigQuery Export as the production-grade warehouse path once the dashboard proves useful.

This gives a fast MVP while leaving a clean migration path to a more serious warehouse-backed system.
