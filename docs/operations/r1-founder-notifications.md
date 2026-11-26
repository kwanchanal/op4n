# R1 founder notifications

- Status: Implemented on Staging (Feature Inventory "Notify the founder of new reports and safety blocks")
- Owner: Founder
- Last updated: 2026-11-26
- Related: [moderation policy](r1-moderation-policy.md), [Admin access](r1-admin-access.md), [OpenAPI](../api/r1-openapi.yaml)

## Flow

1. `submit_report_v1` inserts a `notification_outbox` row in the same
   transaction as the report. The future re-screening job will call
   `enqueue_safety_block_notification_v1` the same way.
2. Every 5 minutes, the Worker `op4n-notifier-<env>` calls
   `POST /api/v1/internal/notifications/claim` using the internal service
   credential. The claim leases due rows for 120 seconds under one batch ID and
   groups them by short code, kind, and reason.
3. The Worker sends a single plain-text digest through the Cloudflare Email
   `send_email` binding, from `notify-<env>@op4n.com` to the verified Email
   Routing destination stored in the Worker secret `NOTIFY_TO`.
4. The Worker then calls `.../notifications/complete` with the outcome `sent` or `failed`.

## Guarantees

| Concern | Behavior |
| --- | --- |
| Batching | All due events go into one email per 5-minute run. Ten reports become one digest. |
| Content | Each entry shows the short code, the reason category or "automatic safety block", a count, first and last times, a link to `/admin`, and the triage targets. Destinations, query strings, report text, and reporter data are never included. |
| Loss | Rows stay in the outbox until they are completed as sent. A crashed run's lease expires and the rows are claimed again. |
| Duplicates | Delivery is at-least-once. Only a crash between sending and completing can resend a digest. `Message-ID` is `<batchId@op4n.com>`, so the duplicate is identifiable. |
| Retries | A failed send retries after 5 and then 20 minutes. After 3 failures the rows become `failed`, and the Worker logs `founder_notification_exhausted`; the monitoring alert card will page on it. |
| Retention | Sent rows are purged after 30 days by the daily pg_cron job `op4n_purge_sent_notifications`. Failed rows stay until the founder reviews them. |

## Provider decision

Cloudflare Email (Email Routing `send_email`) was chosen by the founder on
2026-11-26 because it is free and needs no new account. Its limit is that it can
send only to verified destination addresses. That fits, because every message
goes to the founder. `support@op4n.com` is a routing address and cannot be a
`send_email` destination, so both Staging and Production send to the verified
founder mailbox that `support@` already forwards to. Subjects carry the
environment label, for example `[Op4n Staging]`.

The address is held only in the GitHub Environment secret
`NOTIFY_DESTINATION_EMAIL` and in the Worker secret `NOTIFY_TO`. It is never in
the repository, a Worker var, or the logs.

## Production checks (cutover)

- Deploy `op4n-notifier-production` with `NOTIFY_FROM = notify@op4n.com`.
- Send one test digest and confirm that Gmail shows SPF and DKIM `PASS` for
  op4n.com (Show original).
