import assert from "node:assert/strict";
import test from "node:test";
import "../../services/http-link-service.js";
import "../../services/http-public-link-service.js";

const { createHttpPublicLinkAdapter } = globalThis.op4nHttpPublicLinkService;
const BASE = "https://api.example.test/functions/v1/op4n-api";
const CARD = Object.freeze({
  aggregateTotalClicks: 4,
  canonicalCode: "R1EXAMPLE",
  canonicalOpenUrl: "https://staging.op4n.me/R1EXAMPLE",
  canonicalShortUrl: "https://staging.op4n.me/R1EXAMPLE",
  displayTitle: "Example",
  safeDestinationSummary: Object.freeze({ origin: "https://example.com", path: "/docs", displayValue: "https://example.com/docs?…" }),
});

function adapterFor(status, body, headers = {}) {
  const calls = [];
  const adapter = createHttpPublicLinkAdapter({
    apiBaseUrl: `${BASE}/`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status, headers: { "Content-Type": "application/json", ...headers },
      });
    },
  });
  return { adapter, calls };
}

test("listLatest sends a simple GET and maps cards to the shared view model", async () => {
  const { adapter, calls } = adapterFor(200, { items: [CARD] }, { "X-Request-ID": "req-1" });
  const { links } = await adapter.listLatest();
  assert.equal(calls[0].url, `${BASE}/api/v1/links`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "omit");
  assert.deepEqual(Object.keys(calls[0].init.headers), ["Accept"], "no custom header, so no CORS preflight");
  assert.deepEqual({ ...links[0] }, {
    id: "R1EXAMPLE", code: "R1EXAMPLE", title: "Example",
    shortUrl: "https://staging.op4n.me/R1EXAMPLE", openUrl: "https://staging.op4n.me/R1EXAMPLE",
    destinationSummary: "https://example.com/docs?…", clickCount: 4, discoveryWithheld: false, source: "public",
  });
});

test("lookup maps 200, LINK_NOT_FOUND, and LINK_DISABLED to card, not_found, and unavailable", async () => {
  let { adapter, calls } = adapterFor(200, CARD);
  assert.equal((await adapter.lookup("R1EXAMPLE")).kind, "card");
  assert.equal(calls[0].url, `${BASE}/api/v1/link-lookup?input=R1EXAMPLE`);
  ({ adapter } = adapterFor(404, { error: { code: "LINK_NOT_FOUND" } }));
  assert.equal((await adapter.lookup("NOPE000001")).kind, "not_found");
  ({ adapter } = adapterFor(404, { error: { code: "LINK_DISABLED" } }));
  assert.equal((await adapter.lookup("OFF0000001")).kind, "unavailable");
});

test("service errors keep their code, status, request ID, and Retry-After", async () => {
  const { adapter } = adapterFor(429, { error: { code: "RATE_LIMITED" } }, { "Retry-After": "90", "X-Request-ID": "req-9" });
  await assert.rejects(adapter.lookup("R1EXAMPLE"), (error) =>
    error.code === "RATE_LIMITED" && error.status === 429 && error.retryAfter === 90 && error.requestId === "req-9");
  const paused = adapterFor(503, { error: { code: "FEATURE_UNAVAILABLE" } });
  await assert.rejects(paused.adapter.listLatest(), (error) => error.code === "FEATURE_UNAVAILABLE");
  const malformed = adapterFor(200, { items: "nope" });
  await assert.rejects(malformed.adapter.listLatest(), (error) => error.code === "MALFORMED_RESPONSE");
  const offline = createHttpPublicLinkAdapter({ apiBaseUrl: BASE, fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline.listLatest(), (error) => error.code === "NETWORK_ERROR");
});
