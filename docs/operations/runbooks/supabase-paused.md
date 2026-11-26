# Runbook: Supabase project paused

Free-plan projects pause after a period of inactivity. The 5-minute
UptimeRobot checks normally prevent this.

**Signals:** every API call fails; readiness unreachable; the Supabase
dashboard shows "Paused".

**First 15 minutes**
1. Supabase dashboard → the project → **Restore project**.
2. Redirects fail closed (503) until it is back; nothing is lost.
3. When restored, check readiness and SYNTHETIC1.

**Prevention:** confirm the UptimeRobot monitors are active; if pauses repeat,
consider the paid plan (founder decision; see the quotas document).

**Recovery verification:** readiness 200; SYNTHETIC1 302; Admin loads.
