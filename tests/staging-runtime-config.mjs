// Writes the Staging frontend runtime configuration. It is the only file that
// differs from the verified artifact and holds no secret: the publishable key
// is a public client key (RLS and the Admin gate decide what it can do).
//
// Usage: node tests/staging-runtime-config.mjs <output-file>
//        node tests/staging-runtime-config.mjs --self-test

import { writeFile } from "node:fs/promises";

const MANAGEMENT_API = "https://api.supabase.com/v1";

// Prefers the new publishable key and falls back to the legacy anon key.
// Never returns a secret or service-role key.
export function selectPublishableKey(keys) {
  const list = Array.isArray(keys) ? keys : [];
  const publishable = list.find((key) => key?.type === "publishable" && /^sb_publishable_/.test(key.api_key ?? ""));
  if (publishable) return publishable.api_key;
  const anon = list.find((key) => key?.name === "anon" && typeof key.api_key === "string" && key.api_key.split(".").length === 3);
  if (anon) {
    const role = JSON.parse(Buffer.from(anon.api_key.split(".")[1], "base64url").toString()).role;
    if (role === "anon") return anon.api_key;
  }
  return null;
}

export function renderRuntimeConfig(ref, publishableKey) {
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error("invalid project ref shape");
  if (!publishableKey || /secret|service_role/i.test(publishableKey)) throw new Error("no publishable key");
  return `window.OP4N_RUNTIME_CONFIG = Object.freeze({
  environment: "staging",
  adapter: "http",
  apiBaseUrl: "https://${ref}.supabase.co/functions/v1/op4n-api",
  shortLinkHost: "staging.op4n.me",
  authUrl: "https://${ref}.supabase.co",
  publishableKey: ${JSON.stringify(publishableKey)},
});
`;
}

function selfTest() {
  const anonJwt = `x.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.y`;
  const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.y`;
  const cases = [
    [selectPublishableKey([{ name: "default", type: "publishable", api_key: "sb_publishable_abc" }]), "sb_publishable_abc"],
    [selectPublishableKey([{ name: "default", type: "secret", api_key: "sb_secret_abc" }]), null],
    [selectPublishableKey([{ name: "anon", api_key: anonJwt }]), anonJwt],
    [selectPublishableKey([{ name: "anon", api_key: serviceJwt }]), null],
    [selectPublishableKey([{ name: "service_role", api_key: serviceJwt }]), null],
    [selectPublishableKey(null), null],
  ];
  cases.forEach(([actual, expected], index) => {
    if (actual !== expected) throw new Error(`runtime config self-test ${index + 1} failed`);
  });
  const text = renderRuntimeConfig("abcdefghijklmnopqrst", "sb_publishable_abc");
  if (!text.includes('authUrl: "https://abcdefghijklmnopqrst.supabase.co"')) throw new Error("runtime config render failed");
  for (const bad of [["bad", "sb_publishable_abc"], ["abcdefghijklmnopqrst", "sb_secret_x"], ["abcdefghijklmnopqrst", null]]) {
    let threw = false;
    try { renderRuntimeConfig(...bad); } catch { threw = true; }
    if (!threw) throw new Error("runtime config accepted unsafe input");
  }
  console.log(`PASS staging runtime config self-tests: ${cases.length + 4} cases`);
}

async function run(outputFile) {
  const ref = process.env.SUPABASE_PROJECT_REF ?? "";
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const response = await fetch(`${MANAGEMENT_API}/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Management API request failed with status ${response.status}`);
  const key = selectPublishableKey(await response.json());
  await writeFile(outputFile, renderRuntimeConfig(ref, key));
  console.log("PASS Staging runtime config written (http adapter, Auth URL, publishable key)");
}

if (process.argv[2] === "--self-test") selfTest();
else if (process.argv[2]) await run(process.argv[2]);
else throw new Error("usage: staging-runtime-config.mjs <output-file> | --self-test");
