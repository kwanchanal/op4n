// TEMPORARY diagnostic for the headless Firefox crash on CI. Removed after use.
import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";

const steps = {
  fill: async (page) => { await page.locator("#linkUrl").fill("https://example.com/x"); },
  typeKeys: async (page) => { await page.locator("#linkUrl").pressSequentially("https://e.com"); },
  setValueJs: async (page) => { await page.evaluate(() => { const i = document.querySelector("#linkUrl"); i.value = "https://e.com"; i.dispatchEvent(new Event("input", { bubbles: true })); }); },
  axeAll: async (page) => { await new AxeBuilder({ page }).analyze(); },
  axeNoContrast: async (page) => { await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze(); },
  axeContrastOnly: async (page) => { await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze(); },
};
for (const [name, step] of Object.entries(steps)) {
  for (const reduced of [false, true]) {
    test(`diag ${name} reduced=${reduced}`, async ({ browser, browserName }) => {
      test.skip(browserName !== "firefox");
      const context = await browser.newContext({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const page = await context.newPage();
      let result = "ok";
      page.on("crash", () => { result = "CRASH"; });
      try {
        await page.goto("/index.html");
        await page.waitForTimeout(500);
        await step(page);
        await page.evaluate(() => 1);
      } catch (error) {
        result = `ERROR ${error.message.split("\n")[0]}`;
      }
      console.log(`DIAG ${name} reduced=${reduced}: ${result}`);
      await context.close();
    });
  }
}
