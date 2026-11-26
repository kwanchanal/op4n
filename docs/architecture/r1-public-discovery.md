# R1 public discovery

How a Guest link becomes visible in Latest Links and exact search, and what a
public card may show. Feature Inventory Orders 61–63, 65, 72, 76, and 78.

## Destination summary: `r1-safe-path-v1` (Order 65)

Founder decision (2026-11-26): public cards show the origin plus a safe path.

The server builds the summary once, at creation, and stores it on the
destination version. Every public surface renders `safeDestinationSummary.displayValue`
and nothing else.

| Rule | Detail |
| --- | --- |
| Origin | Always shown. |
| Path | Leading segments are shown only while each one is an ordinary word. |
| Cut | At the first segment that fails, everything after it is hidden and marked `/…`. |
| Limit | At most 3 segments and 64 characters of path. |
| Query and fragment | Never shown; marked `?…` when nothing else was cut. |
| Withheld link | Origin only, with `/…` if anything follows it. |

A segment is shown only when all of these hold:

- letters, digits, and `-` `_` `.` only, at most 32 characters, no percent-encoding;
- no run of 8 or more characters that mixes letters and digits;
- no run of 20 or more characters, no 5 or more digits, no all-capital run of 8 or more, and no random-looking mixed case such as `AbCdEfGh`;
- not a word that marks a private flow, such as `reset`, `invite`, `token`, `login`, `verify`, `share`, `download`, `account`, `orders`, or `user` (full list in `supabase/functions/_shared/safe-summary.mjs`).

| Destination | Card shows |
| --- | --- |
| `https://shop.com/products/running-shoes?ref=ig` | `https://shop.com/products/running-shoes?…` |
| `https://site.com/reset/AbC9xYz123` | `https://site.com/…` |
| `https://docs.example.com/guide/v2/install/linux` | `https://docs.example.com/guide/v2/install/…` |
| `https://youtube.com/watch?v=abc` | `https://youtube.com/watch?…` |
| `https://example.com/blog/2024/hello-world` | `https://example.com/blog/2024/hello-world` |

The Open action always uses `canonicalOpenUrl`, never the summary.

## Discovery screening: `r1-discovery-v1` (Order 61)

At creation the server checks the destination against versioned rules in
`supabase/functions/_shared/discovery-rules.mjs`. A match withholds the link
from Latest Links and exact search. The link still redirects. The create
response says `publicDiscovery: withheld`.

| Category | Matches |
| --- | --- |
| `sensitive_parameter` | Query or fragment names such as `token`, `code`, `state`, `sig`, `password`, `session`, and `X-Amz-*` / `X-Goog-*` signed-URL parameters. |
| `sensitive_path` | Segments such as `reset`, `invite`, `verify`, `oauth`, `callback`, `unsubscribe`. |
| `secret_token` | A UUID, 24+ hex characters, or 20+ characters mixing letters and digits. |
| `private_share_host` | Google Docs and Drive, Dropbox, OneDrive, SharePoint, WeTransfer, Zoom, Stripe Checkout. |

The link stores the result and the rule version. A new rule version applies to
new links only, so it never re-publishes an old withheld link. Only category
names are produced; parameter values and paths are never logged or stored.

The founder can override a false positive or negative from the Admin record
(`POST /api/v1/admin/links/{code}/discovery`). Each override is an audited
`discovery_override` moderation action and takes effect on the next request.

## Eligibility (Order 62)

A link appears in Latest Links and exact search only when all of these hold:

- the code is issued, the link is `active`, safety is `approved`, and visibility is `public`;
- discovery is `eligible` (the Admin override wins over the screening result);
- there is no open S1 moderation case.

Disable and restore change only the lifecycle state. They no longer touch the
discovery result.

## Exact lookup outcomes (Orders 72, 76, 78)

| Code state | Response |
| --- | --- |
| Eligible | `200` with the six-field card. |
| Unknown, withheld, open S1, or not public | `404 LINK_NOT_FOUND`, identical for all four. |
| Disabled, deleted, blocked, pending, or retired | `404 LINK_DISABLED`, no card fields. |
| Not an exact short URL or code | `400 VALIDATION_ERROR`, before any database query. |

## Rate limits (Order 64)

| Class | Endpoints | Per identity | Global |
| --- | --- | --- | --- |
| `public-read` | `GET /links`, `GET /links/{code}` | 120 / minute | 6,000 / minute |
| `public-search` | `GET /link-lookup` | 30 / minute, 300 / day | 50,000 / day |

A limiter failure returns 503 for that class only. Redirects never use these
limits. The founder approves the numbers before Production.
