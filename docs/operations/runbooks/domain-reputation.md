# Runbook: domain reputation or blocklisting

**Signals:** browsers show a "deceptive site" warning on op4n.me; email from
Google Safe Browsing, a registrar, or Cloudflare Trust & Safety; links stop
working in messaging apps.

**First 15 minutes**
1. Check https://transparencyreport.google.com/safe-browsing/search for
   op4n.me and op4n.com.
2. Find the cause: Admin → Reports queue, and recent links to the flagged URLs.
3. Disable every abusive link; pause creation (`guest_creation`) until clean.
4. Pause `latest_links` and `public_search` if abusive links are listed.

**Escalation:** request a review through Google Search Console (Security
issues) once clean; reply to the registrar or Cloudflare notice with the
actions taken.

**Communication:** reply to affected users; a site notice if warnings persist.

**Recovery verification:** the transparency report shows no unsafe content;
the browser warning is gone; resume surfaces one at a time.
