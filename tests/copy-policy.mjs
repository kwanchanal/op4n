// Shipped-copy policy (Feature Inventory Orders 88 and 91). Scans every file
// in tests/static-site-files.json and fails on:
//   * an email address other than support@op4n.com (no personal address);
//   * Paid-tier wording in visible text: Paid, Premium, Upgrade, pricing,
//     price, quota, subscription, per month;
//   * visible "openme" branding.
// HTML is checked on text content and user-visible attributes; JavaScript on
// string literals (comments and identifier-like strings are skipped).
// Usage: node tests/copy-policy.mjs [--self-test]

import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const ALLOWED_EMAILS = new Set(["support@op4n.com"]);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAID = /\b(paid|premium|upgrade|pricing|price|prices|quota|quotas|subscription|subscribe|per month|\/month)\b/i;
const OPENME = /\bopenme\b/i;

export function visibleHtmlText(html) {
  const { document } = new JSDOM(html).window;
  document.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
  const attributes = [...document.querySelectorAll("[aria-label], [title], [alt], [placeholder], [content]")]
    .flatMap((node) => ["aria-label", "title", "alt", "placeholder"].map((name) => node.getAttribute(name)).filter(Boolean));
  return [document.body?.textContent ?? "", document.title, ...attributes].join("\n");
}

export function jsStringLiterals(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  const literals = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
  for (const match of withoutComments.matchAll(pattern)) {
    const text = match[2];
    // Identifier-like strings (keys, ids, class names) are not visible copy.
    if (!/\s/.test(text) && (/[_-]/.test(text) || /^[a-z0-9]+$/.test(text))) continue;
    literals.push(text);
  }
  return literals.join("\n");
}

export function findViolations(path, text) {
  const violations = [];
  for (const email of text.match(EMAIL) ?? []) {
    if (!ALLOWED_EMAILS.has(email.toLowerCase())) violations.push(`${path}: email address ${email}`);
  }
  const visible = path.endsWith(".html") ? visibleHtmlText(text) : path.endsWith(".js") ? jsStringLiterals(text) : "";
  const paid = visible.match(PAID);
  if (paid) violations.push(`${path}: Paid-tier wording "${paid[0]}"`);
  if (OPENME.test(visible)) violations.push(`${path}: visible "openme" branding`);
  return violations;
}

function selfTest() {
  const cases = [
    [findViolations("a.js", 'const x = "mailto:someone@gmail.com";').length, 1],
    [findViolations("a.js", 'const x = "mailto:support@op4n.com";').length, 0],
    [findViolations("a.html", "<p>Upgrade to Premium</p>").length, 1],
    [findViolations("a.html", '<button aria-label="See pricing">x</button>').length, 1],
    [findViolations("a.html", "<aside aria-label=\"openme Assist\"></aside>").length, 1],
    [findViolations("a.html", '<div data-openme-sidebar class="openme-x">Op4n.com</div>').length, 0],
    [findViolations("a.js", '// openme internal note\nsessionStorage.setItem("openme_ad_collapsed", "1");').length, 0],
    [findViolations("a.js", 'label = "Open me now";').length, 0],
    [findViolations("a.js", 'status = "Accounts are coming soon.";').length, 0],
  ];
  cases.forEach(([actual, expected], index) => {
    if (actual !== expected) throw new Error(`copy policy self-test ${index + 1}: ${actual} !== ${expected}`);
  });
  console.log(`PASS copy policy self-tests: ${cases.length} cases`);
}

async function run() {
  const files = JSON.parse(await readFile(new URL("./static-site-files.json", import.meta.url), "utf8"));
  const violations = [];
  for (const path of files.filter((item) => /\.(html|js|txt|xml|css)$/.test(item))) {
    violations.push(...findViolations(path, await readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  }
  if (violations.length) {
    violations.forEach((item) => console.error(`FAIL ${item}`));
    process.exit(1);
  }
  console.log(`PASS copy policy: ${files.length} shipped files, no personal email, Paid-tier wording, or visible openme`);
}

if (process.argv.includes("--self-test")) selfTest();
else await run();
