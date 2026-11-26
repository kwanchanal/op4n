# R1 backup, restore, RPO, and RTO

Feature Inventory Order 84. Supabase Free plan backups are not relied on.

## Objectives (proposed; PENDING founder approval)

| Data | RPO (max data loss) | RTO (max time to restore) |
| --- | --- | --- |
| Redirect mappings: issued codes, canonical links, destination versions, tombstones, lifecycle | 24 hours | 4 hours |
| Moderation: reports, cases, actions, Admin audit, feature-flag audit | 24 hours | 4 hours |
| Analytics: click aggregates and events | 24 hours, best effort | Best effort after redirects |

Redirect correctness beats availability: until a restore is verified, the
Worker keeps failing closed (503 unavailable page, no `Location`). It never
serves a guessed or unverified destination.

## Nightly backup

`.github/workflows/backup.yml` runs at 02:23 UTC:

1. `supabase db dump` (schema and data) for the target project.
2. Encrypts the archive with `age` to the founder's public key; only the
   founder's private key (offline, in the password manager) can decrypt it.
3. Uploads it with a SHA-256 checksum to a private Cloudflare R2 bucket.
   A bucket lifecycle rule deletes objects after 30 days.

A failed run makes GitHub email the repository owner. Set the GitHub
notification email to support@op4n.com (GitHub → Settings → Notifications →
Default notification email) so failures reach the monitored inbox.

### One-time setup (founder)

1. `age-keygen -o op4n-backup.key` on your computer. Keep the file in the
   password manager; never upload it. Copy the `age1…` public key.
2. Cloudflare → R2 → create a private bucket (for example `op4n-backups`);
   add a lifecycle rule "delete after 30 days"; create an R2 API token with
   Object Read & Write on that bucket only.
3. GitHub → Settings → Environments → **New environment `backup`** (no
   required reviewers, deployment branch: `main` only). Add:
   - secrets `BACKUP_SUPABASE_PROJECT_REF`, `BACKUP_SUPABASE_DB_PASSWORD`,
     `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY`;
   - variables `BACKUP_AGE_RECIPIENT` (the `age1…` key), `BACKUP_R2_BUCKET`,
     `BACKUP_DB_POOLER_HOST` (Supabase → Connect → Session pooler host).
4. Actions → Nightly database backup → Run workflow (target `staging`), and
   confirm the object appears in R2.
5. Add the repository variable `BACKUP_ENABLED=true` to turn on the nightly
   schedule (it stays off until then, so it never fails every night).

## Restore (rehearse on Staging before launch)

1. Download the newest `*.tar.gz.age` and its `.sha256` from R2; check the hash.
2. `age -d -i op4n-backup.key backup.tar.gz.age | tar -xz` → `schema.sql`, `data.sql`.
3. Create a fresh Supabase project (or reset a local one with `supabase start`).
4. Apply `schema.sql`, then `data.sql`, with `psql` against the new project.
5. Verify before serving traffic:
   - row counts of `issued_codes`, `canonical_links`, `protected_destination_versions`,
     `moderation_actions` match the source at backup time;
   - for 50 sampled codes, `resolve_canonical_redirect_v1(code)` returns the
     same `destinationFingerprint` and decision as the source;
   - run `purge_expired_click_events_v1()` and the report-detail retention job
     so restored data respects retention.
6. Point the API at the restored project (function secrets, then the approved
   deploy) and check readiness, SYNTHETIC1, and one test link.
7. Record the actual data-loss window and duration on the Order 84 card.
