# Runbook: abuse or phishing campaign

**Signals:** many reports at once (founder digest emails); open S1 report
older than 24 hours; a spike in creates or in `DESTINATION_BLOCKED`; a
provider or registrar abuse notice.

**First 15 minutes**
1. Admin → Reports queue: sort by severity, open the top cases.
2. Disable confirmed links (reason `abuse_report` or `policy_violation`).
3. If new abusive links keep appearing, pause creation (`guest_creation`).
4. If abusive links are visible publicly, pause `latest_links` and
   `public_search` while you clean up. Valid links keep redirecting.
5. Note the destination domains involved; repeat domains go to the denylist
   process in the moderation policy.

**Escalation:** child-safety content is reported to the relevant authority;
phishing against a brand can be reported to that brand.

**Communication:** reply to reporters from support@op4n.com once handled.

**Recovery verification:** no confirmed abusive link left active; resume
paused surfaces one at a time and watch the queue for 1 hour.

**Rehearsal (Staging):** create 3 test links, report each as phishing, confirm
the digest arrives, disable them in Admin, pause and resume `latest_links`.
Record the result on the Order 87 card.
