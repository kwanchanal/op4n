# R1 threat model and security verification

Feature Inventory Order 94. Internal STRIDE review of everything R1 ships, done
after discovery and Admin existed. External penetration testing is deferred
until before a wider public launch (DECIDED). Reviewed 2026-11-27.

## Assets

| Asset | Why it matters |
| --- | --- |
| Code → destination mapping | A wrong redirect sends people to the wrong site (zero error budget) |
| Full destinations | May contain private paths or tokens; never public |
| Domain reputation of op4n.me / op4n.com | Abuse gets the domain blocklisted for every user |
| Moderation state and audit history | Evidence for disable/restore decisions |
| Secrets: Supabase secret key, internal service credential, HMAC key, Cloudflare/Supabase deploy tokens | Full backend control |
| Founder Admin account (password + TOTP) | Can reveal destinations and disable links |
| Report detail and support email | Personal data under PDPA |

## Actors

Anonymous visitors and Guests; abusers (phishers, spammers, scrapers,
enumerators); the founder (Admin); the redirect and notifier Workers
(internal service identity); providers (Cloudflare, Supabase, email).

## Entry points and STRIDE

| Entry point | Threats (STRIDE) | Mitigations | Verified by |
| --- | --- | --- | --- |
| `POST /api/v1/links` (create) | **S/T** forged origin; **T** hostile title or URL; **D** bulk creation; **E** shortening internal or private-network URLs; link chains via short links | CORS allowlist, JSON-only (415 for forms), UUID idempotency, destination policy (HTTP(S) only, no credentials, no private/loopback/metadata hosts, no short hosts incl. trailing dot), safety screening fails closed, per-IP HMAC rate limits + global ceiling, kill switch | `security.test.mjs` (fuzz, CORS), `destination-policy.test.mjs`, `destination-parity.test.mjs`, `failure-matrix.test.mjs`, Staging smoke burst |
| Redirect Worker `op4n.me/{code}` | **T** open redirect; **S** forged destination; **D** traffic floods; **I** destination in logs | Only `^[A-Za-z0-9]{6,32}$` paths reach the lookup; destination only from the authenticated internal lookup; integrity checks (code echo, HTTP(S), version); fails closed with 503 and no `Location`; no logs of destinations; 302 + no-store | `security.test.mjs` (open redirect), `redirect-worker.test.mjs`, `failure-matrix.test.mjs` |
| Public reads `GET /links`, `/links/{code}`, `/link-lookup` | **I** leaking withheld/disabled/private data; **I** enumeration of codes; **D** scraping | Single eligibility rule, six-field card only, withheld = unknown, disabled has no card fields, exact lookup only, `public-read` and `public-search` limits (300 lookups/day/identity) fail closed | `public-discovery.test.mjs`, `migration-pglite.test.mjs` (projection, 301st lookup) |
| `POST /links/{code}/reports` | **D** report flooding; **I** revealing moderation state; **T** hostile detail | `public-report` limits, opaque receipt only, detail sanitized and length-bounded, never rendered as HTML (textContent) | `report-handler.test.mjs` |
| Admin `/api/v1/admin/*` | **S** stolen session; **E** non-founder access; **R** unaudited actions; **I** destination exposure | ES256 JWT verified against JWKS, issuer/audience, founder subject allowlist, aal2 (TOTP), recent auth for disable/restore/discovery, every action audited (append-only), destinations only via audited reveal, signup disabled | `security.test.mjs` (all Admin ops), `admin-auth.test.mjs`, `admin-handlers.test.mjs`, Staging smoke |
| Internal `/api/v1/internal/*` | **S** forged Worker calls; **E** reaching internal ops from a browser | Constant-time service credential check, no CORS headers, POST/GET method guard | `security.test.mjs` (all internal ops), `internal-handlers.test.mjs`, `health-handlers.test.mjs` |
| Frontend pages | **T** XSS via title/summary; **I** destination query in DOM | All data rendered escaped or via textContent; summary policy r1-safe-path-v1; non-HTTP open URLs never linked | `security.test.mjs` (XSS), prototype smoke (no secret in DOM) |
| Logs | **I** secrets in logs; **T** log injection | `log.mjs` key/URL redaction, control-character escaping, no direct console use | `log.test.mjs` |
| Deploy pipeline | **T** unreviewed code to Staging; **E** leaked deploy tokens | Founder approval on the `staging` environment, exact SHA + artifact digest, environment-scoped secrets, secret hygiene scan, pinned actions and CLIs | `foundation-validation.mjs`, `secret-hygiene.mjs`, `release-artifact.mjs` |
| Dependencies | **T** supply chain | Exact pinned versions at least two weeks old, lockfile, `npm audit --audit-level=high` in CI | CI |

## Findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| TM-1 | A trailing-dot short host (`https://op4n.me./CODE`) passed the "no short links of short links" check, allowing redirect chains that hide the real destination | P1 | Fixed 2026-11-27 (server and browser), regression tests added |
| TM-2 | Edge Function invocation budget exceeds Supabase Free at the R1 target load (availability, not confidentiality) | P1 | Handed to Order 95 capacity decision (`r1-quotas.md`) |
| TM-3 | No real destination safety provider yet: Production readiness stays not-ready and creation fails closed until Order 47 ships | P0 for public launch | Open: blocks Order 95 by design |
| TM-4 | Headless Firefox CI crash leaves five Firefox journeys to manual checks | P2 | Open (Order 89) |

## Accepted risks (founder sign-off required on the Order 94 card)

1. No external penetration test before private beta.
2. Single founder account holds all Admin power; break-glass and TOTP re-enrollment are documented in `r1-admin-access.md`.
3. Guest links are public and permanent; a creator cannot delete a link that exposes their own data (support can disable it).
4. Rate-limit identity is a per-IP hash: users behind one shared IP share limits; botnets can exceed per-IP limits up to the global ceilings.
5. Provider log retention is outside our control (a few days).

Unresolved P0 findings block "R1 production cutover and launch go/no-go".
