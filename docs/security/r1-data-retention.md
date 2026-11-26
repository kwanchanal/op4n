# R1 analytics data minimization and retention

- Status: Proposed for founder confirmation (see [Pending decisions](#pending-decisions))
- Scope: Feature Inventory R1, "Define analytics data minimization and retention"
- Decision owner: Founder
- Last updated: 2026-11-19
- Related: [database schema](../architecture/r1-database-schema.md), [API contract](../api/r1-api-contract.md), [secrets and access](r1-secrets-and-access.md)

## Principles

R1 collects the minimum needed to redirect correctly, count clicks, limit
abuse, and moderate reports. Public cards expose only the aggregate total
clicks. Query strings, fragments, tokens, cookies, `Authorization` headers,
`Idempotency-Key` values, and full session identifiers are never written to
analytics events or application logs.

## Field inventory

| Store | Field | Purpose | Retention | Access | Deletion mechanism |
| --- | --- | --- | --- | --- | --- |
| `click_events` | `link_id`, `destination_version_id` | Attribute a successful redirect to its link and destination version | 30 days rolling, by server `recorded_at` | Service role only | `purge_expired_click_events_v1()` via daily pg_cron job `op4n_purge_expired_click_events`, only after the event is counted in the aggregate |
| `click_events` | `ingestion_key` (Worker event UUID) | Deduplicate retries so a click is counted once | 30 days rolling | Service role only | Same job |
| `click_events` | `occurred_at`, `recorded_at` | Bounded clock-skew check; retention clock | 30 days rolling | Service role only | Same job |
| `click_events` | `counted_aggregate_version` | Proves the event was counted before deletion | 30 days rolling | Service role only | Same job |
| `click_aggregates` | `total_clicks`, `aggregate_version`, `last_event_at` | Public aggregate count and reconciliation | Life of the link; never decreases | Service role; `total_clicks` is projected publicly | Not deleted in R1 |
| Rate-limit counters (rate-limit cards) | HMAC-SHA-256 of client IP with a daily rotating key, window, count | Fair use and abuse limits | At most 24 hours | Service role only | Scheduled cleanup |
| `reports` (report cards) | `reason_code`, `report_detail`, `workflow_state`, timestamps | Moderation | Report detail 12 months after resolution | Founder/Admin only | Scheduled deletion of `report_detail` |
| Cloudflare Workers Logs (`op4n-redirect-*`, `op4n-notifier-*`) | Structured lines from `log.mjs`: ts, env, service, event, outcome, severity, requestId, short code | Operations | Free plan: 3 days per the Workers Logs docs; Cloudflare's newer unified pricing lists 7 days from 2026-12-01. Treat 3 days as the guaranteed window. | Founder (Cloudflare account) | Provider expiry |
| Supabase Edge Function logs (`op4n-api`) | Structured lines from `log.mjs`: ts, env, service, event, outcome, severity, requestId, operation, status | Operations | Free plan: about 1 day, and cut to 1 hour if the log-query allowance is exceeded. Not drainable on Free. | Founder (Supabase account) | Provider expiry |
| `moderation_actions`, `feature_flag_audit`, `creation_audit_events` | Actor label, action, reason, time | Security and moderation audit | Life of the record (append-only) | Service role; Admin views | Not deleted in R1 |

Logging rules (Order 80): every server and Worker log line goes through
`supabase/functions/_shared/log.mjs`. It replaces values whose keys can carry
secrets (destination, URL, token, cookie, authorization, idempotency key,
password, email, IP, subject), keeps only the origin of any URL found in text,
and escapes control characters. `tests/server/log.test.mjs` enforces this and
fails if any server file calls `console.*` directly. Provider retention was
checked on 2026-11-27 ([Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
[Cloudflare Observability pricing](https://developers.cloudflare.com/observability/pricing/),
[Supabase logs usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs-query));
recheck both dashboards at the Production cutover.

Not collected anywhere in R1: raw IP address, user-agent string, referrer,
device identifier or fingerprint, precise or coarse location, cookies, and the
destination query string or fragment in any analytics or log record. The
redirect Worker logs only an event name and the short code, never the
destination. HEAD requests are not counted as clicks.

## Backups

Database backups contain the same fields. A deleted click event or report
detail ages out of backups when the backup itself expires under the backup
retention set by the "Define backup, restore, RPO, and RTO" card. Restores
must re-run the retention job before the restored database serves traffic.

## Verification

- `tests/server/migration-pglite.test.mjs` runs the migrations in Postgres and
  asserts that `click_events` has no IP, user-agent, referrer, device, or
  location column; that retention deletes only expired, counted events; and
  that `total_clicks` never decreases.
- `tests/server/redirect-worker.test.mjs` asserts that click events contain
  exactly `eventId`, `canonicalCode`, `destinationVersion`, and `occurredAt`.

## Pending decisions

- Report detail retention: 12 months after resolution is proposed.
- Rate-limit counter retention: 24 hours is proposed.

Implementation cards use these defaults as configuration until the founder
confirms or changes them. The Privacy Notice card links to this document.
