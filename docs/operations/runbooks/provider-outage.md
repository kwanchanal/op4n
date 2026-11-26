# Runbook: provider outage

| Provider down | What users see | Action |
| --- | --- | --- |
| Cloudflare (DNS, Workers, Pages) | Site and short links unreachable | Watch https://www.cloudflarestatus.com; nothing to fail over to in R1 |
| Supabase | Redirects 503 (fail closed); create, list, and search 503 | See [database-incident.md](database-incident.md) |
| Safety screening provider | Creation 503 (fails closed); redirects unaffected | Pause `guest_creation` if the outage is long, so users see "paused" instead of errors |
| Email (Cloudflare Email Routing / Email Service) | Nothing; reports are still accepted | The outbox retries; check the founder digest resumes; check Admin's Reports queue directly meanwhile |

Behavior for each dependency is in `docs/operations/r1-failure-matrix.md`.

**Recovery verification:** readiness 200; SYNTHETIC1 302; one test link
created and opened; the next founder digest arrives.
