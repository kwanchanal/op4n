# R1 support and escalation

Feature Inventory Order 88. One monitored contact for everything in R1:
**support@op4n.com**. Cloudflare Email Routing forwards it to the founder's
inbox; the route was tested on 2026-11-26. The founder is the sole owner of
every request type. Separate mailboxes are out of scope for R1.

| Request type | Channel | Severity | Response target | Escalation | Retention |
| --- | --- | --- | --- | --- | --- |
| Phishing, malware, child safety (abuse) | Report link on any card, or email | S1 | Triage within 24 hours; disable immediately when confirmed | Founder disables in Admin; child safety is also reported to the relevant authority | Report detail 12 months after resolution; moderation actions for the life of the link |
| Other abuse (impersonation, harassment, spam, illegal) | Report link or email | S2–S3 | Triage within 3 days | Founder | Same as above |
| General support | Email | S3 | 3 business days | Founder | Email kept in the founder's inbox for 12 months |
| Privacy request (access, deletion, correction) | Email | S2 | Acknowledge within 7 days; complete within 30 days | Founder | Request and outcome log for 3 years |
| Legal or trademark complaint | Email | S2 | Acknowledge within 7 days | Founder; outside counsel if needed | 3 years |
| Security vulnerability | Email (listed in `/.well-known/security.txt`) | S1 | Acknowledge within 2 days | Founder; rotate secrets per the incident runbook | 3 years |
| Account recovery | Not applicable in R1 (no accounts) | — | — | — | — |
| Operational alerts (monitors, quotas, backups) | Automated email | Per alert | Per runbook | Founder | Provider retention |

Where the contact appears: the footer of `index.html` and `latest.html`, the
report confirmation, the blocked-destination message, the redirect Worker's
not-found and unavailable pages, the unavailable search result,
`/.well-known/security.txt`, and the legal pages (Order 93).

`tests/copy-policy.mjs` runs in CI and fails if any shipped file contains an
email address other than support@op4n.com.

Before launch, send a test message through each entry point (direct email,
report link, security.txt address) and confirm it reaches the founder. Record
the results on the Order 88 card.
