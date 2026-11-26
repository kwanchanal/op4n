# R1 product success metrics and release gates

Feature Inventory Order 92. Metrics are computed server-side from existing
tables (`public.r1_metrics_v1(from, to)`, service role only) and from the
structured logs. No client tracking, no destinations, no personal identifiers.

Run weekly in the Supabase SQL Editor:

```sql
select public.r1_metrics_v1(now() - interval '7 days', now());
```

Request-level rates come from the `api_request` log events (Supabase → Edge
Functions → op4n-api → Logs), filtered by `operation` and `status`.

## Definitions

| Metric | Definition | Denominator | Source | Owner | Threshold |
| --- | --- | --- | --- | --- | --- |
| Creation success rate | `api_request` with operation `createGuestCanonicalLink` and status 201 | All `createGuestCanonicalLink` requests except 400/422 (user input) | Logs | Founder | ≥ 99% weekly |
| Rate-limited share | Status 429 on create | All create requests | Logs | Founder | Watch above 5% (tune limits) |
| Blocked share | Status 422 `DESTINATION_BLOCKED` | All create requests | Logs | Founder | Watch above 5% (abuse wave) |
| Server error rate | Status ≥ 500 on any public operation | All public requests | Logs | Founder | < 1% weekly; pause trigger below |
| Redirects | `clicksRecorded` | — | `r1_metrics_v1` | Founder | Trend only |
| Redirect latency | p95 / p99 Worker duration for 302 responses | Valid active-link requests | Cloudflare Workers analytics | Founder | p95 ≤ 500 ms, p99 ≤ 1,500 ms (SLO) |
| Destination correctness incidents | Confirmed wrong-destination redirects | — | Runbook log | Founder | **0** (any one is critical) |
| Reports per 1,000 links | `reportsPer1000Links` | Links created in the window | `r1_metrics_v1` | Founder | Watch above 20 |
| Time to first moderation action | `medianHoursToFirstModerationAction` (triage, resolve, or disable) | Reports with an action | `r1_metrics_v1` | Founder | ≤ 24 h for S1, ≤ 72 h overall |
| Unsafe-link rate | `linksDisabledForSafety` | `linksCreated` | `r1_metrics_v1` | Founder | Pause trigger below |
| Withheld-from-discovery share | `linksWithheldFromDiscovery` | `linksCreated` | `r1_metrics_v1` | Founder | Trend only (rule tuning) |
| Registered-preview clicks | — | — | Not instrumented in R1 (N/A) | — | — |
| Guest → Registered conversion | — | — | Deferred to R2 (N/A) | — | — |
| Paste-to-copy time | — | — | PENDING founder decision (client event needed) | — | — |

## Pause and rollback conditions

Use the kill switches in `runbooks/README.md`. Valid redirects keep working.

| Condition | Action |
| --- | --- |
| Unsafe-link rate above 2% of links created in a day, or 3+ confirmed phishing links in a day | Pause `latest_links` and `public_search`; follow `runbooks/abuse-campaign.md` |
| Open S1 case older than 24 hours (daily alert) | Triage before anything else |
| Server error rate above 5% for 30 minutes | Pause `guest_creation`; follow `runbooks/redirect-outage.md` or `database-incident.md` |
| Any destination-correctness incident | `runbooks/wrong-destination.md` immediately |
| A release raises any rate above its threshold | Roll back the frontend and API to the previous release (`r1-cicd-and-rollback.md`) |

## Completion versus success

Implementation is complete when every Feature Inventory card is Done. R1 is
successful only when, over the first 4 weeks: creation success ≥ 99%, zero
destination-correctness incidents, redirect SLO met, S1 reports triaged within
24 hours, and the unsafe-link rate stays under its pause threshold.
