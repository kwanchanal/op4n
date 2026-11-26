# Runbook: database incident or restore

**Signals:** readiness `database` or `schema` not ready; 503 on create, list,
search, and redirects; Supabase dashboard errors.

**First 15 minutes**
1. Check https://status.supabase.com and the project's dashboard (paused,
   quota, maintenance).
2. Pause creation and reports (`guest_creation`, `public_reports`) if the
   database is reachable but unhealthy, so no partial writes land.
3. Redirects already fail closed (503, no `Location`).

**Restore (data loss or corruption)** — follow `docs/operations/r1-backup-restore.md`:
1. Restore the latest encrypted nightly dump into a new or Staging project.
2. Verify: sampled codes resolve to the same destination fingerprints as
   before; moderation and disable states match.
3. Point the API at the restored project (update the function secrets, then
   redeploy through the approved workflow).
4. Until verification passes, the Worker keeps failing closed. Never serve a
   restore that has not been verified.

**Escalation:** Supabase support ticket for platform faults.

**Communication:** status note on op4n.com if longer than 30 minutes.

**Recovery verification:** readiness 200; SYNTHETIC1 302; a test link created
and opened; Admin shows expected moderation history.

**Review:** include the actual data-loss window versus the RPO.
