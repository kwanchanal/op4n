# R1 capacity report

Feature Inventory Order 86. Load test against Staging only, 2026-11-27, with
`tests/load/staging-load.mjs` from a single client in Thailand. Staging runs
the same Worker and Edge Function code as Production, on Supabase Free
(Singapore) and Cloudflare Workers Free.

## Results

| Scenario | Requests | Concurrency | Throughput | Status codes | p50 | p95 | p99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| First request (cold path) | 1 | 1 | — | 302 | 266 ms | — | — |
| Steady redirects | 300 | 5 | 42.9 req/s | 302 × 300 | 112 ms | **148 ms** | **223 ms** |
| Hot single link burst | 200 | 25 | 107.9 req/s | 302 × 200 | 163 ms | 629 ms | 673 ms |
| Random unknown codes | 150 | 10 | 82.8 req/s | 404 × 150 | 107 ms | 139 ms | 259 ms |
| Latest Links reads | 100 | 5 | 21.7 req/s | 200 × 100 | 215 ms | 272 ms | 293 ms |
| Creation at the rate limit | 8 | 1 | — | 201 × 4, 429 × 4 | 143 ms | 303 ms | — |

Correctness: 501 successful redirects, **501 clicks counted** (exactly once
each), **0 wrong destinations**, 0 unknown codes redirected. The rate limiter
allowed the remaining per-minute budget and then returned 429.

A cold Edge Function measured about 2.2 s on 2026-11-26; the Worker's 5 s
lookup bound absorbs it, and every cold request still redirects.

## Against the SLO

| SLO | Target | Measured | Result |
| --- | --- | --- | --- |
| Redirect latency p95 | ≤ 500 ms | 148 ms steady | Pass |
| Redirect latency p99 | ≤ 1,500 ms | 223 ms steady; 673 ms under a 108 req/s hot burst | Pass |
| Destination correctness | 100% | 100% (0 / 501 wrong) | Pass |

The R1 targets are small in request-rate terms: 10,000 redirects/day averages
0.12 req/s, and the 100,000/day spike averages 1.2 req/s (perhaps 10–20 req/s
at a viral peak). The tested 43–108 req/s is well above both. Latency rises
under a 25-way burst on one link (p95 629 ms), which is the first saturation
signal; it is still inside the p99 target.

## Quota extrapolation (pass/fail per provider)

From `r1-quotas.md`: each redirect costs 1 Worker request and 2 Edge Function
invocations.

| Provider | 10,000 redirects/day | 100,000-redirect spike day |
| --- | --- | --- |
| Cloudflare Workers Free (100,000 requests/day) | Pass (~11%) | **Fail**: the spike alone reaches the daily limit |
| Supabase Free Edge Functions (500,000/month) | **Fail**: ~716,000/month | **Fail**: 200,000 in one day |
| Supabase Free database (500 MB) | Pass: click events are kept 30 days (about 300,000 rows at target) | Pass |
| Postgres CPU / connections | Pass at the tested rates (no errors, flat latency) | Not tested at sustained spike rate |

## Bottlenecks and headroom

1. **Free quotas, not performance, are the first limit.** The code handles far
   more traffic than the Free plans allow.
2. Each redirect makes two Edge calls; recording clicks without the second call
   would halve invocations.
3. A single hot link under heavy concurrency raises latency (p95 629 ms at 108 req/s).

**Recommendation to Order 95 (go/no-go):** performance is ready. Capacity on
Free tiers is not ready for the stated targets. Before a public launch, the
founder approves either Supabase Pro + Workers Paid, or a private beta on Free
with the daily quota alerts as the upgrade trigger.
