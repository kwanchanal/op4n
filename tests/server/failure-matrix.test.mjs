// Dependency failure matrix (Feature Inventory Order 85). One test per row of
// docs/operations/r1-failure-matrix.md: status, headers, no Location where
// required, at most one upstream attempt, a log event, and recovery without
// a manual step.

import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../../workers/redirect/src/index.mjs";
import { createLinkHandler } from "../../supabase/functions/_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import { createFeatureFlagReader } from "../../supabase/functions/_shared/feature-flags.mjs";
import { createRedirectLookupHandler } from "../../supabase/functions/_shared/internal-handlers.mjs";
import { createPostgrestPersistence } from "../../supabase/functions/_shared/postgrest-persistence.mjs";
import { createPublicReadHandlers } from "../../supabase/functions/_shared/public-read-handlers.mjs";
import { createPostgresRateLimitGate, resolveRateLimits } from "../../supabase/functions/_shared/rate-limit.mjs";
import { createReportHandler } from "../../supabase/functions/_shared/report-handler.mjs";
import { TIMEOUTS } from "../../supabase/functions/_shared/timeouts.mjs";

const CREDENTIAL = "c".repeat(64);
const WORKER_ENV = Object.freeze({
  API_BASE_URL: "https://api.example.test/functions/v1/op4n-api",
  INTERNAL_SERVICE_CREDENTIAL: CREDENTIAL,
  FRONTEND_ORIGIN: "https://staging.op4n.com",
  OP4N_ENVIRONMENT: "staging",
});
const KEY = new TextEncoder().encode("TEST-ONLY-DESTINATION-HMAC-KEY-01");
const ORIGIN = "https://staging.op4n.com";
const flagsOn = { isEnabled: async () => true };

// Persistence whose every call fails like an unreachable database, counting calls.
function downDatabase() {
  const calls = [];
  const persistence = new Proxy({}, { get: (_t, name) => async () => { calls.push(name); throw new TypeError("fetch failed"); } });
  return { persistence, calls };
}

function captureConsole(run) {
  const lines = [];
  const original = { info: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = (line) => lines.push(String(line));
  return Promise.resolve(run()).finally(() => Object.assign(console, original)).then((value) => ({ value, lines }));
}

async function worker(path, fetchImpl) {
  const pending = [];
  const response = await handleRequest(new Request(`https://staging.op4n.me${path}`), WORKER_ENV, {
    waitUntil: (promise) => pending.push(promise),
  }, { fetchImpl });
  await Promise.all(pending);
  return response;
}

const redirectDecision = {
  decision: "redirect", canonicalCode: "Abc123XYZ9", fullDestinationUrl: "https://example.com/x?y=1",
  destinationVersion: 1, destinationFingerprint: "f".repeat(64), cacheControl: "no-store", redirectStatus: 302,
};

function createHandler({ persistence, safetyPort = { decide: async () => ({ decision: "approved" }) }, safetyTimeoutMs } = {}) {
  return createLinkHandler({
    environment: "staging",
    canonicalBaseUrl: "https://staging.op4n.me",
    allowedOrigins: [ORIGIN],
    destinationPolicy: createDestinationPolicy({ shortLinkHosts: ["op4n.me", "staging.op4n.me"] }),
    safetyPort,
    rateLimitGate: createPostgresRateLimitGate({ environment: "staging", persistence, masterKey: KEY, limits: resolveRateLimits() }),
    featureFlags: flagsOn,
    persistence,
    generateCanonicalCode: () => "Abc123XYZ9",
    destinationHmacKey: KEY,
    fingerprintKeyVersion: "test-v1",
    safetyTimeoutMs,
  });
}

const createRequest = () => new Request("https://x/functions/v1/op4n-api/api/v1/links", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901", Origin: ORIGIN },
  body: JSON.stringify({ destinationUrl: "https://example.com/docs" }),
});

test("bounds are configured in one place and ordered so the API answers before the Worker aborts", () => {
  assert.ok(TIMEOUTS.REDIRECT_LOOKUP_MS > TIMEOUTS.DATABASE_MS);
  assert.ok(TIMEOUTS.SAFETY_MS <= 3000 && TIMEOUTS.DATABASE_MS <= 4000);
});

test("database down: redirect lookup 503, Worker shows the unavailable page with no Location", async () => {
  const { persistence, calls } = downDatabase();
  const lookup = createRedirectLookupHandler({ credential: CREDENTIAL, persistence });
  const api = await lookup(new Request("https://x/api/v1/internal/redirect-lookup", {
    method: "POST",
    headers: { Authorization: `Bearer ${CREDENTIAL}`, "Content-Type": "application/json" },
    body: JSON.stringify({ canonicalCode: "Abc123XYZ9" }),
  }));
  assert.equal(api.status, 503);
  assert.equal(calls.length, 1, "one database attempt");

  let lookups = 0;
  const { value: response, lines } = await captureConsole(() => worker("/Abc123XYZ9", async (url) => {
    if (url.endsWith("/redirect-lookup")) { lookups += 1; return new Response("{}", { status: 503 }); }
    return new Response("{}", { status: 202 });
  }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(lookups, 1, "no retry on the user-facing lookup");
  assert.ok(lines.some((line) => JSON.parse(line).event === "redirect_lookup_failed"));
});

test("database down: create, Latest Links, and search return 503 after one attempt", async () => {
  const create = downDatabase();
  const response = await createHandler({ persistence: create.persistence })(createRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(create.calls.length, 1, "the limiter's single call fails; nothing else is attempted");

  const read = downDatabase();
  const handlers = createPublicReadHandlers({
    canonicalBaseUrl: "https://staging.op4n.me", allowedOrigins: [ORIGIN], featureFlags: flagsOn,
    persistence: read.persistence,
    rateLimitGate: createPostgresRateLimitGate({ environment: "staging", persistence: read.persistence, masterKey: KEY, limits: resolveRateLimits() }),
  });
  assert.equal((await handlers.listLatest(new Request("https://x/api/v1/links"))).status, 503);
  assert.equal((await handlers.exactLookup(new Request("https://x/api/v1/link-lookup?input=Abc123XYZ9"))).status, 503);
  assert.equal(read.calls.length, 2);
});

test("a hung database is cut off by the bound and surfaces as a failure, not a hang", async () => {
  const persistence = createPostgrestPersistence({
    supabaseUrl: "https://db.example.test",
    secretKey: "test-only",
    timeoutMs: 20,
    fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))),
  });
  const started = Date.now();
  await assert.rejects(persistence.getFeatureFlags());
  assert.ok(Date.now() - started < 1000);
});

test("lookup timeout: the Worker fails closed with 503 and no Location", async () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const { value: response } = await captureConsole(() => worker("/Abc123XYZ9", async () => { throw timeout; }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Location"), null);
});

test("clicks endpoint down: the 302 is unaffected and the click is retried exactly once", async () => {
  let clicks = 0;
  const { value: response, lines } = await captureConsole(() => worker("/Abc123XYZ9", async (url) => {
    if (url.endsWith("/redirect-lookup")) return Response.json(redirectDecision);
    clicks += 1;
    throw new TypeError("clicks down");
  }));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), redirectDecision.fullDestinationUrl);
  assert.equal(clicks, 2, "one documented retry");
  assert.ok(lines.some((line) => JSON.parse(line).event === "click_record_failed"));
});

test("safety provider down or slow: create fails closed with 503 and no link is written", async () => {
  for (const safetyPort of [
    { decide: async () => { throw new Error("provider down"); } },
    { decide: () => new Promise(() => {}) },
    { decide: async () => ({ decision: "unavailable" }) },
  ]) {
    const writes = [];
    const persistence = {
      consumeRateLimit: async () => ({ decision: "allowed", limit: 5, remaining: 4, reset: 60 }),
      beginCreation: async () => ({ kind: "reserved", reservationToken: "a".repeat(64) }),
      releaseCreation: async () => ({ kind: "released" }),
      createGuestLink: async (input) => { writes.push(input); return { kind: "created", response: {} }; },
    };
    const response = await createHandler({ persistence, safetyPort, safetyTimeoutMs: 30 })(createRequest());
    assert.equal(response.status, 503);
    assert.equal(writes.length, 0);
  }
});

test("rate limiter down: only that class returns 503; redirects never consult it", async () => {
  const { persistence } = downDatabase();
  const handler = createReportHandler({
    environment: "staging", allowedOrigins: [ORIGIN], featureFlags: flagsOn, persistence,
    rateLimitGate: { check: async () => { throw new Error("limiter down"); } },
  });
  const report = await handler(new Request("https://x/api/v1/links/Abc123XYZ9/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901" },
    body: JSON.stringify({ reasonCategory: "spam" }),
  }));
  assert.equal(report.status, 503);
  const response = await worker("/Abc123XYZ9", async (url) => (url.endsWith("/redirect-lookup") ? Response.json(redirectDecision) : new Response("{}", { status: 202 })));
  assert.equal(response.status, 302, "the redirect path has no limiter dependency");
});

test("email provider down: the report is still accepted (the outbox retries delivery)", async () => {
  const handler = createReportHandler({
    environment: "staging", allowedOrigins: [ORIGIN], featureFlags: flagsOn,
    rateLimitGate: { check: async () => ({ decision: "allowed", limit: 5, remaining: 4, reset: 60 }) },
    persistence: { submitReport: async () => ({ kind: "accepted", receiptId: "11111111-2222-4333-8444-555555555555" }) },
  });
  const response = await handler(new Request("https://x/api/v1/links/Abc123XYZ9/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901" },
    body: JSON.stringify({ reasonCategory: "spam" }),
  }));
  assert.equal(response.status, 202, "reporting never waits on email; notifier-worker tests cover retry and exhaustion");
});

test("feature-flag table down: safe defaults, then recovery with no manual step", async () => {
  let up = false;
  let clock = 0;
  const reader = createFeatureFlagReader({
    persistence: { getFeatureFlags: async () => { if (!up) throw new Error("down"); return { latest_links: true }; } },
    now: () => clock,
  });
  assert.equal(await reader.isEnabled("latest_links"), false, "unreadable flags pause the surface");
  up = true;
  clock += 1;
  assert.equal(await reader.isEnabled("latest_links"), true, "the next read after recovery succeeds");
});
