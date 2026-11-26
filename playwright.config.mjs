// Release test matrix (Feature Inventory Orders 89, 90). Mock mode (default)
// serves the repository with the deterministic mock adapters. Staging mode:
//   E2E_BASE_URL=https://staging.op4n.com E2E_SHORT_ORIGIN=https://staging.op4n.me npx playwright test
import { defineConfig, devices } from "@playwright/test";

const staging = Boolean(process.env.E2E_BASE_URL);
const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  // Reduced motion keeps rotating text still, so axe never samples a word
  // mid-fade; it also exercises the WCAG 2.2.2 reduced-motion path.
  use: { baseURL, trace: "retain-on-failure", reducedMotion: "reduce" },
  webServer: staging ? undefined : {
    command: "node tests/e2e/static-server.mjs",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.env.E2E_CHROME_CHANNEL ? { channel: process.env.E2E_CHROME_CHANNEL } : {}) } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        trace: "off",
      },
      // KNOWN ISSUE (Order 89, open): headless Firefox's content process
      // crashes on Linux CI runners during these journeys on index.html and
      // latest.html. The same steps pass in isolated contexts, and the pages
      // pass in Chromium and WebKit. Tracked on the Order 89 card; Firefox is
      // covered by a manual release check until resolved.
      grepInvert: /@firefox-ci-crash/,
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
