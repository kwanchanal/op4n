import assert from "node:assert/strict";
import test from "node:test";
import { createHealthHandlers, SYNTHETIC_CODE } from "../../supabase/functions/_shared/internal-handlers.mjs";
import { hmacSha256Hex } from "../../supabase/functions/_shared/crypto-values.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const CREDENTIAL = "c".repeat(64);
const SHA = "a".repeat(40);

function build(overrides = {}) {
  const calls = [];
  const persistence = {
    healthReadiness: async () => { calls.push("healthReadiness"); return { database: true, schema: true }; },
    resolveRedirect: async (code) => { calls.push(["resolveRedirect", code]); return { decision: "redirect" }; },
    ensureSyntheticLink: async (input) => { calls.push(["ensure", input]); return { kind: "created" }; },
    ...overrides,
  };
  const handlers = createHealthHandlers({
    credential: CREDENTIAL, persistence, environment: "staging", releaseSha: SHA, configVersion: "staging-r1",
    environmentReady: true, frontendOrigin: "https://staging.op4n.com",
    destinationHmacKey: new TextEncoder().encode("TEST-ONLY-DESTINATION-HMAC-KEY-01"), hmac: hmacSha256Hex,
  });
  return { handlers, calls };
}
const req = (path, { method = "GET", auth = true } = {}) => new Request(`https://x/functions/v1/op4n-api/api/v1/internal/${path}`, {
  method, headers: auth ? { Authorization: `Bearer ${CREDENTIAL}` } : {},
});

test("routes map the health and synthetic operations", () => {
  assert.equal(routeOperation("/x/api/v1/internal/health/live", "GET"), "getEnvironmentLiveness");
  assert.equal(routeOperation("/x/api/v1/internal/health/ready", "GET"), "getEnvironmentReadiness");
  assert.equal(routeOperation("/x/api/v1/internal/synthetic/ensure", "POST"), "ensureSyntheticLink");
});

test("liveness answers without the database and exposes only environment identity", async () => {
  const { handlers, calls } = build();
  const response = await handlers.live(req("health/live"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "live", environment: "staging", releaseSha: SHA, configVersion: "staging-r1" });
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("every health route rejects a missing or wrong credential", async () => {
  const { handlers } = build();
  for (const [handler, path, method] of [[handlers.live, "health/live", "GET"], [handlers.ready, "health/ready", "GET"], [handlers.ensureSynthetic, "synthetic/ensure", "POST"]]) {
    assert.equal((await handler(req(path, { method, auth: false }))).status, 401, path);
    const wrong = new Request(`https://x/api/v1/internal/${path}`, { method, headers: { Authorization: `Bearer ${"d".repeat(64)}` } });
    assert.equal((await handler(wrong)).status, 401, path);
  }
});

test("readiness is 200 only when environment, database, schema, and synthetic lookup are ready", async () => {
  const ready = await build().handlers.ready(req("health/ready"));
  assert.equal(ready.status, 200);
  assert.deepEqual((await ready.json()).checks.map((check) => check.name), ["router", "environment", "database", "schema", "redirectLookup"]);
  for (const overrides of [
    { healthReadiness: async () => { throw new Error("db down"); } },
    { healthReadiness: async () => ({ database: true, schema: false }) },
    { resolveRedirect: async () => ({ decision: "unknown" }) },
  ]) {
    const response = await build(overrides).handlers.ready(req("health/ready"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "30");
    const body = await response.json();
    assert.equal(body.readiness.status, "not_ready");
    assert.ok(!JSON.stringify(body).includes("db down"));
  }
  const wrongEnvironment = createHealthHandlers({ credential: CREDENTIAL, persistence: {
    healthReadiness: async () => ({ database: true, schema: true }), resolveRedirect: async () => ({ decision: "redirect" }),
  }, environment: "staging", releaseSha: "not-a-sha", environmentReady: true });
  assert.equal((await wrongEnvironment.ready(req("health/ready"))).status, 503);
});

test("ensure creates the synthetic link to the frontend with a destination fingerprint", async () => {
  const { handlers, calls } = build();
  const response = await handlers.ensureSynthetic(req("synthetic/ensure", { method: "POST" }));
  assert.deepEqual(await response.json(), { canonicalCode: SYNTHETIC_CODE, created: true });
  const [, input] = calls.find(([name]) => name === "ensure");
  assert.equal(input.destination, "https://staging.op4n.com/?monitor=synthetic");
  assert.match(input.fingerprint, /^[0-9a-f]{64}$/);
});
