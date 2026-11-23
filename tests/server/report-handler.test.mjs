import assert from "node:assert/strict";
import test from "node:test";
import {
  createReportHandler,
  reportCodeFromPath,
  REPORT_CATEGORIES,
  sanitizeDetail,
} from "../../supabase/functions/_shared/report-handler.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const ORIGIN = "https://staging.op4n.com";
const KEY = "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901";
const RECEIPT = "11111111-2222-4333-8444-555555555555";

function build({ result = { kind: "accepted", receiptId: RECEIPT }, rate = { decision: "allowed", limit: 5, remaining: 4, reset: 60 }, enabled = true } = {}) {
  const calls = { submit: [], rate: [] };
  const handler = createReportHandler({
    environment: "staging",
    allowedOrigins: [ORIGIN],
    persistence: {
      async submitReport(input) {
        calls.submit.push(input);
        if (result instanceof Error) throw result;
        return result;
      },
    },
    rateLimitGate: {
      async check(input) {
        calls.rate.push(input.operation);
        if (rate instanceof Error) throw rate;
        return rate;
      },
    },
    featureFlags: { async isEnabled(key) { assert.equal(key, "public_reports"); return enabled; } },
  });
  return { handler, calls };
}

function report(body, { key = KEY, code = "Abc123XYZ9", contentType = "application/json", method = "POST" } = {}) {
  return new Request(`http://local/functions/v1/op4n-api/api/v1/links/${code}/reports`, {
    method,
    headers: { "Content-Type": contentType, Origin: ORIGIN, ...(key ? { "Idempotency-Key": key } : {}) },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

test("router and path parsing recognise only the report path", () => {
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/links/Abc123XYZ9/reports"), "submitPublicLinkReport");
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/links"), "createGuestCanonicalLink");
  assert.equal(reportCodeFromPath("/x/api/v1/links/Abc123XYZ9/reports"), "Abc123XYZ9");
  assert.equal(reportCodeFromPath("/x/api/v1/links/a/b/reports"), null);
});

test("a valid report returns 202 with only an opaque receipt", async () => {
  const { handler, calls } = build();
  const response = await handler(report({ reasonCategory: "phishing", detail: "  Fake login page  " }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Idempotency-Replayed"), "false");
  assert.deepEqual(await response.json(), { accepted: true, receiptId: RECEIPT });
  assert.deepEqual(calls.rate, ["public-report"]);
  assert.equal(calls.submit[0].detail, "Fake login page");
  assert.equal(calls.submit[0].canonicalCode, "Abc123XYZ9");
  assert.match(calls.submit[0].keyHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls.submit[0]).includes(KEY), "the raw idempotency key is never persisted");
});

test("replays, conflicts, unknown links, and storage failure map to the contract", async () => {
  let { handler } = build({ result: { kind: "replayed", receiptId: RECEIPT } });
  let response = await handler(report({ reasonCategory: "spam" }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Idempotency-Replayed"), "true");
  ({ handler } = build({ result: { kind: "conflict" } }));
  assert.equal((await handler(report({ reasonCategory: "spam" }))).status, 409);
  ({ handler } = build({ result: { kind: "unavailable" } }));
  response = await handler(report({ reasonCategory: "spam" }));
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "LINK_NOT_FOUND");
  ({ handler } = build({ result: new Error("db down") }));
  assert.equal((await handler(report({ reasonCategory: "spam" }))).status, 503);
});

test("invalid input never reaches persistence", async () => {
  const { handler, calls } = build();
  const cases = [
    [report({ reasonCategory: "not-a-category" }), 400],
    [report({ reasonCategory: "spam", detail: "x".repeat(1001) }), 400],
    [report({ reasonCategory: "spam", detail: 42 }), 400],
    [report({ reasonCategory: "spam", reporterEmail: "a@b.c" }), 400],
    [report({ reasonCategory: "spam" }, { key: "not-a-uuid" }), 400],
    [report({ reasonCategory: "spam" }, { key: null }), 400],
    [report("{broken"), 400],
    [report({ reasonCategory: "spam" }, { contentType: "text/plain" }), 415],
    [report({ reasonCategory: "spam", detail: "x".repeat(5000) }), 413],
    [report({ reasonCategory: "spam" }, { code: "bad-code" }), 404],
    [report(null, { method: "GET" }), 405],
  ];
  for (const [request, status] of cases) {
    const response = await handler(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.deepEqual(calls.submit, []);
});

test("rate limits, limiter failure, and the kill switch protect the endpoint", async () => {
  let { handler, calls } = build({ rate: { decision: "limited", limit: 5, remaining: 0, reset: 1200, retryAfter: 1200 } });
  let response = await handler(report({ reasonCategory: "spam" }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "1200");
  assert.equal(response.headers.get("RateLimit-Remaining"), "0");
  assert.deepEqual(calls.submit, []);

  ({ handler, calls } = build({ rate: new Error("limiter down") }));
  assert.equal((await handler(report({ reasonCategory: "spam" }))).status, 503);
  assert.deepEqual(calls.submit, []);

  ({ handler, calls } = build({ enabled: false }));
  response = await handler(report({ reasonCategory: "spam" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "FEATURE_UNAVAILABLE");
  assert.deepEqual(calls.rate, []);
});

test("preflight follows the exact-origin CORS contract", async () => {
  const { handler } = build();
  const allowed = await handler(new Request("http://local/api/v1/links/Abc123XYZ9/reports", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers.get("Access-Control-Allow-Headers"), /Idempotency-Key/);
  const denied = await handler(new Request("http://local/api/v1/links/Abc123XYZ9/reports", { method: "OPTIONS", headers: { Origin: "https://op4n.com" } }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("detail sanitizing keeps text and line breaks but drops control characters", () => {
  assert.equal(sanitizeDetail("  line one\nline two\u0007  "), "line one\nline two");
  assert.equal(sanitizeDetail("   "), null);
  assert.equal(sanitizeDetail(null), null);
  assert.deepEqual([...REPORT_CATEGORIES].sort(), ["abuse", "child_safety", "illegal", "impersonation", "malware", "other", "phishing", "spam"]);
});
