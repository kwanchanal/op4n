import assert from "node:assert/strict";
import test from "node:test";
import "../../services/http-link-service.js";

const { createHttpLinkAdapter, toCardModel } = globalThis.op4nHttpLinkService;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CARD = Object.freeze({
  aggregateTotalClicks: 0,
  canonicalCode: "R1EXAMPLE",
  canonicalOpenUrl: "https://staging.op4n.me/R1EXAMPLE",
  canonicalShortUrl: "https://staging.op4n.me/R1EXAMPLE",
  displayTitle: "Example",
  safeDestinationSummary: Object.freeze({ origin: "https://example.com", displayValue: "https://example.com" }),
});

function fakeFetch(status, body, headers = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  };
  return { impl, calls };
}

const request = Object.freeze({
  requestId: "4b1e2c4e-8a3f-4d2b-9c1e-1f2a3b4c5d6e",
  title: "Example",
  destinationUrl: "https://example.com/page?token=SECRET#frag",
});

test("createLink posts the contract request with credentials omitted and the idempotency key", async () => {
  const { impl, calls } = fakeFetch(201, CARD, { "X-Request-ID": "req-1" });
  const adapter = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test/functions/v1/op4n-api/", fetchImpl: impl });
  await adapter.createLink(request);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.test/functions/v1/op4n-api/api/v1/links");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.match(calls[0].init.headers["Idempotency-Key"], UUID_V4);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    destinationUrl: request.destinationUrl,
    title: "Example",
  });
});

test("an empty title is sent as null", async () => {
  const { impl, calls } = fakeFetch(201, CARD);
  const adapter = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test", fetchImpl: impl });
  await adapter.createLink({ ...request, title: "" });
  assert.equal(JSON.parse(calls[0].init.body).title, null);
});

test("201 maps PublicLinkCard to the card view model without any destination", async () => {
  const { impl } = fakeFetch(201, CARD, { "Idempotency-Replayed": "true" });
  const adapter = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test", fetchImpl: impl });
  const { link, meta } = await adapter.createLink(request);

  assert.deepEqual({ ...link }, {
    id: "R1EXAMPLE",
    code: "R1EXAMPLE",
    title: "Example",
    shortUrl: "https://staging.op4n.me/R1EXAMPLE",
    openUrl: "https://staging.op4n.me/R1EXAMPLE",
    destinationSummary: "https://example.com",
    clickCount: 0,
    discoveryWithheld: false,
    source: "created",
  });
  assert.equal(meta.replayed, true);
  assert.ok(!JSON.stringify(link).includes("SECRET"));
  assert.ok(!JSON.stringify(link).includes("frag"));
});

test("API errors surface the envelope code, status, and request ID", async () => {
  const { impl } = fakeFetch(503, {
    error: { code: "DEPENDENCY_UNAVAILABLE", message: "A required service is temporarily unavailable.", requestId: "req-9" },
  }, { "X-Request-ID": "req-9" });
  const adapter = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test", fetchImpl: impl });
  await assert.rejects(adapter.createLink(request), (error) =>
    error.code === "DEPENDENCY_UNAVAILABLE" && error.status === 503 && error.requestId === "req-9");
});

test("network failures and malformed responses are distinct errors", async () => {
  const offline = createHttpLinkAdapter({
    apiBaseUrl: "https://api.example.test",
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });
  await assert.rejects(offline.createLink(request), (error) => error.code === "NETWORK_ERROR" && error.status === 0);

  const { impl } = fakeFetch(201, { ...CARD, canonicalShortUrl: "javascript:alert(1)" });
  const malformed = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test", fetchImpl: impl });
  await assert.rejects(malformed.createLink(request), (error) => error.code === "MALFORMED_RESPONSE");

  assert.throws(() => toCardModel({ ...CARD, safeDestinationSummary: null }), (error) => error.code === "MALFORMED_RESPONSE");
  assert.throws(() => toCardModel(null), (error) => error.code === "MALFORMED_RESPONSE");
});

test("listCreatedLinks is session-only and never calls the network", async () => {
  let called = false;
  const adapter = createHttpLinkAdapter({
    apiBaseUrl: "https://api.example.test",
    fetchImpl: async () => { called = true; },
  });
  const result = await adapter.listCreatedLinks();
  assert.deepEqual(result.links, []);
  assert.equal(called, false);
  assert.equal(adapter.isPrototype, false);
});

test("a non-HTTP apiBaseUrl is rejected at construction", () => {
  for (const apiBaseUrl of ["", "ftp://example.test", "javascript:alert(1)", undefined]) {
    assert.throws(() => createHttpLinkAdapter({ apiBaseUrl }), /apiBaseUrl/);
  }
});

test("a withheld create response marks the card model so the UI can explain it", async () => {
  const { impl } = fakeFetch(201, { ...CARD, publicDiscovery: "withheld" });
  const adapter = createHttpLinkAdapter({ apiBaseUrl: "https://api.example.test", fetchImpl: impl });
  const { link } = await adapter.createLink(request);
  assert.equal(link.discoveryWithheld, true);
});
