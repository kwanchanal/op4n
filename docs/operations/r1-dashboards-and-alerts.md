# R1 dashboards and alerts

Feature Inventory Order 82. One owner for everything: the founder. Every alert
reaches support@op4n.com.

## Where each view lives

| Signal | Where | How to read it |
| --- | --- | --- |
| Redirect traffic and status codes | Cloudflare → Workers & Pages → `op4n-redirect-<env>` → Metrics | Requests, errors, CPU time; 5xx means the lookup failed closed |
| Redirect latency | Same → Metrics → Wall time p50/p99 | Compare with the SLO (p95 ≤ 500 ms, p99 ≤ 1,500 ms) |
| Worker logs | Same → Logs (Workers Logs, 3 days) | Filter `event = redirect_lookup_failed`, `click_record_failed`, `redirect_integrity_failed` |
| Edge Function errors | Supabase → Edge Functions → `op4n-api` → Logs / Invocations | Filter `api_request` with `status >= 500`; `api_unhandled_error` |
| Creates, 429 and 422 rates | Supabase Edge Function logs | `operation = createGuestCanonicalLink` grouped by `status` |
| Open reports and oldest report age | Admin → Reports queue (sorted by severity, then age) | S1 older than 24 h also triggers an alert |
| Product and safety metrics | SQL: `select public.r1_metrics_v1(now() - interval '7 days', now());` | See `r1-metrics.md` |
| Database size, connections, CPU | Supabase → Reports → Database | Size is also in the daily ops check |
| Free-quota use | Supabase → Usage; Cloudflare → Workers analytics; daily ops check | See `r1-quotas.md` |
| Synthetic redirect and site uptime | UptimeRobot dashboard | 5-minute checks |
| Readiness | `GET /api/v1/internal/health/ready` with the service credential | Names the failing layer |

## Alerts

| Alert | Threshold | Channel | Runbook action |
| --- | --- | --- | --- |
| Synthetic redirect down | 2 consecutive failed 5-minute checks of `https://op4n.me/SYNTHETIC1` (expects 302 to op4n.com) | UptimeRobot → support@op4n.com | `runbooks/redirect-outage.md` |
| Frontend down | Keyword "Make Link" missing on `https://op4n.com/` for 2 checks | UptimeRobot → support@op4n.com | `runbooks/provider-outage.md` |
| Staging redirect down | Same checks for `staging.op4n.me/SYNTHETIC1` | UptimeRobot → support@op4n.com | `runbooks/redirect-outage.md` |
| Worker 5xx above 2% for 10 minutes | Cloudflare notification where the plan supports it; otherwise covered by the synthetic check | Cloudflare → support@op4n.com | `runbooks/redirect-outage.md` |
| Open S1 report older than 24 h | Daily ops check (01:07 UTC) | Founder digest → support@op4n.com | `runbooks/abuse-campaign.md` |
| Free-quota warning / critical | 70% / 90% of Supabase invocations or database size | Founder digest → support@op4n.com | `r1-quotas.md` |
| Founder digest delivery exhausted | 3 failed sends | Worker log `founder_notification_exhausted` (read weekly) | `runbooks/provider-outage.md` |
| Nightly backup failed | GitHub Actions failure email | GitHub → support@op4n.com (notification email) | `r1-backup-restore.md` |

A monitor failure differs from an application failure: if UptimeRobot reports
the synthetic redirect down, open `https://op4n.me/SYNTHETIC1` yourself and
call readiness. If both work, the monitor (or its network) is at fault; if
readiness names a failing check, the application is.

## UptimeRobot setup (founder, one time)

1. Create a free UptimeRobot account with alert contact support@op4n.com.
2. Monitors (HTTP(s), 5-minute interval):
   - `https://op4n.com/` — keyword "Make Link" must exist.
   - `https://op4n.me/SYNTHETIC1` — Advanced: do not follow redirects; expected status 302.
   - `https://staging.op4n.me/SYNTHETIC1` — same.
3. Send a test alert from each monitor and record that it arrived (Order 81/82 Results).
4. PENDING (non-blocking): choose a mobile push destination.
