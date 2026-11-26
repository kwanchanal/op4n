# Runbook: redirect outage

**Signals:** UptimeRobot "synthetic redirect" down twice in a row; Cloudflare
Worker 5xx above 2% for 10 minutes; user emails; `redirect_lookup_failed`
in Worker logs.

**First 15 minutes**
1. Open `https://op4n.me/SYNTHETIC1` (Staging: `staging.op4n.me`). 302 means
   the path works; 503 "temporarily unavailable" means the lookup is failing.
2. Call readiness (service credential from the password manager):
   `curl -H "Authorization: Bearer $CRED" <API>/api/v1/internal/health/ready`.
   The failing check names the layer: `database`, `schema`, or `redirectLookup`.
3. Check status pages: https://www.cloudflarestatus.com and https://status.supabase.com.
4. Check Supabase: is the project paused (see [supabase-paused.md](supabase-paused.md))
   or out of a quota?

**Safe degradation:** none needed for redirects; the Worker already fails
closed with a 503 page and never guesses a destination. Pause creation
(`guest_creation`) if new links cannot be verified.

**Escalation:** Supabase or Cloudflare support ticket from the dashboard if
the provider is at fault for more than 30 minutes.

**Communication:** if longer than 30 minutes, reply to affected users from
support@op4n.com: "Short links are temporarily unavailable; no link has been
changed or lost."

**Recovery verification:** SYNTHETIC1 returns 302; readiness returns 200;
create a test link on Staging and open it; UptimeRobot green for 30 minutes.

**Review:** write the post-incident review (template in README).
