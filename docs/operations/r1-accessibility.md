# R1 accessibility (WCAG 2.2 AA)

Feature Inventory Order 90. Scope: index.html (creation, card, dialogs),
latest.html (list, search, states), legal pages, the redirect Worker's error
pages, and basic Admin operability.

## Automated checks

`tests/e2e/journeys.spec.mjs` runs axe-core with the WCAG 2.0, 2.1, and 2.2
A/AA rule sets on every journey state in Chromium, Firefox, and WebKit, and
fails on any serious or critical violation.

## Findings and fixes (2026-11-27)

| Finding | WCAG | Fix |
| --- | --- | --- |
| Guest disclosure text 4.34:1 | 1.4.3 contrast | Text darkened to #595959 (5.9:1 on #f5f5f5) |
| Click count 4.16:1 | 1.4.3 | #59616d |
| Promotional ".ME/" and contact line 3.1–3.8:1 | 1.4.3 | #5d6673 |
| Hidden contact sheet still focusable (`aria-hidden` with inputs) | 4.1.2, 2.4.11 | Sheet is `inert` while closed |
| Rotating banner, typewriter prompt, "YOU" word cycle | 2.2.2 pause, stop, hide | Do not start under `prefers-reduced-motion: reduce`; the message carousel and skeleton shimmer already stop, and the carousel pauses on hover and focus |
| Latest Links skeleton could shift layout | 2.4 / CLS | Fixed-height skeleton; measured CLS 0.0000 |

## Already in place

- Every input has a visible label and an error linked with `aria-describedby`;
  errors set `aria-invalid`.
- Status messages use `role="status"` / `aria-live` (creation, copy
  confirmation, report, search, Latest Links loading) (4.1.3).
- Locked previews are buttons with `aria-disabled="true"` and an accessible
  name ending "Registered to unlock"; state is never shown by color alone.
- Dialogs use `<dialog>` with labels; focus returns to the trigger on close.
- Action buttons are 24×24 px or larger (2.5.8).
- Layout reflows at 320 px with no horizontal scroll (1.4.10), checked by the
  journeys at 320, 768, and 1280 px.

## Manual smoke test

Run before each release as listed in `r1-release-test-matrix.md`, and record
the result on the Order 90 card.
