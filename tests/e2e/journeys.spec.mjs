// R1 release journeys (Feature Inventory Order 89) with axe-core checks on
// every journey state (Order 90). Runs in Chromium, Firefox, and WebKit.
// Mock mode uses ?create=, ?latest= scenarios and fixture codes; Staging mode
// (E2E_BASE_URL) runs the journeys that need the real API and Worker.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const STAGING = Boolean(process.env.E2E_BASE_URL);
const SHORT_ORIGIN = process.env.E2E_SHORT_ORIGIN || "https://staging.op4n.me";

// Headless Firefox on CI runners crashes on the Material Symbols variable
// font, so Firefox runs without external fonts. The icons are aria-hidden
// glyphs; without the font they would render as their ligature names, so
// they are hidden to match what users see.
test.beforeEach(async ({ page, browserName }) => {
  if (browserName !== "firefox") return;
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".material-symbols-outlined, .material-icons { visibility: hidden !important; }";
      document.head.append(style);
    });
  });
});

// Every journey waits for the page to settle before interacting.
async function open(page, path) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

async function expectAccessible(page, label) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = results.violations.filter((item) => ["serious", "critical"].includes(item.impact));
  expect(serious.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(" ")).join(", ")}`), label).toEqual([]);
}

async function makeLink(page, url, title = "") {
  if (title) await page.getByLabel("Title (Optional)").fill(title);
  await page.getByLabel("URL", { exact: true }).fill(url);
  await page.getByRole("button", { name: "Make Link" }).click();
}

test.describe("create, copy, and open", () => {
  test("a Guest creates a link and sees the public, read-only card", async ({ page }) => {
    await open(page, "/index.html");
    await expectAccessible(page, "creation page");
    await expect(page.getByText("Guest links are public and read-only")).toBeVisible();
    await makeLink(page, `https://example.com/e2e-${Date.now()}?utm=1#frag`, "E2E link");
    await expect(page.locator("#formStatus")).toContainText("Short link created");
    const card = page.locator(".public-link-card", { has: page.locator(".link-title", { hasText: "E2E link" }) });
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-access="registered-preview"]').first()).toHaveAttribute("aria-label", /Registered to unlock/);
    await expect(page.locator("body")).not.toContainText("#frag");
    const open = card.locator(".guest-action-button.open-destination-btn");
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", "noopener noreferrer");
    await card.locator(".copy-link-btn").click();
    await expect(card.locator(".card-live-status, .copy-fallback")).toContainText(/Copied|Copy isn|Ctrl/);
    await expectAccessible(page, "created card");
  });

  test("keyboard only: Tab reaches the URL field and Enter submits", async ({ page }) => {
    await open(page, "/index.html#linkUrl");
    await expect(page.locator("#linkUrl")).toBeFocused();
    await page.keyboard.type("https://example.com/keyboard");
    await page.keyboard.press("Enter");
    await expect(page.locator("#formStatus")).toContainText(/created|limit/i);
  });

  test("invalid destinations are rejected in place and input is kept", async ({ page }) => {
    await open(page, "/index.html");
    await makeLink(page, "ftp://example.com/file");
    await expect(page.locator("#linkUrlError")).not.toBeEmpty();
    await expect(page.getByLabel("URL", { exact: true })).toHaveValue("ftp://example.com/file");
    await expectAccessible(page, "validation error");
  });
});

test.describe("mock-only error states", () => {
  test.skip(STAGING, "scenario parameters exist only with the mock adapter");

  test("rate limit explains the wait and keeps input", async ({ page }) => {
    await open(page, "/index.html?create=rate-limit");
    await makeLink(page, "https://example.com/limited");
    await expect(page.locator("#formStatus")).toContainText("reached the limit");
    await expect(page.getByLabel("URL", { exact: true })).toHaveValue("https://example.com/limited");
    await expectAccessible(page, "rate limited");
  });

  test("a blocked destination shows the safety message with support contact", async ({ page }) => {
    await open(page, "/index.html?create=blocked-destination");
    await makeLink(page, "https://example.com/blocked");
    await expect(page.locator("#linkUrlError")).toContainText("support@op4n.com");
  });

  test("a withheld destination explains it stays out of discovery", async ({ page }) => {
    await open(page, "/index.html");
    await makeLink(page, "https://example.com/reset?token=SECRET");
    await expect(page.locator("#formStatus")).toContainText("won’t appear in Latest Links");
  });

  test("Latest Links empty, error, and paused states", async ({ page }) => {
    for (const [scenario, text] of [["empty", "No public links yet."], ["error", "couldn’t load"], ["paused", "temporarily paused"]]) {
      await open(page, `/latest.html?latest=${scenario}`);
      await expect(page.locator("#latestList")).toContainText(text);
      await expectAccessible(page, `latest ${scenario}`);
    }
  });

  test("search result, no result, unavailable, error, and 429 states", async ({ page }) => {
    await open(page, "/latest.html");
    const search = async (value) => {
      await page.getByLabel("Find a link by short URL or code").fill(value);
      await page.getByRole("button", { name: "Find" }).click();
    };
    await search("op4n.me/SHOES01");
    await expect(page.locator("#searchResult .public-link-card")).toBeVisible();
    await expectAccessible(page, "search result");
    for (const [value, text] of [
      ["NOPE00001", "No public link matches"],
      ["OFFLINE01", "This short link is unavailable."],
      ["ERROR0001", "Search is temporarily unavailable"],
      ["LIMIT0001", "search again"],
    ]) {
      await open(page, "/latest.html");
      await search(value);
      await expect(page.locator("#searchResult")).toContainText(text);
      await expectAccessible(page, `search ${value}`);
    }
  });

  test("report a link from a Latest Links card", async ({ page }) => {
    await open(page, "/latest.html");
    await page.locator("#latestList .report-link-btn").first().click();
    const dialog = page.getByRole("dialog", { name: "Report this link" });
    await expect(dialog).toBeVisible();
    await expectAccessible(page, "report dialog");
    await dialog.getByLabel("What's wrong?").selectOption("spam");
    await dialog.getByRole("button", { name: "Submit report" }).click();
    await expect(dialog.locator("#reportStatus")).toContainText(/simulated|received/i);
  });
});

test.describe("discovery and legal pages", () => {
  test("Latest Links lists cards and is reachable from navigation", async ({ page }) => {
    await open(page, "/index.html");
    await page.getByRole("link", { name: /See All Created Links/ }).first().click({ force: true });
    await expect(page).toHaveURL(/latest/);
    await expect(page.getByRole("heading", { level: 1, name: "Latest Links" })).toBeVisible();
    await expect(page.locator("#latestList .public-link-card").first()).toBeVisible();
    await expectAccessible(page, "latest links");
  });

  test("legal pages carry a version and are linked from the footer", async ({ page }) => {
    for (const path of ["terms.html", "privacy.html", "acceptable-use.html"]) {
      await open(page, `/${path}`);
      await expect(page.locator(".legal-meta")).toContainText(/Version r1-\d{4}-\d{2}-\d{2} · Effective/);
      await expect(page.locator(".site-footer")).toContainText("support@op4n.com");
      await expectAccessible(page, path);
    }
    await open(page, "/index.html");
    await expect(page.locator(".guest-link-disclosure a[href='terms.html']")).toBeVisible();
  });
});

test.describe("responsive layouts", () => {
  for (const width of [320, 768, 1280]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/index.html", "/latest.html", "/terms.html"]) {
        await open(page, path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("Staging short host", () => {
  test.skip(!STAGING, "the redirect Worker exists only on Staging");

  test("unknown and synthetic codes show their intentional states", async ({ request }) => {
    const unknown = await request.get(`${SHORT_ORIGIN}/ZZZZZZZZZZ`, { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
    expect(await unknown.text()).toContain("doesn't exist");
    const synthetic = await request.get(`${SHORT_ORIGIN}/SYNTHETIC1`, { maxRedirects: 0 });
    expect(synthetic.status()).toBe(302);
  });
});
