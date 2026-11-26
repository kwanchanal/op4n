# Runbook: wrong-destination redirect (critical)

A short link that redirects to a destination other than the one stored for it
is a critical incident with zero error budget, even if only one link is
affected.

**Signals:** a user report; `redirect_integrity_failed` in Worker logs; a
mismatch between Admin Reveal and where the link actually goes.

**First 15 minutes**
1. Reproduce: `curl -sI https://op4n.me/<CODE>` and compare `Location` with
   Admin → Find link → Reveal (audited).
2. If they differ, disable the link in Admin immediately (reason
   `policy_violation`, note "wrong destination incident").
3. Check whether more codes are affected: sample 20 recent codes the same way.
4. If more than one link is wrong, pause creation (`guest_creation`) and
   discovery (`latest_links`, `public_search`).
5. If the cause is unknown and links keep resolving wrongly, take redirects
   offline: in Cloudflare, disable the `op4n.me/*` Worker route. Visitors then
   see an error instead of a wrong site. That is the safer failure.

**Escalation:** founder only; treat as a possible security incident and
follow [secret-rotation.md](secret-rotation.md) if tampering is possible.

**Communication:** email anyone who reported it. If people may have been sent
to a harmful site, publish a notice on op4n.com.

**Recovery verification:** every sampled code's `Location` matches its stored
destination; restore disabled links one at a time with `operator_correction`;
re-enable the Worker route last.

**Review:** mandatory, with a regression test for the cause.
