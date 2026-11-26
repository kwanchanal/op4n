// TEMPORARY diagnostic for the headless Firefox crash on CI. Removed after use.
import { test } from "@playwright/test";

const cases = [
  ["terms (control)", "/terms.html", true],
  ["index no-JS", "/index.html", false],
  ["latest no-JS", "/latest.html", false],
  ["index JS", "/index.html", true],
  ["latest JS", "/latest.html", true],
];
for (const [name, path, js] of cases) {
  test(`diag ${name}`, async ({ browser, browserName }) => {
    test.skip(browserName !== "firefox");
    const context = await browser.newContext({ javaScriptEnabled: js });
    const page = await context.newPage();
    const log = [];
    page.on("console", (m) => log.push(`console ${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
    page.on("crash", () => log.push("CRASH"));
    page.on("requestfailed", (r) => log.push(`requestfailed: ${r.url()}`));
    try {
      await page.goto(path);
      for (const wait of [200, 800, 2000]) {
        await page.waitForTimeout(wait);
        log.push(`alive after +${wait}: ${await page.evaluate(() => document.readyState)}`);
      }
      if (js) {
        log.push(`dialogs: ${await page.evaluate(() => document.querySelectorAll("dialog").length)}`);
        await page.evaluate(() => document.querySelector("input")?.focus());
        log.push("focused input");
      }
    } catch (error) {
      log.push(`ERROR ${error.message.split("\n")[0]}`);
    }
    console.log(`DIAG ${name}: ${log.join(" | ")}`);
    await context.close();
  });
}
