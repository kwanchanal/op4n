# R1 incident runbooks

Feature Inventory Order 87. The founder is the incident owner and the only
responder. Alerts and user reports arrive at support@op4n.com.

| Runbook | Use when |
| --- | --- |
| [redirect-outage.md](redirect-outage.md) | Short links return 503 or time out |
| [wrong-destination.md](wrong-destination.md) | Any short link sends people to the wrong place (critical) |
| [database-incident.md](database-incident.md) | Postgres is down, corrupted, or needs a restore |
| [abuse-campaign.md](abuse-campaign.md) | Many phishing, malware, or spam links appear at once |
| [secret-rotation.md](secret-rotation.md) | A key, token, or credential may be exposed |
| [domain-reputation.md](domain-reputation.md) | op4n.me or op4n.com is blocklisted or flagged |
| [provider-outage.md](provider-outage.md) | Cloudflare, Supabase, the safety provider, or email is down |
| [supabase-paused.md](supabase-paused.md) | The Supabase Free project is paused |

## Kill switches (safe degradation)

Run in the Supabase SQL Editor of the affected project. Each change needs a
new reason and is written to `feature_flag_audit`. Redirects never read these
flags, so valid short links keep working.

```sql
-- Pause one surface: guest_creation | latest_links | public_search | public_reports
update public.feature_flags
set enabled = false, reason = 'INCIDENT <id>: <why>'
where flag_key = 'latest_links';

-- Resume it
update public.feature_flags
set enabled = true, reason = 'INCIDENT <id> resolved: <evidence>'
where flag_key = 'latest_links';

-- Check current state and recent changes
select flag_key, enabled, reason, updated_at from public.feature_flags order by flag_key;
select * from public.feature_flag_audit order by occurred_at desc limit 10;
```

Disabling one link: Admin (`/admin`) → Find link → Disable, with a reason.

## Post-incident review (template)

Write within 7 days, in `docs/operations/incidents/YYYY-MM-DD-<slug>.md`:

1. Summary: what users saw, start and end time (UTC), impact (links, clicks, reports).
2. Detection: which signal fired, and how long until it was noticed.
3. Timeline of actions.
4. Root cause.
5. What went well, and what was hard.
6. Follow-up cards in the Feature Inventory, each with an owner and a date.
