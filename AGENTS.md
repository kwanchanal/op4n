# AGENTS.md — Op4n.com / op4n.me

This repository contains the prototype frontend and product logic for Op4n.com,
whose short-link domain is `op4n.me`.

Repository remote: `https://github.com/kwanchanal/op4n`

## Source of truth

The current product source of truth is the Notion Product Plan:

`https://app.notion.com/p/Product-Plan-3f6927fb12d48117b80dd65e6e959d40`

If this repository, an older brief, or prototype copy conflicts with that plan,
pause and resolve the product decision before shipping. The Feature Inventory is
future implementation context, not authorization to build those features during
Prototype Cleanup.

## Current execution phase: Prototype Cleanup

The active work is cleanup of the existing prototype before production R1
implementation. Work through the Prototype Cleanup board in numeric ID order.
Set a card to `Doing` before starting it, and to `Done` only after its acceptance
criteria have been verified. Record a short implementation summary in `Results`;
record unresolved questions or blockers in the card notes.

The currently authorized Prototype Improvement pass extends Cleanup through ID
30 only:

- ID 25 updates this execution boundary.
- IDs 26–29 are presentation and interaction improvements.
- ID 30 is the final verification and stop condition.

Stop after Cleanup ID 30 passes. Do not continue into Feature Inventory or
production implementation unless the user explicitly instructs you to do so.

During this phase you may:

- Refactor the frontend and remove confirmed legacy-only code.
- Separate fixtures, configuration, rendering, and service interfaces.
- Prepare reusable components and replaceable data/service adapters.
- Implement deterministic frontend states, validation, accessibility, and
  responsive behavior required by the Cleanup board.
- Use deterministic mock records and responses from dedicated fixture/config
  files when a UI depends on a future API or backend.

During this phase do not implement:

- A production database or persistence layer.
- A production redirect service.
- Authentication, account ownership, or authorization.
- Latest Links, exact-search, click-recording, or moderation APIs.
- Functional Registered-owner features, including real QR generation/download.
- Paid plans, pricing, quotas, Premium, or Upgrade behavior.

Mock data must be clearly identified in code. It must not be described as
persisted, safety-approved, delivered to an Admin, or returned by production.
Keep mock Created Link data separate from curated Example fixtures, and access
future backend-shaped data through replaceable service interfaces.

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
- Registered behavior is future implementation and must remain non-functional
  during Prototype Cleanup.

### Admin

- Will moderate unsafe or abusive links and record disable/restore reasons.
- Production moderation systems are outside Prototype Cleanup.

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
moderation, and safety enforcement belong to later Feature Inventory work, not
this Cleanup phase.

## Public-link and ownership invariants

- Active Public and Unlisted links redirect without sign-in.
- Guest links have no functional owner-facing management capability.
- A short code alone never authorizes editing, deletion, QR, or settings.
- Public listings never include Unlisted, disabled, deleted, or unsafe links.
- Public cards never expose private account, IP, device, or moderation data.
- Registered management actions require authenticated ownership.
- UI must not imply a Paid tier while Paid plans are out of scope.

Before Guest creation, clearly disclose that the link is public and read-only;
its Title, short URL, destination URL, and aggregate click count may appear in
Latest Links and exact search, and the Guest cannot edit or delete it later.

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

- Prefer the smallest coherent change for the active Cleanup card.
- Audit references before removing legacy code or assets.
- Preserve unrelated user changes in the working tree.
- Verify each card against its acceptance criteria before marking it `Done`.
- Keep fixtures deterministic and do not generate random fake activity.
- Keep future service contracts independent from their mock adapters so a later
  production API does not require rewriting UI components.
