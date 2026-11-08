# R1 secrets and least-privilege access

- Status: Proposed for review
- Scope: R1 Feature Inventory Batch 1, Order 7
- Policy owner, access approver, and initial operator: Founder
- Public contact: `support@op4n.com`
- Last updated: 2026-11-08
- Related architecture:
  [production boundaries](../architecture/r1-production-architecture.md),
  [environment separation](../architecture/r1-environment-strategy.md),
  [database schema](../architecture/r1-database-schema.md),
  [migration process](../architecture/r1-database-migration-process.md), and
  [API authentication contract](../api/r1-api-contract.md)
- Repository guard:
  [secret hygiene test](../../tests/secret-hygiene.mjs) and
  [ignore policy](../../.gitignore)

## Purpose and non-goals

This document is the R1 source of truth for secret names, classification,
approved stores, consumers, least-privilege scope, environment separation,
rotation, revocation, access review, incident response, and sanitized evidence.
It contains names and policy only. It does not contain or create a credential,
provider account, GitHub Environment, runtime secret, workflow, deployment, or
infrastructure change.

R1 has one human operator, the founder, and exactly two hosted environments:
Staging and Production. Local is an unhosted workflow. The policy keeps the
operating model small without using one shared credential as a shortcut.

Order 8 owns CI/CD workflow implementation. Later implementation cards own the
actual Supabase Edge Function, Cloudflare Worker, provider integrations, and
deployment. No section here authorizes those changes.

## Classification

| Class | Meaning | Examples | Repository and log rule |
| --- | --- | --- | --- |
| Public non-secret | Intended to be public and grants no privileged capability. It remains environment-scoped where applicable. | `support@op4n.com`, `API_BASE_URL`, `SUPABASE_PUBLISHABLE_KEY` after RLS/API review, release/config version | May be versioned or shipped to a browser when its owning contract permits. Never treat it as authorization. |
| Protected non-secret configuration | Not a credential, but disclosure or modification can aid targeting or misrouting. | Project reference, Cloudflare account/zone identifiers, founder subject allowlist, HMAC key version | Store as protected provider configuration/variables. Log only when the field is explicitly allowlisted and the value is not sensitive; prefer a reviewed logical label over a provider identifier. |
| Secret | A value that authenticates, authorizes, decrypts, signs, or provides privileged database/provider access. | Scoped PAT, database password, Supabase Secret key, internal service credential, destination HMAC key, provider credential | Only in the approved encrypted store and intended consumer. Never in Git, browser assets, fixtures, logs, errors, artifacts, or scan output. |
| Human account and recovery material | Founder account passwords, MFA seeds/recovery codes, device recovery keys, and account-level Cloudflare/Gmail credentials. These are not application secrets. | Gmail password/recovery codes, Cloudflare account password/MFA recovery | Founder password manager and separate MFA recovery storage only. Never copy into GitHub, Supabase, Cloudflare Worker variables, application config, or repository evidence. |
| Provider-managed credential | Created and retained by a provider; the application consumes the provider capability without exporting the underlying value. | Supabase JWT signing/session infrastructure, GitHub job token, Cloudflare account session/authentication | Do not export or duplicate into the repository or another provider. Configure and audit through the provider boundary. |

Variable names are not secrets. A name must still never be paired with a real,
truncated, encoded, encrypted, or secret-derived value in this repository.

## Source-of-truth hierarchy

1. **This inventory is authoritative for names and policy.** A new credential
   cannot be introduced until its owner, consumer, environments, store,
   permission scope, rotation/revocation triggers, and evidence rules are added
   and reviewed here.
2. **Provider encrypted stores are authoritative for deployed values.** GitHub
   Environment secrets deliver deployment credentials; Supabase Edge Function
   secrets and Cloudflare Worker secrets deliver runtime credentials. The
   repository never mirrors their values.
3. **Protected provider variables hold non-secret deployment identity.** A
   variable is not promoted to a secret merely to hide weak authorization. Jobs
   verify environment and target identity independently.
4. **The founder password manager holds human account/recovery material.** It
   may hold an administrative recovery copy of a generated application secret
   only when recovery/rotation requires it. Runtime providers remain the active
   delivery stores, and the copy follows the same rotation/revocation record.
5. **Sanitized evidence records versions and outcomes, not values.** Durable
   private operations records hold sensitive incident/access-review metadata;
   Git may hold only policy and non-sensitive test results.

There is no shared `.env`, shell profile, repository file, Staging fallback, or
operator-memory value that acts as a hidden source of truth.

## Inventory: deployment secrets

Each row represents two different values and scopes: one in GitHub Environment
`staging` and one in GitHub Environment `production`. Production values become
available only to the Production job after the approved environment gate.

| Name | Purpose and consumer | Owner | Approved storage | Minimum permission | Rotation/revocation and review |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI deployment/migration identity for the selected environment. | Founder | Corresponding GitHub Environment secret | Scoped PAT limited to exactly that environment's Supabase project; legacy, shared, and account-wide tokens are prohibited. | Review at least every 90 days; rotate after scope/operator/device/provider change or suspected exposure; revoke unused predecessor after positive and reciprocal negative tests. |
| `SUPABASE_DB_PASSWORD` | Database authentication used only by the environment's approved migration/recovery job when the command requires it. | Founder | Corresponding GitHub Environment secret | One database credential per environment; migration/recovery capability only; absent from runtime/frontend/fixture jobs. | Review at least every 90 days; rotate immediately on exposure or operator/device compromise; validate Staging first for planned changes. |
| `CLOUDFLARE_API_TOKEN` | Deploy the environment's Worker/configuration only after Worker implementation requires it. Absent until then. | Founder | Corresponding GitHub Environment secret | Token restricted to the required account, zone, Worker/script, and edit/read actions; no global API key. | Review at least every 90 days; rotate after scope/provider/account change or exposure; Staging deployment test precedes planned Production rotation. |

There is no generic `OTHER_DEPLOYMENT_SECRET`. Any additional deployment
credential must first receive a specific inventory name and reviewed row. A
deployment credential is not copied into runtime merely because the same
provider hosts both deployment and runtime.

## Inventory: protected deployment variables

These values are configuration, not credentials. GitHub Environment variables
remain separate for Staging and Production so a job can fail closed on identity
or target mismatch.

| Name | Consumer and purpose | Classification | Storage and rule |
| --- | --- | --- | --- |
| `OP4N_ENV` | All deployment/runtime identity checks | Public non-secret | GitHub Environment variable and runtime binding; exact `staging` or `production`. |
| `SUPABASE_PROJECT_REF` | Explicit Supabase CLI target and target preflight | Protected non-secret configuration | GitHub Environment variable. It is never accepted as proof of authority and is omitted from public logs/evidence. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare deployment target when required | Protected non-secret configuration | GitHub Environment variable; must match the reviewed environment target. |
| `CLOUDFLARE_ZONE_ID` | Short-domain zone target when required | Protected non-secret configuration | GitHub Environment variable; Worker deployment receives it only when the operation needs zone scope. |
| `RELEASE_SHA` | Immutable release identity | Public non-secret | Reviewed artifact/workflow input; never derived from mutable branch state during Production mutation. |
| `CONFIG_VERSION` | Non-secret configuration manifest identity | Public non-secret | Reviewed environment variable; changes are evidence-bearing release changes. |

## Inventory: Supabase backend runtime

All values below are separate between Staging and Production. Secrets live in
the corresponding Supabase Edge Function encrypted secret store. Protected
configuration lives in the environment's protected runtime configuration.

| Name | Class | Consumer and purpose | Minimum capability | Rotation/revocation and review |
| --- | --- | --- | --- | --- |
| `INTERNAL_SERVICE_CREDENTIAL_CURRENT` | Secret | `op4n-api` route-level verifier accepts the current Worker credential for internal redirect/click/health operations. | Only authenticate the environment's approved internal operation set; never public/Admin authority. | Current/next overlap procedure; review at least every 90 days and rotate immediately on exposure. |
| `INTERNAL_SERVICE_CREDENTIAL_NEXT` | Secret | Temporary next verifier slot during rotation; normally absent outside a rotation window. | Same bounded internal operation set and environment as current; cannot authenticate another environment. | Remove after all consumers use next and verification passes, except active exposure may require immediate current revocation. |
| `DESTINATION_FINGERPRINT_HMAC_KEY_CURRENT` | Secret | Backend generates/verifies the versioned keyed HMAC of normalized full destinations. | HMAC operation only; no database, deploy, browser, or Worker capability. | Review at least every 90 days; rotation follows the Order 4/5 keyed-HMAC and data-migration safeguards. |
| `DESTINATION_FINGERPRINT_HMAC_KEY_NEXT` | Secret | Temporary new HMAC material during an approved rotation/re-HMAC operation. | HMAC operation only in the same environment. | Remove only after re-HMAC, reconciliation, correctness checks, and recovery gates pass; revoke immediately if active exposure requires containment. |
| `DESTINATION_FINGERPRINT_HMAC_VERSION_CURRENT` | Protected non-secret configuration | Selects the current fingerprint algorithm/key version without exposing key material. | Version selection only. | Change only with the reviewed migration/re-HMAC manifest and correctness evidence. |
| `DESTINATION_FINGERPRINT_HMAC_VERSION_NEXT` | Protected non-secret configuration | Identifies the temporary next version during rotation. | Version selection only. | Remove with the corresponding next key after promotion/cleanup evidence. |
| `SAFETY_PROVIDER_CREDENTIAL` | Secret | Creation/safety backend calls the selected threat provider. Absent while the provider is undecided or Staging uses a deterministic stub. | Provider endpoint and operation subset required for destination screening only. | Provider recommendation or exposure triggers immediate rotation; planned Production changes pass sandbox/Staging verification first. |
| `FOUNDER_SUBJECT_ALLOWLIST` | Protected non-secret configuration | Route-level Admin authorization compares the verified Supabase Auth JWT subject to the environment founder subject. | Identification/allowlist only; it is not a bearer credential and cannot replace JWT verification. | Review monthly and after Auth/user/device changes; remove obsolete subjects immediately. |
| `SUPABASE_SECRET_KEY` | Secret | Backend-only privileged Supabase operation where an explicitly reviewed operation cannot use a narrower database/API capability. | Minimum backend capability; deny browser, public response, unrelated job, and cross-environment use. | Follow provider rotation guidance and rotate immediately on exposure. Never duplicate into frontend configuration. |
| `SUPABASE_PUBLISHABLE_KEY` | Public non-secret | Browser/public client only after RLS and API boundaries make the intended access safe. | Public RLS/API capability; never Admin, internal-service, or ownership authority. | Change through normal environment configuration release; exposure alone is not a secret incident, but unexpected privilege is. |

Supabase Secret and Publishable keys are different classes. The Secret key is
never in a browser, frontend bundle, repository, fixture, log, public error, or
unrelated Local/Staging scope. The Publishable key may be public only after its
RLS/API boundary passes review. Neither key may replace the custom internal
Worker-to-API credential.

## Inventory: Cloudflare Worker runtime

| Name | Class | Consumer and purpose | Approved storage and scope |
| --- | --- | --- | --- |
| `INTERNAL_SERVICE_CREDENTIAL_CURRENT` | Secret | Worker authenticates current internal API calls. | Corresponding environment's Cloudflare Worker encrypted secret; same logical current credential accepted by that environment's Supabase verifier, never shared across environments. |
| `INTERNAL_SERVICE_CREDENTIAL_NEXT` | Secret | Worker switches to the next credential during overlap after the API accepts it. | Corresponding environment's Worker encrypted secret; temporary and removed after cutover evidence. |
| Redirect-only runtime secrets added later | Secret | Only a concrete redirect-service dependency approved by a later card. | Must receive a named inventory row before creation; no generic shared runtime secret. |
| `API_BASE_URL` | Public non-secret | Select the environment's `op4n-api` origin. | Worker variable; validated against environment identity and never treated as authorization. |
| `OP4N_ENV` | Public non-secret | Explicit Worker environment marker. | Worker variable with exact `staging` or `production`. |
| `CONFIG_VERSION` | Public non-secret | Identify the reviewed runtime configuration. | Worker variable and sanitized telemetry field. |

The internal current/next value is deliberately present in two encrypted
runtime stores within one environment because one side sends it and the other
verifies it. This controlled mirror is not permission to share the credential
between Staging and Production or to keep a repository copy.

## Inventory: provider-managed and human credentials

| Item | Classification and owner | Handling |
| --- | --- | --- |
| Supabase JWT signing keys and session infrastructure | Provider-managed; Supabase operates the signing/session boundary, founder owns project configuration. | Verify issuer/audience/signature through supported provider mechanisms. Do not export signing keys or recreate session secrets in GitHub/Cloudflare/Git. |
| GitHub built-in job token | Provider-managed ephemeral credential. | Job receives only the permissions required by its Order 8 step. Do not persist it, copy it to runtime, print it, or treat it as a cross-provider deploy token. |
| Cloudflare account authentication/session | Human/provider-managed; founder. | Password manager plus MFA/recovery storage. Use scoped API tokens for automation rather than exporting account authentication. |
| Founder Gmail password and recovery codes | Human account/recovery material; founder. | Password manager plus separate MFA recovery storage. Never an application or GitHub Environment secret. |
| `support@op4n.com` | Public non-secret contact. | May appear publicly and in version control. It is not authentication and carries no mailbox authority. |
| Outbound email provider credential | Not present in R1. | No credential may be created or inventoried until an outbound provider is explicitly selected. Current email routing/account credentials remain human/provider-managed. |

Provider-managed values must not be exported or copied into the repository or
another store without a concrete reviewed need. A provider dashboard showing a
credential does not make copying it into evidence acceptable.

## Least-privilege rules

1. Staging and Production never share a secret value. Equivalent names identify
   separate credentials with separate provider scope and lifecycle.
2. Local, Development tools, fixtures, and pull-request validation receive no
   Production credential. Local uses disposable values or deterministic stubs.
3. GitHub Environment secrets are available only to the job that names that
   environment. Production secrets are released only after the founder approval
   gate. Staging jobs cannot reference the Production Environment.
4. Deployment credentials remain deployment-only. Runtime receives no PAT,
   database password, or Cloudflare deployment token unless an operation has a
   separately reviewed runtime need—which R1 currently has not identified.
5. Runtime services receive only their named capability. The Worker credential
   authenticates internal API operations; the HMAC key performs HMAC; the safety
   credential calls the selected screening operation.
6. Founder/Admin uses a verified short-lived Supabase Auth user JWT plus the
   environment subject allowlist. It is not a static browser secret and is not
   used for Worker authentication.
7. `SUPABASE_PUBLISHABLE_KEY` can be public under reviewed RLS/API boundaries.
   `SUPABASE_SECRET_KEY` is backend-only and privileged. The custom internal
   service credential is neither Supabase key.
8. Missing Staging configuration never falls back to Production, a shell
   profile, home-directory file, shared default, or another provider store.
9. No secret is echoed, printed, truncated, base64-encoded, weakly hashed,
   passed in a command argument that becomes visible, or uploaded in an
   artifact/log. Masking is defense in depth, not authorization to log.
10. Allowed operational evidence fields are secret name, non-secret version
    identifier, store name, environment label, rotation time, operator, workflow
    reference, and pass/fail outcome. Evidence contains no value-derived prefix,
    suffix, length, checksum, fingerprint, or hash.

## Environment and access matrix

| Actor/job | Local | Staging | Production |
| --- | --- | --- | --- |
| Browser/frontend | Public configuration only; mock adapter | Staging public configuration only | Production public configuration only |
| Local validation and fixtures | Disposable local values/stubs; no hosted authority | No automatic authority; explicit Staging integration job only | No credential or code path |
| Staging deploy/migration job | Not applicable | Staging GitHub Environment secrets and variables only | Must fail reciprocal authorization test |
| Production deploy/migration job | Not applicable | Must fail reciprocal authorization test | Production GitHub Environment secrets after founder approval only |
| Staging Worker | No Local fallback | Staging Worker secrets and Staging internal API only | Production internal API rejects it |
| Production Worker | No Local fallback | Staging internal API rejects it | Production Worker secrets and Production internal API only |
| Supabase backend | Disposable Local backend only | Staging encrypted secrets/config and Staging database | Production encrypted secrets/config and Production database |
| Founder interactive account | Password manager/MFA controls account access | Explicit selected Staging project | Explicit selected Production project; attended operations only |

## Cross-environment negative tests

These tests run without printing a credential, connection string, provider
identifier, response body, or secret-derived data. Evidence records only the
test ID, logical source/target environment, result, time, and operator/run.

| Test ID | Expected result |
| --- | --- |
| `NEG-SUPABASE-PAT-STG-TO-PROD` | Staging scoped PAT cannot read, deploy, configure, or enumerate the Production project. |
| `NEG-SUPABASE-PAT-PROD-TO-STG` | Production scoped PAT cannot act on the Staging project. |
| `NEG-DB-STG-TO-PROD` | Staging database credential cannot connect to or mutate Production. |
| `NEG-DB-PROD-TO-STG` | Production database credential cannot connect to or mutate Staging. |
| `NEG-INTERNAL-STG-TO-PROD` | Production API rejects the Staging Worker credential before operation logic. |
| `NEG-INTERNAL-PROD-TO-STG` | Staging API rejects the Production Worker credential before operation logic. |
| `NEG-HMAC-VERSION-MISMATCH` | An unapproved key version cannot validate or replace another environment/version's destination fingerprint. No redirect uses a guessed destination. |
| `NEG-CLOUDFLARE-TARGET` | Each deployment token cannot mutate the other environment's Worker/script/route scope. |
| `NEG-PROVIDER-STG-TO-PROD` | Staging safety credential cannot invoke Production provider scope; when isolation is unavailable, Staging uses a stub and holds no Production key. |
| `NEG-LOCAL-PRODUCTION-ABSENCE` | Local/fixture processes have no Production secret names or provider authority available. |

Positive tests prove only the minimum intended operation. A failed negative test
blocks deployment, triggers scope review and credential rotation, and never
falls back to a broader credential.

## Standard rotation runbook

1. Open a private change record with secret name, environment, current/next
   non-secret version identifiers, trigger, owner, consumers, and rollback plan.
2. Review provider scope and access list. Reduce permission before issuing the
   replacement when possible.
3. Generate the replacement directly into the approved encrypted store or
   founder password manager. Do not pass it through chat, clipboard history,
   shell history, repository files, logs, or artifacts.
4. For deployment PAT/API/database credentials, update Staging first, run
   positive and reciprocal negative authorization tests, and complete the
   bounded deployment verification before the attended Production change.
5. Update each Production consumer in an attended window. Verify environment,
   version identifier, health/readiness, intended capability, negative tests,
   and redirect correctness without logging the value.
6. Revoke/remove the predecessor only after every intended consumer proves the
   replacement works and no approved consumer still references the old version.
7. Review provider access/history and application logs for anomalous outcomes,
   then record sanitized completion evidence and the next review date.

Long-lived application/deployment secrets are reviewed at least every 90 days.
The founder performs the access review monthly and whenever a provider, device,
account, collaborator, scope, or runtime consumer changes.

## Zero-downtime internal credential rotation

1. Generate an environment-only next credential and install it in the API
   verifier's `NEXT` slot. The current credential remains accepted.
2. Confirm the other environment rejects next. Exercise the intended Staging
   internal operation with next and verify no public/Admin capability.
3. Install next in the same environment's Worker and switch its sender from
   current to next. Verify redirect lookup, correct `302`, post-response click
   behavior, health, and authentication failure telemetry.
4. Observe that all approved consumers use next. Promote its version identifier
   to current and remove/revoke the predecessor from both runtime stores.
5. If verification fails, switch the sender back to current, remove next, and
   investigate. Never copy the other environment's credential as a rollback.

This overlap prevents a planned rotation from interrupting valid redirects. An
active exposure overrides overlap: revoke the exposed value immediately, fail
closed for unauthorized internal calls, and use the emergency process.

## Destination HMAC key rotation

The keyed HMAC protects destination integrity/correctness; it is not an access
token. Rotation still cannot weaken the fail-closed redirect invariant.

1. Assign a new bounded algorithm/key-version identifier and install next key
   material only in the environment backend secret store.
2. Follow the Order 4 immutable destination-version and composite ownership
   invariants. Never reinterpret an old fingerprint under a new key/version.
3. Use the Order 5 migration/re-HMAC process with pre/post destination
   correctness, ownership, reconciliation, backup/recovery, and release evidence.
   A transforming Production re-HMAC remains blocked until the approved isolated
   recovery capability and restore rehearsal exist.
4. During an approved overlap, validation selects the stored key version and
   never guesses or silently falls back. An unknown/mismatched version emits no
   redirect and opens an integrity incident.
5. Remove the old key only after every owned destination has a verified new
   fingerprint and rollback/recovery evidence permits cleanup. Active exposure
   may require immediate revocation and a bounded service stop rather than risk
   an incorrect destination.

## Emergency exposure and revocation

Immediate rotation/revocation triggers include suspected repository/log/artifact
exposure, failed cross-environment negative test, unexpected privilege, founder
role change, lost/compromised device, account/session compromise, unauthorized
provider activity, or provider security guidance.

The founder executes and timestamps this sequence:

1. **Contain.** Stop the affected job/consumer, restrict provider scope, preserve
   sanitized evidence, and prevent further use. Protect redirect correctness;
   fail closed rather than guess a credential or destination.
2. **Revoke.** Revoke the suspected credential immediately. Do not wait for
   overlap when exposure is active.
3. **Replace.** Issue a least-privilege environment-specific replacement in the
   approved store. Assume related sessions/tokens may also require revocation.
4. **Redeploy or reconfigure.** Update only named consumers through the approved
   attended path. Never use a shared emergency master credential.
5. **Verify.** Run health, intended capability, reciprocal negative access,
   redirect correctness, and repository/bundle/history hygiene tests.
6. **Review history.** Review provider audit/access history and sanitized
   application outcomes for the bounded exposure window. Do not copy secret
   values into the incident record.
7. **Record and learn.** Store the private incident record for at least one year,
   document scope/timeline/action/outcome, update inventory or detection rules,
   and schedule follow-up access review.

Use `support@op4n.com` for the R1 operational escalation path, without sending a
secret or recovery code through email.

## Founder access review checklist

Run monthly, at the 90-day long-lived-secret review, and after every incident or
meaningful access/configuration change.

- [ ] GitHub repository collaborators, deploy keys/apps, Environment protection,
  secret/variable names, job permissions, and approval rules match this policy.
- [ ] Staging and Production GitHub Environment secrets are separate; no Local,
  pull-request, fixture, or unrelated job can request Production secrets.
- [ ] Supabase projects, scoped PATs, database credentials, backend Secret keys,
  Auth founder subjects, sessions, and project members are environment-correct.
- [ ] Cloudflare account members/sessions, scoped deployment tokens, Worker
  secrets/variables, scripts/routes, zone scope, MFA, and recovery controls are
  environment-correct and minimal.
- [ ] Current/next slots have at most the intended active overlap; stale next or
  predecessor values are revoked after verified cutover.
- [ ] Provider credentials not yet required—Cloudflare deployment or safety
  provider credentials, for example—are absent rather than pre-created.
- [ ] Gmail and Cloudflare human account credentials/recovery material remain in
  the password manager/MFA recovery store and not application stores.
- [ ] Provider audit histories show only expected founder and automation actions;
  unused tokens, sessions, devices, and permissions are revoked.
- [ ] Sanitized evidence has no raw, truncated, encoded, encrypted, or
  secret-derived value; retention and private-storage requirements are met.
- [ ] The repository, frontend bundle, and reachable Git history pass the secret
  hygiene guard, and any finding has an explicit founder remediation decision.

Record only checklist version, date, founder/operator, environments reviewed,
pass/fail items, remediation references, and next review date.

## Repository protection and evidence policy

The [ignore policy](../../.gitignore) excludes `.env`, environment-specific
`.env.*`, Supabase function env files, Cloudflare `.dev.vars`, private
key/certificate material, local provider state, and common credential exports.
It deliberately keeps `.env.example`, OpenAPI, Wrangler configuration, Supabase
configuration, and other reviewable non-secret configuration trackable.

An `.env.example` may contain only variable names and obviously synthetic or
non-secret placeholders. A frontend example may contain only public
configuration. It must not contain a live-looking credential, Secret key,
database URL with password, internal service credential, HMAC key, or copied
provider value.

The dependency-free [secret hygiene test](../../tests/secret-hygiene.mjs):

- scans tracked and pending non-ignored repository text files;
- scans reachable Git history text blobs without checkout or history mutation;
- scans text assets in `dist/` even though the directory is ignored;
- detects private keys, common provider-token forms, JWTs, credential-bearing
  URLs, named secret assignments, and secret assignments in frontend/mock paths;
- runs positive detectors from strings assembled only in memory plus negative
  placeholder tests; and
- reports only rule ID, scope, file path, line, and safe Git blob metadata.

The test never reads process environment variables, shell profiles, untracked
ignored local `.env` files, keychains, password managers, or provider accounts;
it never uploads results. A mistakenly tracked or historically committed `.env`
file remains repository evidence and is intentionally scanned without printing
its contents.
It never prints a matched value or a value-derived prefix, suffix, length, hash,
or digest. Pattern scanning can produce false positives and cannot prove a
provider store is correctly configured, so provider access reviews and negative
authorization tests remain mandatory.

If a reachable-history scan reports a suspicious location, do not print the
value, rewrite history, delete evidence, or assume revocation happened. Stop the
Order 7 review, set the card to `Blocked`, and ask the founder to decide immediate
rotation/revocation and history-remediation scope.

## Access and rotation evidence

| Evidence type | Allowed fields | Storage and retention |
| --- | --- | --- |
| Routine rotation/access review | Secret name, version identifier, environment, provider/store, operator, UTC time, trigger, pass/fail checks, workflow/change reference, next review date | Sanitized durable operations record; Git may hold only a policy/test summary. |
| Deployment verification | Environment label, release/config version, credential name/version, target logical label, positive/negative test IDs and outcomes, run reference | Order 8/release evidence store; expiring logs are not the sole durable record. |
| Security incident | Incident ID, affected names/environments, detection source, bounded timeline, containment/revocation/replacement actions, verification outcomes, follow-up | Private off-site operations storage for at least one year. No Production data or secret-derived evidence in Git. |
| Repository hygiene scan | Scanner version/release SHA, scopes/counts scanned, rule IDs and safe locations only when findings exist, pass/fail | Repository/CI summary when implemented; no matched values or external upload. |

## Acceptance-criteria traceability

| Acceptance criterion | Evidence |
| --- | --- |
| No Production secret appears in repository, client bundle, logs, or mock config. | `.gitignore` policy, repository/history/`dist` guard, frontend assignment detector, evidence prohibitions, and validation results. |
| Services receive minimum permissions. | Deployment/runtime/provider inventory and least-privilege rules constrain every named consumer and prohibit generic shared credentials. |
| Development credentials cannot access Production. | Environment/access matrix and reciprocal PAT, database, internal-service, Cloudflare, provider, and Local-absence negative tests. |
| Secret and non-secret configuration are classified correctly. | Classification table separates Publishable/Secret keys, founder JWT, custom service credential, protected identifiers, public contact, and provider/human material. |
| Staging and Production secrets are separate. | Every inventory/store rule is environment-specific; no fallback or cross-environment sharing is allowed. |
| Rotation and revocation are documented and testable. | Standard, current/next, HMAC, deployment-token, and emergency runbooks define triggers, sequencing, verification, and evidence. |
| Long-lived secrets and founder access are reviewed. | At-least-90-day secret review, monthly founder checklist, provider-history review, and immediate event-driven review. |
| Evidence cannot disclose a secret. | Allowlisted metadata excludes raw, truncated, encoded, encrypted, or secret-derived values, including hashes and checksums. |
| History findings stop unsafe progress. | Scanner reports safe locations only; a reachable-history finding requires Order 7 `Blocked` and founder remediation decision, never automatic rewrite. |
| No secret, workflow, account permission, or infrastructure is created here. | This artifact, ignore rules, and dependency-free repository guard are the only authorized changes; Order 8 remains unstarted. |

## Principal PO/Architect review

Review should confirm:

1. the complete secret/non-secret/provider/human inventory and approved stores;
2. environment-specific least privilege and reciprocal negative test coverage;
3. current/next internal credential overlap and emergency immediate-revoke rule;
4. HMAC rotation dependency on Order 4 invariants and Order 5 recovery/migration
   gates;
5. monthly access review, at-least-90-day long-lived-secret review, and evidence
   retention; and
6. repository/history/bundle guard coverage and its documented limitations.

Approval changes this document's status; it does not create a credential,
workflow, provider configuration, deployment, database change, or Order 8 work.
