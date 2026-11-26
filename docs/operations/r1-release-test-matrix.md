# R1 release test matrix

Feature Inventory Order 89. What must pass before an R1 release, and where it
runs.

## Supported browsers and devices

| Target | Versions | Automated | Manual |
| --- | --- | --- | --- |
| Chrome, Edge (Chromium) | Latest two desktop versions | Playwright `chromium` | Release check |
| Firefox | Latest two desktop versions | Playwright `firefox` | Release check |
| Safari | Latest two desktop versions | Playwright `webkit` | Release check |
| iOS Safari | Current | WebKit engine via Playwright | Real iPhone before launch |
| Android Chrome | Current | Chromium engine via Playwright | Real Android phone before launch |
| Internet Explorer | Out of scope | — | — |

Older browsers get plain HTML pages without errors: every page renders its
text and links without JavaScript, and the short link itself works in any
browser because the redirect is a server-side 302.

## Viewports

320 px, 768 px, and 1280 px. `tests/e2e/journeys.spec.mjs` fails if any page
scrolls horizontally at these widths.

## Journeys

| Journey | Mock CI (3 browsers) | Staging release job (Chromium, real API and Worker) |
| --- | --- | --- |
| Create, see the public read-only card, copy, Open attributes | Yes | Yes |
| Keyboard only: focus the URL field, type, Enter | Yes | Yes |
| Invalid destination kept in place | Yes | Yes |
| Rate limit, blocked destination, withheld destination | Yes | Covered by `tests/staging-smoke.mjs` |
| Latest Links list and navigation | Yes | Yes |
| Latest Links empty, error, paused | Yes | — (scenario parameters are mock only) |
| Exact search: result, no result, unavailable, error, 429 | Yes | Result and no result in `staging-smoke.mjs` |
| Report from a card | Yes | Covered by `staging-smoke.mjs` |
| Legal pages: version, footer, links | Yes | Yes |
| Unknown and synthetic short codes on the short host | — | Yes |
| axe-core (WCAG 2.2 AA) on every state above | Yes | Yes |

CI: `.github/workflows/ci.yml` runs `npx playwright test` on every push and PR.
Release: `.github/workflows/deploy-staging.yml` runs the Chromium journeys
against Staging after the smoke test, waiting 65 s so the smoke test's
rate-limit burst does not block creation.

## Manual checks per release

Record results on the release's Feature Inventory card.

- **Keyboard only** (Chrome): Tab through index.html and latest.html. Every
  control is reachable, focus is visible and never hidden behind the mobile
  promotional sheet, Escape closes dialogs, focus returns to the trigger.
- **VoiceOver + Safari** (macOS or iPhone): create a link, hear "Short link
  created", copy it and hear "Copied", search a code and hear the result.
- **NVDA or Narrator + Chrome/Edge** (Windows): same as VoiceOver.
- **Real devices**: on an iPhone and an Android phone, create a link, open the
  short link, and check that the promotional sheet does not cover the form.

## Known issue: headless Firefox on CI

Since 2026-11-26, headless Firefox's content process crashes ("Page crashed")
on Linux GitHub runners during the interactive journeys on index.html and
latest.html. Diagnostic runs showed the same steps (fill, typing, axe scans)
pass in isolated contexts. Disabling trace screenshots, GPU compositing,
backdrop-filter, and parallel workers did not help. Chromium and WebKit pass
everything.

Until it is resolved, the Firefox project skips the journeys tagged
`@firefox-ci-crash` and still runs the keyboard, legal-page, and responsive
journeys. Run those five journeys by hand in desktop Firefox before each
release and record the result. Order 89 stays in Review until Firefox runs
the full suite in CI.
