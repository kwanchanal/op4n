# AGENTS.md — Op4n.com / op4n.me

This repository contains the prototype frontend and product logic for Op4n.com,
whose short-link domain is `op4n.me`.

Repository remote: `https://github.com/kwanchanal/op4n`

## Source of truth

The current product source of truth is the Notion Product Plan:

`https://app.notion.com/p/Product-Plan-3f6927fb12d48117b80dd65e6e959d40`

If this repository, an older brief, or prototype copy conflicts with that plan,
pause and resolve the product decision before shipping. The implementation
backlog is the Notion Feature Inventory:

`https://app.notion.com/p/3f6927fb12d480e6b49fdb465fde8a0f?v=3f6927fb12d480939944000c9de7f86a`

A card appearing in Feature Inventory is context, not authorization to implement
the entire board. Work only on the explicitly assigned card or approved ordered
batch.

## Current execution phase: R1 Production Preparation

Prototype Cleanup is complete. The verified handoff is the `main` branch of
`https://github.com/kwanchanal/op4n`, published at
`https://kwanchanal.github.io/op4n/`.

The next step is to approve an implementation order for R1, then execute the
Feature Inventory in that order. Until an order or individual card is explicitly
assigned, limit work to handoff documentation, verification, and changes the
user specifically requests. Do not start the whole backlog automatically.

For assigned Feature Inventory work:

- Set the card from `Draft` to `Doing` before implementation.
- Satisfy its Details and Acceptance Criteria.
- Verify the result proportionately to risk.
- Record the implementation evidence in `Results`.
- Move it to `Done` only after verification.
- Stop and surface any highlighted `PENDING` product decision rather than
  choosing policy on the user's behalf.

Mock data must stay clearly identified and separate from production behavior.
When a UI depends on an API that has not been implemented, keep deterministic
fixtures in dedicated config files and access them through replaceable service
interfaces.

## Approved R1 foundation

- Frontend: the current GitHub Pages prototype.
- DNS and redirect edge: Cloudflare, with `op4n.me` and `op4n.com` controlled
  by the owner.
- Production data: Supabase Free Postgres in the Singapore region.
- API convention: versioned REST endpoints under `/api/v1`.
- Redirect behavior: HTTP 302 with `Cache-Control: no-store`.
- R1 starts without a cache or queue; add either only from measured need.
- Delivery: GitHub Actions and Supabase CLI.
- Initial operating target: about 1,000 users, 1,000 new links per day, about
  10,000 redirects per day, and a 100,000-redirect/day spike.
- Ownership: a one-person business operated in an individual capacity.
- R1 uses `support@op4n.com` as the single monitored contact for support,
  abuse reports, privacy requests, operational alerts, and escalation. Cloudflare
  Email Routing forwards it to the founder's Gmail inbox, and the route has been
  tested successfully. Separate support, abuse, and operations mailboxes are out
  of scope for R1.

Do not introduce Paid, Premium, pricing, quota, or Custom Alias Lease behavior in
R1 unless the Product Plan and an explicitly assigned card say otherwise.
Custom Alias Lease is an R3 direction; system-generated canonical codes are
durable and are never reassigned.

## Product promise

Paste → Shorten → Copy in seconds, then see the public aggregate click count.

Anyone can create a usable short link without an account. Registration is for
ownership and control, not for completing the basic shortening flow.

## Product model

### Guest

- Can create, copy, share, browse, and exact-search public links when those R1
  systems are implemented.
- Can open destinations, see aggregate total clicks, and report public links.
- Creates public, read-only links and receives no ownership or recovery rights.
- Cannot edit, disable, delete, change visibility, manage settings, or use a real
  QR feature.

### Registered

- Will own links created while authenticated.
- Will eventually receive a personal library and authenticated management
  controls, including edit, disable/delete, visibility, owner analytics, and QR.
- Registered behavior remains non-functional until its R1 card is explicitly
  assigned and authenticated ownership is enforced.

### Admin

- Will moderate unsafe or abusive links and record disable/restore reasons.
- Moderation becomes functional only through explicitly assigned R1 cards.

There is no Paid plan in the current MVP scope.

## Guest and Registered capability boundary

Every visible control must be one of these modes:

1. `guest-action` — works for Guests now.
2. `registered-preview` — visible but locked and labeled
   `Registered to unlock`; it may only explain the feature or lead to Sign Up.
3. `registered-owner` — works only after authenticated ownership exists.
4. `retired` — removed from UI, state, listeners, and initialization.

Enforce this boundary in rendering and event logic, not with CSS alone. A short
code, URL parameter, browser state, or localStorage value never proves ownership.
A Registered preview must not mutate data, call an owner API, generate or
download a real asset, or imply that the Guest owns the link.

Approved future Registered features may be shown as locked previews when useful,
including Edit, Privacy/Visibility, Link Settings, custom slug, detailed
analytics, and QR. Every preview must say `Registered to unlock`. Remove retired,
destructive, undefined, Paid, Premium, Upgrade, pricing, and quota controls.

## R1 direction

R1 is the public Guest experience:

- Anonymous link creation.
- Working short-link redirect.
- Public, read-only Created Link card.
- Public aggregate total clicks.
- Latest 100 eligible public links.
- Exact search by canonical short URL or code.
- Report and Admin moderation flow.
- Required validation, safety states, and rate limiting.

Production persistence, redirects, click recording, listing/search APIs,
moderation, and safety enforcement must be implemented only through the approved
R1 order or an explicitly assigned Feature Inventory card.

## Public-link and ownership invariants

- Active Public and Unlisted links redirect without sign-in.
- Guest links have no functional owner-facing management capability.
- A short code alone never authorizes editing, deletion, QR, or settings.
- Public listings never include Unlisted, disabled, deleted, or unsafe links.
- Public cards never expose private account, IP, device, or moderation data.
- Registered management actions require authenticated ownership.
- UI must not imply a Paid tier while Paid plans are out of scope.

Before Guest creation, clearly disclose that the link is public and read-only;
its Title, short URL, safe destination summary, and aggregate click count may
appear in Latest Links and exact search, and the Guest cannot edit or delete it
later. Public cards may show the destination origin and approved safe path, but
must hide query strings and fragments with an explicit marker such as `?…`.
The full destination must not appear in public card text or HTML attributes.

## Branding and interface guidance

- Use `Op4n.com` for the website/master brand.
- Use `https://op4n.me/{code}` for canonical Example and mock short links.
- Internal repository references may still use `openme`.
- Preserve the promotional phone-style showcase panel, locked navigation,
  current visual language, typography, useful prototype design work, and
  accessibility guidance.
- Keep Paste → Shorten → Copy the dominant path.
- Use semantic controls, visible focus states, keyboard support, accessible
  names, and appropriate live regions for transient status.
- Preserve typed form data after errors and never hide failures with a blanket
  `try/catch`.

## Safety guidance

- Accept only supported HTTP and HTTPS destinations.
- Escape and sanitize public Titles and URLs before rendering.
- Public discovery requires safety screening and rate limits when implemented.
- Report controls must not reveal sensitive moderation logic.
- Unknown and disabled short codes require distinct user-facing states in the
  future production flow.

## Change discipline

- Prefer the smallest coherent change for the active Feature Inventory card.
- Audit references before removing legacy code or assets.
- Preserve unrelated user changes in the working tree.
- Verify each assigned card against its acceptance criteria before marking it `Done`.
- Keep fixtures deterministic and do not generate random fake activity.
- Keep future service contracts independent from their mock adapters so a later
  production API does not require rewriting UI components.
