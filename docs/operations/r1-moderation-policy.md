# R1 moderation response policy and audit evidence

- Status: Proposed for founder confirmation (see [Pending decisions](#pending-decisions))
- Scope: Feature Inventory R1, "Define moderation response policy and audit evidence"
- Decision owner and sole initial moderator: Founder
- Last updated: 2026-11-23
- Related: [API contract](../api/r1-api-contract.md), [OpenAPI](../api/r1-openapi.yaml), [database schema](../architecture/r1-database-schema.md), [data retention](../security/r1-data-retention.md)

## Principles

- Every public link card can be reported by anyone. A report never disables a
  redirect by itself; only an audited Admin action does.
- Report state, moderation state, safety verdicts, and Admin identity are never
  shown publicly. Reporters receive only an opaque receipt.
- Ordinary queue views never show the full destination; revealing it is an
  explicit, audited action.
- An IP address is never treated as a person's identity for moderation.

## Report categories, severity, and response targets

The public `reasonCategory` values are the OpenAPI `ReportRequest` enum.

| `reasonCategory` | Meaning | Severity | Triage target | Discovery while open |
| --- | --- | --- | --- | --- |
| `phishing` | Credential or payment theft, impersonated login | S1 | 24 hours | Withheld from Latest Links and search |
| `malware` | Malicious downloads or exploit pages | S1 | 24 hours | Withheld |
| `child_safety` | Sexual content involving minors or child exploitation | S1 | 24 hours, legal escalation | Withheld |
| `illegal` | Other clearly illegal content | S2 | 72 hours | Unchanged |
| `impersonation` | Brand or person impersonation, trademark misuse | S2 | 72 hours | Unchanged |
| `abuse` | Harassment, hate, scams not covered above | S2 | 72 hours | Unchanged |
| `spam` | Unsolicited bulk promotion | S3 | 7 days | Unchanged |
| `other` | Anything else | S3 | 7 days | Unchanged |

Targets fit one operator. They are triage targets (first Admin decision), not
resolution guarantees. An open S1 report withholds discovery automatically;
the redirect itself keeps working until the founder disables it.

## Admin actions and required evidence

Each action is one database transaction that changes state and appends an
immutable `moderation_actions` row (see the schema document). If the audit
write fails, the action fails and the previous state stays.

| Action | Effect | Required fields | `reasonCode` values |
| --- | --- | --- | --- |
| Disable | Redirect shows the unavailable page; link leaves discovery | actor, timestamp, reason code, link | `abuse_report`, `safety_block`, `policy_violation` |
| Restore | Redirect and discovery eligibility return | actor, timestamp, reason code, link | `operator_correction`, `abuse_report` |
| Triage / resolve report | Report workflow state changes | actor, timestamp, note | — |
| Reveal destination | Admin sees the full destination in the queue | actor, timestamp, link | — |
| Hold (R3 aliases) | Not used in R1 | — | — |

Restore is forbidden while the link's safety state is `pending` or `blocked`
(API contract). `reasonDetail` is optional, Admin-only, and never public or
logged.

## Repeat offenders

- The same destination fingerprint or registrable domain disabled twice within
  90 days is added to the platform denylist (see "Malicious URL screening").
- Repeated reports from one source are not used to identify a person; rate
  limits (`public-report` class) bound report volume instead.

## Mistaken disable: correction path

1. Anyone may write to support@op4n.com; the founder re-checks the link.
2. If the disable was mistaken and safety is `approved`, the founder restores
   it with `operator_correction` and a note.
3. Both actions remain in history; nothing is deleted.

## Appeals

Appeals and trademark complaints go to support@op4n.com. The founder answers
within the S2 target (72 hours). Guest links have no owner account in R1, so
appeals are handled by email only.

## Retention

Report detail is retained 12 months after resolution, then deleted (see the
data retention document). Moderation actions and audit records are kept for
the life of the link.

## Pending decisions

- Founder confirms the categories and response targets above.
- Legal reporting duties for `child_safety` depend on the operating
  jurisdiction decided in the Privacy Notice and Terms card.
