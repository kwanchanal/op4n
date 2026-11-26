# R1 Admin access: MFA, least privilege, and break-glass

- Status: Implemented and rehearsed on Staging (Feature Inventory "Require MFA and least privilege for Admin access")
- Owner and sole Admin: Founder
- Last updated: 2026-11-26
- Related: [secrets and access](../security/r1-secrets-and-access.md), [environment strategy](../architecture/r1-environment-strategy.md), [moderation policy](r1-moderation-policy.md), [OpenAPI](../api/r1-openapi.yaml)

## Model

| Control | Implementation |
| --- | --- |
| Identity | Supabase Auth user in the environment's own project. Staging and Production are separate projects, so subjects and sessions never cross environments. |
| Public sign-up | Disabled in Auth settings. The founder user is created by hand in the dashboard. The Staging deploy smoke asserts that `POST /auth/v1/signup` returns `signup_disabled`. |
| Second factor | TOTP (authenticator app). It is enrolled on first sign-in at `admin.html`, and every later sign-in is challenged. SMS is not used. |
| Authorization | Each `/api/v1/admin/*` route verifies an ES256 signature against the project JWKS, plus `iss` = `FOUNDER_AUTH_ISSUER`, `aud` = `FOUNDER_AUTH_AUDIENCE`, `exp`/`nbf`, `sub` in `FOUNDER_SUBJECT_ALLOWLIST`, and `aal` = `aal2`. |
| Responses | No JWT, or a JWT that is invalid, expired, or from another issuer: 401 `UNAUTHORIZED`. A subject not on the allowlist: 403 `FORBIDDEN`. An aal1 session: 403 `MFA_REQUIRED`. Missing configuration: 503 `FEATURE_UNAVAILABLE` (fails closed). |
| High-risk actions | Disable and restore require `iat` within 15 minutes, otherwise 401 `REAUTH_REQUIRED`. |
| Logging | One `admin_request` line per request with the operation, request ID, status, and the logical actor `founder` (or `null` when denied). The subject ID, token, email, and IP are never logged. |
| UI | `admin.html` on the frontend origin, served `noindex` and not linked from public navigation. It loads pinned `@supabase/supabase-js@2.49.4` with SRI. |

## Configuration

| Name | Where | Staging value |
| --- | --- | --- |
| `FOUNDER_SUBJECT_ALLOWLIST` | GitHub Environment `staging` variable, copied to a function secret by the deploy | Founder's Staging Auth user ID |
| `FOUNDER_AUTH_ISSUER` | Function secret written by the deploy | `https://<ref>.supabase.co/auth/v1` |
| `FOUNDER_AUTH_AUDIENCE` | Function secret written by the deploy | `authenticated` |
| `authUrl`, `publishableKey` | `config/runtime-config.js` written by the deploy | Project URL and public publishable key |

Production repeats the same setup in the Production project with its own user and
allowlist, during "R1 production cutover and launch go/no-go".

## Break-glass

Use break-glass when the authenticator device is lost, or when the Admin UI or Edge
Function is unusable during an abuse incident.

1. Sign in to the Supabase dashboard with the founder account. That account has its
   own MFA and offline recovery codes in the password manager; it is separate from
   the Admin app user.
2. **Lost authenticator:** go to Authentication → Users → founder user → remove the
   MFA factor. Then sign in at `admin.html` and enroll a new factor right away.
   Record the date and reason in the operations log.
3. **Urgent disable while Admin is down:** in the SQL editor, run the audited
   disable function that ships with "Admin disable link action". Pass
   `actor = 'founder-break-glass'` and a reason. Do not edit the tables directly.
4. **Account compromise:** in Authentication → Users, sign the user out of all
   sessions and reset the password. Rotate `FOUNDER_SUBJECT_ALLOWLIST` only if a new
   user replaces the old one.
5. Afterwards, review the Auth audit log (Authentication → Audit Logs) and the
   `admin_request` function logs for the incident window.

### Rehearsal record

| Date | Environment | Steps rehearsed | Result |
| --- | --- | --- | --- |
| 2026-11-26 | Staging | Removed every MFA factor from the founder user in the dashboard (Danger zone → Remove MFA factors), signed out, signed in at `/admin`, enrolled a new TOTP factor, reached the aal2 Admin session | Passed. The old authenticator entry no longer works. |

Finding: removing a factor does not end existing sessions. An access token that
was already issued keeps its `aal2` claim until it expires (at most 1 hour). For a
suspected compromise, step 4 (sign the user out of all sessions) is mandatory, not
optional.
