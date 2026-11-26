# R1 dependency failure matrix

How each R1 surface behaves when one dependency fails. Feature Inventory
Order 85. Every row is asserted by `tests/server/failure-matrix.test.mjs`.
Bounds live in `supabase/functions/_shared/timeouts.mjs`.

Rule: creation and other safety-sensitive writes fail closed. A valid redirect
keeps working unless the lookup itself cannot answer. Analytics, discovery,
and email never block a redirect.

| Dependency fails | Bound | Redirect (`op4n.me/CODE`) | Create | Latest Links / search | Report | Log event |
| --- | --- | --- | --- | --- | --- | --- |
| Database down | 3.5 s per RPC, one attempt | 503 unavailable page, no `Location`, no-store | 503 `DEPENDENCY_UNAVAILABLE` | 503 | 503 | `api_request` (503), `redirect_lookup_failed` |
| Redirect lookup slow (includes Edge cold start) | 5 s | 503 unavailable page, no `Location` | — | — | — | `redirect_lookup_failed` |
| Clicks endpoint down | 3 s, one retry with the same event ID | 302 unaffected | — | — | — | `click_record_failed` |
| Safety provider down or slow | 3 s | Unaffected | 503, nothing written | — | — | `api_request` (503) |
| Rate limiter down | Database bound | Unaffected (redirects never use the limiter) | 503 | 503 | 503 | `api_request` (503) |
| Email provider down | — | Unaffected | Unaffected | Unaffected | 202 accepted; the outbox retries at 5 and 20 minutes and alerts after 3 failures | `founder_notification_send_failed`, `founder_notification_exhausted` |
| Feature-flag table down | Database bound | Unaffected (redirects never read flags) | Paused (503 `FEATURE_UNAVAILABLE`) | Paused | Paused | `api_request` (503) |
| Supabase Auth JWKS down | 3 s | Unaffected | Unaffected | Unaffected | Unaffected | `admin_request` (503) |

No user-facing path retries an upstream call. The single exception is the
click recording retry, which happens after the 302 has been sent.

Recovery needs no manual step. Each request makes a fresh attempt, and the
feature-flag cache refetches on the next read after the 30-second window.

The redirect bound (5 s) is larger than the database bound (3.5 s), so a slow
database surfaces as the API's own 503 rather than a Worker abort. A cold
Edge Function measured about 2.2 s on Staging on 2026-11-26; that is why the
bound is 5 s and not 2 s.
