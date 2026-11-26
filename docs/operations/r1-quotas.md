# R1 provider quotas, budgets, and alerts

Feature Inventory Order 83. Target: $0/month at launch; warn at 70% of a free
quota, critical at 90%; upgrade only with founder approval when measured use
or reliability requires it. Limits checked on 2026-11-27; re-check each
provider page before the Production cutover.

## Quota inventory

| Provider | Resource | Free limit | Source | Alert |
| --- | --- | --- | --- | --- |
| Supabase | Edge Function invocations | 500,000 / month | [Supabase pricing](https://supabase.com/pricing) | Daily ops check: 70% warning, 90% critical (estimate) |
| Supabase | Database size | 500 MB per project | [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) | Daily ops check: 70% / 90% (exact, `pg_database_size`) |
| Supabase | Egress | 5 GB / month | [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase) | Weekly manual check (Usage page) |
| Supabase | Log ingest | 1 GB / month | [Supabase logs usage](https://supabase.com/docs/guides/platform/manage-your-usage/logs) | Weekly manual check |
| Supabase | Inactivity pause | Paused after inactivity | Supabase dashboard | Prevented by 5-minute UptimeRobot checks |
| Cloudflare Workers | Requests | 100,000 / day (resets 00:00 UTC) | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Weekly manual check; Cloudflare notification when available on the plan |
| Cloudflare Workers | CPU time | 10 ms / invocation | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Error 1102 in Worker logs |
| Cloudflare Workers | Subrequests | 50 external / invocation | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Redirect uses 2 (lookup + click) |
| Cloudflare Workers Logs | Log events | 200,000 / day, 3-day retention | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Weekly manual check |
| Cloudflare Pages | Static requests and bandwidth | Unlimited on Free; 500 builds / month | Cloudflare Pages docs | Deploys are rare |
| Cloudflare Email Routing / sending | Founder digest to a verified address | Free; low volume | Cloudflare Email docs | Digest exhaustion alert (Worker logs) |
| UptimeRobot | Monitors | 50 monitors, 5-minute interval | UptimeRobot pricing | — |
| Safety screening provider (Order 47) | Lookups | Set when the provider is chosen | — | Add to this table at launch |

The daily ops check (`ops_daily_checks_v1`, triggered by the notifier Worker
at 01:07 UTC) emails a `quota_warning` or `quota_critical` alert through the
founder digest to support@op4n.com. Its invocation figure is a lower bound:
public reads are not recorded. Weekly, the founder also reads the Supabase
Usage page and Cloudflare Workers analytics and records both numbers.

Staging test of the alerts: `select public.ops_daily_checks_v1('staging', 1000, 524288000);`
forces a critical alert with a tiny quota; the next digest email shows it.

## Request budget at the R1 targets

Per redirect: 1 Worker request and 2 Edge Function invocations (lookup, then
click recording). Background load: notifier every 5 minutes (288/day), the
synthetic monitor every 5 minutes (288 Worker requests and 576 invocations a
day), and the daily check.

| Load | Worker requests / day | Edge Function invocations / month | Workers Free (100,000/day) | Supabase Free (500,000/month) |
| --- | --- | --- | --- | --- |
| Target: 10,000 redirects/day, 1,000 creates/day, ~2,000 public reads/day | ~10,600 | ~ (20,000 + 1,000 + 2,000 + 864) × 30 ≈ **716,000** | Pass (11%) | **Fail (143%)** |
| Spike day: 100,000 redirects | ~100,600 | +200,000 in one day | **Fail (at the limit)** | Contributes 40% of the monthly quota in a day |

**Result handed to Order 95 (launch go/no-go):** Supabase Free does not cover
the R1 target, and Workers Free does not cover the spike. Options for the
founder's decision:

1. Upgrade Supabase to Pro (2,000,000 invocations/month included) and Workers
   to Paid (10,000,000 requests/month included) before public launch.
2. Reduce invocations: record clicks without a second Edge call (for example
   batching clicks from the Worker through a queue), roughly halving
   invocations to ~400,000/month. Still close to the limit.
3. Launch as a private beta under the Free limits and upgrade when the daily
   check warns.

Hard-limit behavior (never an incorrect redirect):
- Supabase invocations exhausted: the lookup fails, and the Worker shows the
  503 unavailable page with no `Location`.
- Workers requests exhausted: Cloudflare returns its own error page for
  op4n.me; no redirect happens.
- Database full: writes fail. Creation and reports return 503; existing
  redirects keep working while reads succeed.
