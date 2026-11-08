# R1 canonical redirect service-level objectives

- Status: Proposed for review
- Scope: R1 Create as Guest, Feature Inventory Batch 1, Order 2
- Related architecture: [R1 production architecture and service boundaries](./r1-production-architecture.md)
- Related API contract: [R1 API contract and internal redirect boundary](../api/r1-api-contract.md)
- Decision owner and initial operator: Founder
- Public contact and escalation: `support@op4n.com`
- Last updated: 2026-11-08

## Purpose

This document defines internal operational service-level indicators (SLIs),
service-level objectives (SLOs), error budgets, release gates, and incident
responses for the R1 system-generated canonical redirect path. These targets
guide design, tests, monitoring, and production decisions. They are not a
customer-facing SLA, uptime promise, or compensation commitment.

The targets are proposals until the founder approves them. They must not be
reported as achieved until the required production telemetry exists, its
correctness has been tested, and a complete measurement window has elapsed.
Load, fault, and baseline results may justify changing the targets through a
reviewed decision; they do not authorize an infrastructure change by themselves.

## Proposed SLO summary

| Objective | SLI | Target | Measurement window |
| --- | --- | --- | --- |
| Request availability | Correct redirect responses for valid active canonical-link requests divided by all valid active canonical-link requests observed at the Worker | At least **99.9%** | Rolling 28 days |
| Public-path availability guardrail | Successful external probes through public `op4n.me` DNS, TLS, edge routing, Worker, lookup, and response divided by scheduled eligible probes | At least **99.9%** | Rolling 28 days; evaluated separately from request availability |
| Redirect latency | Time from Worker request receipt to redirect response headers committed, across correct redirect responses for valid active requests | **p95 ≤ 500 ms** and **p99 ≤ 1,500 ms** | Rolling 28 days, calculated from request-level histogram data |
| Redirect destination correctness | Correct-destination redirect responses divided by all eligible emitted redirect responses | **100.000%**; zero known incorrect-destination responses | Rolling 28 days, with every event handled immediately |

The 99.9% availability target allows a small, explicit failure budget while the
service starts on free tiers with one operator and a single regional database.
The latency targets are intentionally user-focused but leave room for Singapore
round trips, cold starts, and early free-tier variance. They are stricter than
“eventually responds,” but they avoid claiming sub-100-ms performance that the
uncached architecture has not demonstrated. The targets must be reassessed after
the pre-production load test and the first complete production window.

Redirect destination correctness is different from availability: redirecting to
the wrong destination can create security, safety, privacy, and trust harm. It
has no acceptable error budget. A single confirmed incorrect-destination
response is a critical incident even when the availability and latency SLOs
remain green.

## Measured service boundary

The canonical redirect data path is:

```text
public op4n.me DNS → Cloudflare edge TLS and Worker route → redirect Worker
→ authoritative redirect lookup → Supabase Postgres in Singapore
→ Worker commits HTTP 302 response headers
```

The response must include the protected full destination in `Location` and start
with `Cache-Control: no-store`, as defined by the Order 1 architecture.

The primary request-based availability and latency SLIs start when the
Cloudflare Worker receives the request and end when it commits response headers.
This measures Worker execution, redirect lookup, the synchronous database read,
and response construction. It cannot observe failures that prevent a request
from reaching the Worker, so a separate external synthetic guardrail covers
public DNS, TLS, edge routing, and Worker reachability.

The measured redirect path explicitly excludes:

- destination-site DNS, connection, TLS, server, rendering, and download time
  after the browser receives the `302`;
- click-event writes, click aggregation, and public count freshness;
- Latest Links, exact search, dashboards, notifications, reporting, and
  management UI;
- the static `op4n.com` frontend and its GitHub Pages availability.

The redirect latency timer stops when the `302` response headers are committed.
Neither the Worker nor a synthetic SLO probe follows the `Location` header when
measuring Op4n latency. Destination performance must never be attributed to this
SLO, and destination failure does not turn a correct Op4n `302` into an Op4n
redirect failure.

## Request classification

Classification uses the authoritative link state effective at lookup time. It
must be derived from structured telemetry, not inferred later from an aggregate
status code alone.

| Class | Definition | SLO treatment |
| --- | --- | --- |
| Valid active redirect request | A public HTTPS `GET` reaches the canonical code route, the code has the supported canonical format, and the authoritative lookup says the link is active and redirectable at that instant. Public and future Unlisted active canonical links are treated the same. | Included in request availability and latency denominators. |
| Correct redirect response | A valid active request receives HTTP `302`, `Cache-Control: no-store`, and the exact `Location` from the same authoritative lookup result. Response headers are committed before the service timeout. | Availability success and latency sample. Included in both the redirect-destination-correctness numerator and denominator. |
| Incorrect-destination redirect response | For a valid active request with an identifiable authoritative expected destination, the system emits HTTP `302` with a different `Location`. | Availability failure. Included in the redirect-destination-correctness denominator but not its numerator. Opens a critical incident immediately. |
| Availability-only redirect failure | A valid active request receives no response, times out, produces an edge/Worker/lookup exception, returns `5xx`, or returns a non-`302` result. | Availability failure. Not an emitted redirect response, so it is excluded from both redirect-destination-correctness numerator and denominator and is not counted twice as a correctness response. |
| Destination-correct protocol failure | For a valid active request with an identifiable authoritative expected destination, the system emits HTTP `302` with the exact `Location` but violates another required response contract, such as omitting `Cache-Control: no-store`. | Availability failure and not a latency-success sample. Included in both redirect-destination-correctness numerator and denominator because the destination itself is correct. |
| Unverifiable-destination emitted `302` | For a valid active request with an identifiable authoritative expected destination, the system emits HTTP `302` but the emitted `Location` is missing or malformed and cannot be verified as an exact match. | Availability failure. Included in the redirect-destination-correctness denominator but not its numerator; alert as a redirect-response correctness defect. |
| Intentional unknown response | A well-formed code has no canonical record and receives the approved unknown-code response. | Excluded from active-link availability/latency; monitored separately for response correctness and error rate. |
| Intentional disabled response | The authoritative state is disabled, deleted, or otherwise non-redirectable and receives its approved intentional response. | Excluded from active-link availability/latency; monitored separately for response correctness and moderation propagation. |
| Invalid or unsupported request | Malformed code/path, unsupported method, invalid host, or request rejected before canonical lookup. | Excluded from the primary SLO; counted in traffic/security monitoring. |
| Controlled test traffic | Identified load, fault-injection, deployment verification, or synthetic traffic using dedicated test identifiers. | Excluded from production request SLO and reported in its own test results. Synthetic guardrail probes remain included in their separate SLI. |
| Confirmed attack traffic | Traffic positively identified under the security incident procedure, not merely traffic that is inconvenient or slow. | May be excluded only with a dated incident record, bounded interval, evidence, and founder approval. No after-the-fact exclusion to improve an SLO. |

Planned maintenance, provider incidents, free-tier limits, regressions, and
ordinary traffic spikes are not excluded when they affect valid active requests.
A valid user request incorrectly blocked or rate-limited is a failed redirect.
`HEAD` and other methods are outside the initial denominator until their product
contract is explicitly defined; they remain visible in traffic monitoring.

## SLI calculations

### Request availability

For rolling window `W`:

```text
availability(W) = correct_valid_redirect_responses(W) / valid_active_redirect_requests(W)
```

Every included request is counted once. Retries are separate user attempts and
are counted separately. A correct `302` remains an availability success if the
post-response analytics write fails. An incorrect-destination `302` is a failure,
not a success hidden by its status code.

At the Order 1 planning load of approximately 10,000 redirects per day, a
28-day window contains roughly 280,000 requests. A 99.9% objective would permit
approximately 280 failed valid redirects in that illustrative volume. The
request-count formula, not this estimate, is authoritative when traffic differs.

### Public-path synthetic availability

For rolling window `W`:

```text
probe_availability(W) = successful_eligible_probes(W) / scheduled_eligible_probes(W)
```

An external probe resolves public DNS, establishes TLS, requests a dedicated
active canonical test link without following the destination, and verifies the
exact expected `302`, `Location`, and `Cache-Control`. Run at least every five
minutes. Two geographically separate probe locations are recommended to reduce
single-vantage blind spots, but the founder must review tool cost and operating
load. If R1 launches with only one low-cost probe, that limitation must be
recorded and the SLO must not be described as multi-region availability.

Probe maintenance windows are excluded only when scheduled before the event and
recorded. Cloudflare DNS, TLS, route, Worker, lookup, or database failures are
not excluded. A probe system outage is reported as missing data, not silently
treated as success or service failure.

### Latency

Record a monotonic duration at the Worker from request receipt to response-header
commit for every correct redirect response to a valid active request. Export a
histogram capable of calculating p95 and p99 across raw request distributions.
Do not average per-host or per-interval percentiles.

Both latency conditions must pass over the rolling 28-day window:

```text
p95(worker_to_headers_ms) <= 500
p99(worker_to_headers_ms) <= 1500
```

Equivalently, no more than 5% of correct-response samples may exceed 500 ms and
no more than 1% may exceed 1,500 ms. Availability-only failures and timed-out
requests remain in the availability SLI and error monitoring; they are not
converted into artificial latency samples. A separate timeout counter prevents
latency percentiles from looking healthy while requests fail.

When a window contains fewer than 1,000 correct redirect responses for valid
active requests, mark the latency SLO as insufficient data rather than passing
it. Use synthetic timings and load-test evidence as supporting signals, not
substitutes for the request distribution.

### Redirect destination correctness

For rolling window `W`:

```text
redirect_destination_correctness(W) =
  correct_destination_redirect_responses(W) /
  eligible_emitted_redirect_responses(W)
```

An `eligible_emitted_redirect_response` is every HTTP `302` the system emits for
a valid active request when the authoritative expected destination is
identifiable from the lookup result. The denominator includes correct responses,
incorrect-destination responses, destination-correct protocol failures, and any
other emitted `302` whose `Location` cannot be verified as an exact match. The
numerator includes every response whose emitted `Location` exactly matches that
authoritative expected destination, even if a separate response-contract defect
makes it an availability failure.

Missing responses, timeouts, `5xx`, and non-`302` responses remain availability
failures. They are not emitted redirect responses, so they are excluded from
both correctness terms rather than being counted again in this SLI.

The Worker must construct `Location` from the same lookup result used to record
the decision. Correctness telemetry should compare a non-reversible fingerprint
of the selected authoritative destination/version with a fingerprint of the
emitted `Location`; it must not log full protected destinations, query strings,
fragments, credentials, or secrets. The dedicated synthetic link also verifies
an exact expected location without following it.

Any mismatch, stale-code reuse, response for the wrong record/version, or
confirmed redirect to a destination other than the authoritative result is an
incorrect-destination response. Monitoring gaps are not proof of correctness;
the 100% target is enforceable only after the fingerprint/counter and synthetic
checks are implemented and tested.

One incorrect-destination response makes the numerator at least one smaller than
the denominator, so correctness is strictly below 100% for every non-empty
window containing that response. It also opens a critical incident immediately;
the rolling percentage never delays or suppresses that response.

## Error budgets

### Availability budget

For a 99.9% request-availability target in window `W`:

```text
allowed_failed_requests(W) = floor(valid_active_requests(W) * 0.001)
remaining_budget(W) = allowed_failed_requests(W) - failed_redirects(W)
budget_consumed(W) = failed_redirects(W) / max(allowed_failed_requests(W), 1)
burn_rate(interval) = observed_failure_fraction(interval) / 0.001
```

The synthetic guardrail has a separate probe-count budget calculated with the
same 0.1% fraction. Do not combine probe failures and production request counts
into one denominator. At a five-minute cadence, one probe location schedules
8,064 probes in 28 days and has a budget of about eight failed probes; two
locations schedule 16,128 and have a budget of about sixteen.

Redirect destination correctness has no error budget. Latency tail budgets are
the allowed 5% above 500 ms and 1% above 1,500 ms; both are reviewed
independently from availability. Error budgets reset only by natural movement
of the rolling window, never by deleting telemetry, changing labels, or
reclassifying user-impacting traffic.

### Budget response policy

| Condition | Required response |
| --- | --- |
| Fast burn: at least 10× availability burn over one hour with at least 100 valid requests, or two consecutive external probe failures | Alert the founder immediately, pause redirect-path deployments, check DNS/TLS/Worker/lookup/database health, and open an incident if impact continues. Low traffic relies on the synthetic signal rather than declaring a pass. |
| Warning: at least 2× burn over 24 hours, at least 50% of the 28-day budget consumed, or either latency tail budget is at least 50% consumed | Freeze nonessential redirect changes, investigate in the next operator session, review recent deployments and saturation, and prepare rollback or mitigation. |
| Exhausted: more than 100% of availability or latency budget consumed | Stop feature releases that touch the redirect path or its synchronous dependencies. Open an incident, restore the last known-good state or mitigate safely, document the cause, and require founder review before resuming those releases. |
| Incorrect-destination response | Treat as a critical incident immediately regardless of budget. Stop redirect-related releases, preserve evidence without exposing destinations, disable the affected code or use the safest bounded containment, verify no other codes are affected, correct/roll back, and complete an incident review before resuming. |

Release freezes apply to the redirect path and its synchronous dependencies;
they do not require unrelated documentation or safety work to stop. A freeze
does not authorize an unreviewed cache, queue, paid plan, region, or provider
change. Emergency containment must be the smallest safe, auditable action.

Because the founder is the sole initial operator, alerts route to the single
monitored operational path owned by the founder, with `support@op4n.com` as the
central escalation contact. R1 has no claim of staffed 24×7 response. The
founder must review monitoring hours, notification delivery, and a realistic
acknowledgement target before production; absence of staffing must not be hidden
inside the availability calculation.

## Monitoring requirements

Monitoring must be outside the response-critical path. Dashboard, alert, log,
or notification failure must never block a valid redirect. A prolonged telemetry
gap blocks claims of SLO compliance and should block redirect-path releases until
measurement is restored or an explicit founder exception is recorded.

| Signal | Required measurements and alerts |
| --- | --- |
| Latency | Worker-to-response-header histogram; p50 for diagnosis, SLO p95 and p99; lookup duration; timeout count; cold-start or initialization signal where the platform exposes it. |
| Traffic | Total requests, valid active requests, correct redirect responses, correct-destination responses, eligible emitted redirect responses, incorrect-destination responses, intentional unknown/disabled responses, invalid requests, methods, rate-limited requests, synthetic probes, and requests per minute. Do not label with full code or destination. |
| Errors | `5xx`, Worker exceptions, lookup/database timeout and error, non-`302` active-link response, destination-correct protocol failure, unverifiable-destination emitted `302`, missing required headers, incorrect-destination response, and failure rate by bounded outcome class. |
| Saturation | Cloudflare Worker CPU/subrequest/other enforced limit utilization; Supabase backend concurrency/cold starts where exposed; Postgres connections, CPU, memory, I/O, slow queries, storage, and free-tier quota utilization. Concrete alert thresholds must follow provider capabilities and load-test baselines rather than guessed limits. |
| Redirect destination correctness | Counters for correct-destination responses and all eligible emitted redirect responses; incorrect-destination counter; destination/version fingerprint mismatch; unverifiable-destination emitted `302`; synthetic exact-location mismatch; stale or reused-code invariant violation; and moderation-state mismatch. Any incorrect-destination event alerts immediately and must reduce the calculated correctness below 100%. |
| Dependency isolation | Separate health signals for analytics writes/aggregation, Latest Links, exact search, dashboard, notifications, reporting, and management UI. Their failure is visible but must not change redirect availability or latency results when the `302` is correct. |
| Telemetry health | Missing metrics, dropped logs/events, probe scheduler gaps, alert-delivery test, clock skew, and dashboard freshness. Missing data is shown explicitly, never filled as success. |

Retain aggregated SLI data for at least the current 28-day window plus seven
days for review, subject to the separate analytics data-minimization and
retention decision. Use bounded outcome labels and request correlation IDs;
avoid raw IP/device data, full destinations, query strings, fragments, link
codes, report details, or other high-cardinality/sensitive labels.

## Dependency isolation and analytics behavior

The only synchronous redirect dependencies are the Cloudflare Worker, redirect
lookup boundary, and Supabase Postgres described by Order 1. The following must
remain outside the response-critical path:

- click-event write and aggregate-count update;
- Latest Links and exact search;
- dashboards, logging export, alerts, and notification delivery;
- reporting and management UI;
- static `op4n.com` frontend availability.

For a valid active link, the Worker commits the correct `302` without waiting
for analytics. The post-response click write uses the platform's request-lifetime
extension mechanism. An analytics write failure increments a separate error
signal and may create a known count gap under the no-queue architecture, but it
does not turn the correct redirect into an availability failure or extend the
redirect latency timer. Fault-injection tests must prove this behavior.

The Product Plan says every successful redirect records a click event. Order 1
also intentionally prioritizes redirect availability during analytics failure
and starts without a durable queue. Until reliability evidence justifies a
reviewed queue decision, analytics gaps during an outage are a documented R1
limitation and must be observable rather than concealed.

## Release and incident gates

The SLO becomes enforceable for production reporting only after all of the
following are true:

1. Worker request/outcome, duration histogram, timeout, correct-destination
   numerator, eligible-emitted-response denominator, and incorrect-destination
   instrumentation are implemented and validated against known cases.
2. An external synthetic probe validates DNS, TLS, edge routing, exact `302`,
   expected `Location`, and `Cache-Control` without following the destination.
3. Alert delivery to the founder is tested; the dashboard displays missing data
   explicitly and is not a redirect dependency.
4. A representative load test passes at the Order 1 expected profile and at the
   100,000-redirects/day spike profile, with results reported separately from
   production SLIs.
5. Fault injection proves analytics, Latest Links, exact search, dashboard,
   notification, and management UI failures do not block or slow a correct
   canonical redirect.
6. Unknown, disabled, lookup timeout, database failure, Worker exception, and
   incorrect-destination detection/containment exercises produce the intended
   outcome and alert.
7. Rollback of the Worker and compatible backend/lookup changes is rehearsed.

Do not claim the availability, latency, or correctness targets are met before
these gates pass. After launch, review the first 7 days as an early baseline and
the first complete 28-day window as the initial SLO decision checkpoint.

If load tests or production evidence fail the proposed targets, review the
measurement first, then query/connection behavior, timeouts, code, and platform
limits. A paid Supabase/Cloudflare tier, dedicated cache, durable queue, or
architecture change is a proposal for founder review with cost, failure-mode,
security, migration, and rollback analysis. This Order 2 document does not
authorize or implement any of them.

## Assumptions and limitations

- R1 plans for approximately 1,000 new links per day, about 10,000 redirects per
  day, and a 100,000-redirects/day spike test, as recorded in Order 1.
- Cloudflare and Supabase begin on low-cost/free tiers. Provider quotas, cold
  starts, metric availability, retention, and support may constrain both service
  behavior and observability.
- Supabase Postgres in Singapore is the authoritative regional data dependency;
  the uncached redirect lookup has no regional database failover in Order 1.
- There is no dedicated cache or durable queue until evidence and a reviewed
  decision justify one.
- The founder is the sole initial operator. Alert fatigue, sleep, travel, and
  unavailable 24×7 coverage are real operational risks, not SLO exclusions.
- Early low volume can make short-window percentiles and failure ratios noisy.
  Synthetic probes and controlled load tests supplement but do not replace
  production request SLIs.
- Free-tier monitoring may not expose every desired saturation metric. Missing
  metrics must be documented; unavailable measurements cannot be presented as
  passing.
- DNS/TLS failures before Worker receipt are invisible to Worker request metrics
  and require the external synthetic guardrail.

## Founder review decisions

Before production, the founder should explicitly approve or revise:

1. 99.9% request and synthetic availability over rolling 28 days.
2. p95 at 500 ms and p99 at 1,500 ms for Worker receipt to response headers.
3. 100% redirect destination correctness with zero tolerance for incorrect
   destinations.
4. One versus two external probe locations and the acceptable monitoring cost.
5. Monitoring hours, alert channels, and an achievable incident acknowledgement
   target for a one-person operation.
6. Whether free-tier quotas and observed load-test headroom are sufficient for
   the release profile.
7. The first 7-day baseline and 28-day checkpoint process for adjusting targets.

Approval changes this record's status; it does not change live infrastructure.

## Acceptance-criteria traceability

| Criterion | Evidence in this record |
| --- | --- |
| Redirect success-rate and latency SLIs have target SLOs and measurement windows. | Proposed SLO summary and SLI calculations define 99.9% availability, p95/p99 latency targets, and rolling 28-day windows. |
| Analytics write failure does not block or slow a valid redirect. | Measured boundary, dependency isolation, separate analytics signal, and required fault injection keep the write post-response. |
| Latest Links, search, and dashboard outages do not break canonical lookup. | Dependency isolation explicitly removes discovery, dashboard, notifications, and management UI from the synchronous path and release tests verify it. |
| Monitoring covers latency, traffic, errors, saturation, and incorrect-destination responses. | Monitoring requirements define each signal, telemetry health, and immediate correctness alerting. |
| Error-budget breach has an explicit release or incident response. | Budget response policy defines fast-burn, warning, exhausted-budget, and incorrect-destination actions. |
| The document remains consistent with Product Plan and Order 1. | Canonical `302`, `no-store`, public/Unlisted active behavior, intentional unknown/disabled states, Singapore Postgres, no initial cache/queue, and founder ownership are preserved. |
