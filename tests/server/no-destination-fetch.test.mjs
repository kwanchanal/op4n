// Guard for "Prevent SSRF and private-network destination access": R1 never
// fetches a user-supplied destination. Every outbound fetch in backend code
// must target a configured internal base (Supabase REST or the op4n-api
// origin). A new fetch of anything else fails this test until it is routed
// through a reviewed, network-validating helper.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url).pathname;
const SCANNED = ["supabase/functions", "workers"];
const ALLOWED_TARGETS = ["${supabaseUrl}", "${env.API_BASE_URL}"];

async function sourceFiles(directory) {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(mjs|js|ts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

test("backend code only fetches configured internal bases", async () => {
  const offenders = [];
  let calls = 0;
  for (const directory of SCANNED) {
    for (const file of await sourceFiles(directory)) {
      const text = await readFile(join(root, file), "utf8");
      for (const match of text.matchAll(/\b(fetch|fetchImpl|doFetch)\s*\(\s*([^,)]*)/g)) {
        const firstArgument = match[2].trim();
        // Skip method definitions such as `fetch(request, env, ctx) {` or `fetch() {`.
        if (/^(request)?$/.test(firstArgument) && text.slice(match.index).match(/^\w+\s*\([^)]*\)\s*\{/)) continue;
        calls += 1;
        if (!ALLOWED_TARGETS.some((target) => firstArgument.includes(target))) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
  }
  assert.ok(calls >= 3, "the scan found the expected internal fetch calls");
  assert.deepEqual(offenders, [], "unexpected outbound fetch target");
});
