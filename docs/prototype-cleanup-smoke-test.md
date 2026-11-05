# Prototype Cleanup smoke test

Date: 2026-10-13  
Stop condition: Prototype Improvement ID 30

Command used against the local prototype:

```sh
node tests/prototype-smoke.mjs 9228
```

Result: **PASS**

Verified at representative desktop and mobile widths:

- Browser title `OP4N.COM`, valid `image/svg+xml` ✱ favicon, initial Example
  state, Guest disclosure, and locked navigation.
- Separate curated Example fixture and deterministic mock Created Link service
  records with 0, 1, and 128 clicks.
- Blank/unsupported URL validation, one-result duplicate prevention, prototype-
  only success copy, all configured creation failures, and safe retry.
- Compact public-card hierarchy with no Created Link tag, a labeled Destination
  URL field, safe long-content treatment, and visible aggregate Clicks.
- Accessible icon toolbar with working Copy, Open, Clicks, and simulated Report
  Guest actions. Every action has an accessible name/tooltip contract.
- Focusable grey Registered previews with `aria-disabled="true"`; keyboard
  activation shows the exact `Registered to unlock` explanation without a
  mutation or owner API. The non-live QR showcase contains no generated image,
  canvas, blob URL, data URL, or download path.
- Native dialog focus entry, Escape close, and focus return.
- Desktop promotional showcase remains in the approved right column. At mobile
  widths it opens as the restored bottom sheet, uses an arrow-only handle,
  auto-collapses smoothly on downward scrolling, and retains accurate ARIA state
  plus manual expand/collapse access to its fictional content and CTA.
- No clipping or horizontal scrolling at 320, 768, 1024, and 1440 px.
- Reload returns to the Created Link default view and does not claim persistence
  for a session-created mock result; Example remains a separate selectable fixture.
- No production fetch/XHR and zero uncaught JavaScript exceptions.

No production backend, redirect service, analytics recording, report delivery,
authentication, ownership, real QR generation, or functional Registered feature
was implemented. No verification failure remained, so no follow-up Draft card
was required. The Prototype Improvement pass stops at ID 30; Feature Inventory
remains Draft until explicitly authorized.
