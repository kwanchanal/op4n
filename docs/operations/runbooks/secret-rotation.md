# Runbook: leaked secret rotation

Use when a secret may be exposed: pasted somewhere, committed, on a lost
device, or logged. Inventory and owners: `docs/security/r1-secrets-and-access.md`.

**First 15 minutes**
1. Identify which secret and which environment.
2. If abuse is likely, pause creation (`guest_creation`) first.
3. Rotate immediately (below). Do not wait for a full investigation.

| Secret | Rotate | Then |
| --- | --- | --- |
| Supabase secret key (`SUPABASE_SECRET_KEY`) | Supabase dashboard → API keys → create a new secret key, revoke the old one | Update the GitHub Environment secret; redeploy through the approved workflow |
| Internal service credential | Generate 64 random hex characters; update the GitHub Environment secret | Redeploy (sets the function secret and both Worker secrets together) |
| Destination fingerprint HMAC key | Add a new version; never reuse | Redeploy; old fingerprints stay valid for lookup by Admin only |
| Cloudflare API token | Cloudflare → API tokens → roll | Update the GitHub Environment secret |
| Supabase access token / DB password | Supabase account → tokens / database settings | Update the GitHub Environment secret |
| Admin password or TOTP | Change the password; re-enroll TOTP (see `r1-admin-access.md`) | Sign out other sessions |

**Verification:** the deploy smoke passes (it proves the new credential works
end to end); a request with the old credential returns 401; search GitHub,
logs, and chat history for the leaked value.

**Rehearsal (Staging):** rotate the internal service credential on Staging,
redeploy, confirm the smoke passes and the old value returns 401. Record on
the Order 87 card.
