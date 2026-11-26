import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "../../services/short-link-lookup.js";
import { createAdminHandlers } from "../../supabase/functions/_shared/admin-handlers.mjs";
import { evaluateDiscovery } from "../../supabase/functions/_shared/discovery-policy.mjs";
import { DISCOVERY_RULES } from "../../supabase/functions/_shared/discovery-rules.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import { normalizeLookupInput } from "../../supabase/functions/_shared/lookup-normalizer.mjs";
import { createPublicReadHandlers } from "../../supabase/functions/_shared/public-read-handlers.mjs";
import { DEFAULT_RATE_LIMITS, resolveRateLimits } from "../../supabase/functions/_shared/rate-limit.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const fixtures = JSON.parse(await readFile(new URL("../fixtures/lookup-inputs.json", import.meta.url), "utf8"));
const BASE = "https://staging.op4n.me";
const CARD = Object.freeze({
  canonicalCode: "AbC123xyZ9",
  displayTitle: "Docs",
  canonicalShortUrl: `${BASE}/AbC123xyZ9`,
  canonicalOpenUrl: `${BASE}/AbC123xyZ9`,
  safeDestinationSummary: { origin: "https://example.com", path: "/docs", displayValue: "https://example.com/docs" },
  aggregateTotalClicks: 3,
});

// ── Order 61: discovery screening ──────────────────────────────────────
test("sensitive destinations are withheld from discovery by category, never by value", () => {
  const withheld = [
    ["https://example.com/cb?code=abc&state=xyz", "sensitive_parameter"],
    ["https://example.com/p?Access_Token=abc", "sensitive_parameter"],
    ["https://bucket.s3.amazonaws.com/f.pdf?X-Amz-Signature=abc&X-Amz-Expires=60", "sensitive_parameter"],
    ["https://storage.googleapis.com/b/o?X-Goog-Signature=abc", "sensitive_parameter"],
    ["https://example.com/app#id_token=abc", "sensitive_parameter"],
    ["https://example.com/login?pwd=hunter2", "sensitive_parameter"],
    ["https://example.com/password-reset/abc", "sensitive_path"],
    ["https://example.com/invite/team", "sensitive_path"],
    ["https://example.com/d/3f2a9c4e1b7d8a6f5e4c3b2a19087f6e", "secret_token"],
    ["https://example.com/f/550e8400-e29b-41d4-a716-446655440000", "secret_token"],
    ["https://example.com/s/aB3dE5gH7jK9mN1pQ3sT5v", "secret_token"],
    ["https://docs.google.com/document/d/1/edit", "private_share_host"],
    ["https://us02web.zoom.us/j/123", "private_share_host"],
    ["https://checkout.stripe.com/c/pay/x", "private_share_host"],
  ];
  for (const [url, category] of withheld) {
    const result = evaluateDiscovery(new URL(url));
    assert.equal(result.eligible, false, url);
    assert.ok(result.categories.includes(category), `${url} -> ${result.categories}`);
    assert.equal(result.version, DISCOVERY_RULES.version);
    assert.doesNotMatch(JSON.stringify(result), /abc|hunter2|team|550e8400|aB3dE5/);
  }
  for (const url of [
    "https://example.com/",
    "https://shop.com/products/running-shoes?ref=ig&utm_source=x",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://en.wikipedia.org/wiki/Bangkok",
    "https://example.com/blog/2024/hello-world",
  ]) {
    assert.deepEqual(evaluateDiscovery(new URL(url)).categories, [], url);
  }
});

test("the destination policy records the discovery result with its rule version", () => {
  const policy = createDestinationPolicy();
  const parsed = policy.parse("https://example.com/cb?token=SECRET");
  assert.equal(parsed.discovery.eligible, false);
  assert.equal(parsed.discovery.version, "r1-discovery-v1");
  assert.equal(parsed.publicSummary.displayValue, "https://example.com/…");
  assert.equal(policy.parse("https://example.com/docs").discovery.eligible, true);
});

// ── Order 72: lookup normalization, client/server parity ───────────────
test("client and server lookup normalizers agree on the full fixture table", () => {
  const client = globalThis.op4nShortLinkLookup.normalizeLookupInput;
  for (const { name, input, code } of fixtures.cases) {
    const server = normalizeLookupInput(input, fixtures.shortHost);
    assert.deepEqual(server, code ? { valid: true, code } : { valid: false }, `server: ${name}`);
    assert.deepEqual(client(input, fixtures.shortHost), server, `client: ${name}`);
  }
  // Production accepts op4n.me and rejects the Staging host.
  assert.deepEqual(normalizeLookupInput("op4n.me/AbC123xyZ9", "op4n.me"), { valid: true, code: "AbC123xyZ9" });
  assert.deepEqual(normalizeLookupInput("staging.op4n.me/AbC123xyZ9", "op4n.me"), { valid: false });
});

// ── Orders 62-64, 76, 78: public read handlers ─────────────────────────
function build({ flags = {}, limit = { decision: "allowed", limit: 120, remaining: 119, reset: 60 }, persistence = {} } = {}) {
  const calls = [];
  const handlers = createPublicReadHandlers({
    canonicalBaseUrl: BASE,
    allowedOrigins: ["https://staging.op4n.com"],
    featureFlags: { isEnabled: async (flag) => flags[flag] ?? true },
    rateLimitGate: limit instanceof Error
      ? { check: async () => { throw limit; } }
      : { check: async (input) => { calls.push(["limit", input.operation]); return limit; } },
    persistence: new Proxy({}, {
      get: (_target, name) => async (input) => {
        calls.push([name, input]);
        const value = persistence[name];
        if (value instanceof Error) throw value;
        return typeof value === "function" ? value(input) : value;
      },
    }),
    requestId: () => "00000000-0000-4000-8000-000000000001",
  });
  return { handlers, calls };
}
const req = (path, init = {}) => new Request(`http://local/functions/v1/op4n-api${path}`, {
  headers: { Origin: "https://staging.op4n.com" },
  ...init,
});

test("routes map the public read operations by path and method", () => {
  assert.equal(routeOperation("/x/api/v1/links", "GET"), "listLatestPublicLinks");
  assert.equal(routeOperation("/x/api/v1/links", "HEAD"), "listLatestPublicLinks");
  assert.equal(routeOperation("/x/api/v1/links", "POST"), "createGuestCanonicalLink");
  assert.equal(routeOperation("/x/api/v1/links", "OPTIONS"), "createGuestCanonicalLink");
  assert.equal(routeOperation("/x/api/v1/links/AbC123xyZ9", "GET"), "getPublicLinkCard");
  assert.equal(routeOperation("/x/api/v1/link-lookup", "GET"), "exactLookupPublicLink");
  assert.equal(routeOperation("/x/api/v1/links/AbC123xyZ9/reports", "POST"), "submitPublicLinkReport");
  assert.equal(routeOperation("/x/api/v1/admin/links/AbC123xyZ9/discovery", "POST"), "setAdminDiscovery");
  assert.equal(routeOperation("/x/api/v1/admin/links/AbC123xyZ9", "GET"), "getAdminLinkRecord");
});

test("Latest Links returns only card items, no-store, with rate headers", async () => {
  const { handlers, calls } = build({ persistence: { listPublicLinks: { items: [CARD] } } });
  const response = await handlers.listLatest(req("/api/v1/links?limit=10"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [CARD] });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://staging.op4n.com");
  assert.equal(response.headers.get("RateLimit-Remaining"), "119");
  assert.deepEqual(calls, [["limit", "public-read"], ["listPublicLinks", { baseUrl: BASE, limit: 10 }]]);
  for (const bad of ["?limit=0", "?limit=101", "?limit=x", "?sort=old"]) {
    assert.equal((await handlers.listLatest(req(`/api/v1/links${bad}`))).status, 400, bad);
  }
});

test("flags pause each surface, the limiter fails closed, and storage errors never fall back", async () => {
  let response = await build({ flags: { latest_links: false } }).handlers.listLatest(req("/api/v1/links"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "FEATURE_UNAVAILABLE");
  response = await build({ flags: { public_search: false } }).handlers.exactLookup(req("/api/v1/link-lookup?input=AbC123xyZ9"));
  assert.equal((await response.json()).error.code, "FEATURE_UNAVAILABLE");

  response = await build({ limit: { decision: "limited", limit: 30, remaining: 0, reset: 40, retryAfter: 40 } })
    .handlers.exactLookup(req("/api/v1/link-lookup?input=AbC123xyZ9"));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "40");
  assert.equal(response.headers.get("RateLimit-Remaining"), "0");

  for (const limit of [new Error("db down"), { decision: "unavailable" }]) {
    response = await build({ limit }).handlers.listLatest(req("/api/v1/links"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "DEPENDENCY_UNAVAILABLE");
  }
  response = await build({ persistence: { listPublicLinks: new Error("db down") } }).handlers.listLatest(req("/api/v1/links"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).items, undefined);
  assert.equal((await build().handlers.listLatest(req("/api/v1/links", { method: "POST" }))).status, 405);
});

test("exact lookup: invalid shapes never reach the limiter or database; results map to card, not found, or unavailable", async () => {
  const { handlers, calls } = build();
  for (const input of ["op4n.me/AbC123xyZ9", "pad thai", "https://example.com/AbC123xyZ9", "AbC123xyZ9?x"]) {
    const response = await handlers.exactLookup(req(`/api/v1/link-lookup?input=${encodeURIComponent(input)}`));
    assert.equal(response.status, 400, input);
  }
  assert.equal((await handlers.exactLookup(req("/api/v1/link-lookup?input=AbC123xyZ9&input=x"))).status, 400);
  assert.equal((await handlers.exactLookup(req("/api/v1/link-lookup?q=AbC123xyZ9"))).status, 400);
  assert.deepEqual(calls, []);

  const results = { ca: { kind: "card", card: CARD }, nf: { kind: "not_found" }, un: { kind: "unavailable" } };
  const lookups = build({ persistence: { publicLinkLookup: ({ code }) => results[code.slice(0, 2).toLowerCase()] ?? results.nf } });
  let response = await lookups.handlers.exactLookup(req(`/api/v1/link-lookup?input=${encodeURIComponent(`${BASE}/CArd123456`)}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), CARD);
  assert.deepEqual(lookups.calls.at(-1), ["publicLinkLookup", { code: "CArd123456", baseUrl: BASE }]);
  assert.deepEqual(lookups.calls.find(([name]) => name === "limit"), ["limit", "public-search"]);

  response = await lookups.handlers.exactLookup(req("/api/v1/link-lookup?input=NF12345678"));
  const notFound = await response.json();
  assert.equal(response.status, 404);
  assert.equal(notFound.error.code, "LINK_NOT_FOUND");
  response = await lookups.handlers.exactLookup(req("/api/v1/link-lookup?input=UN12345678"));
  const unavailable = await response.json();
  assert.equal(unavailable.error.code, "LINK_DISABLED");
  assert.deepEqual(Object.keys(unavailable.error).sort(), ["code", "message", "requestId"]);

  response = await lookups.handlers.getCard(req("/api/v1/links/UN12345678"));
  assert.equal((await response.json()).error.code, "LINK_DISABLED");
  response = await lookups.handlers.getCard(req("/api/v1/links/CArd123456"));
  assert.deepEqual(await response.json(), CARD);
});

test("every public class has a finite default and startup fails without one", () => {
  for (const limitClass of ["public-create", "public-read", "public-search", "public-report"]) {
    assert.ok(DEFAULT_RATE_LIMITS[limitClass].identity.length >= 1, limitClass);
  }
  assert.deepEqual(DEFAULT_RATE_LIMITS["public-search"].identity.map((window) => [window.seconds, window.limit]), [[60, 30], [86400, 300]]);
  assert.deepEqual(DEFAULT_RATE_LIMITS["public-read"].identity.map((window) => [window.seconds, window.limit]), [[60, 120]]);
  assert.throws(() => resolveRateLimits(JSON.stringify({ "public-read": { identity: [] } })), /public-read/);
  assert.throws(() => resolveRateLimits(JSON.stringify({ "public-search": null })), /public-search/);
  assert.ok(resolveRateLimits()["public-search"]);
});

// ── Order 61 AC5: Admin discovery override ─────────────────────────────
test("the Admin discovery override validates input and is audited", async () => {
  const calls = [];
  const handlers = createAdminHandlers({
    persistence: { adminSetDiscovery: async (input) => { calls.push(input); return { kind: "changed", discoveryOverride: "eligible" }; } },
    destinationPolicy: createDestinationPolicy(),
    destinationHmacKey: new Uint8Array(32),
    shortHosts: ["staging.op4n.me"],
    environment: "staging",
  });
  const post = (body) => ({
    request: new Request("http://local/x/api/v1/admin/links/AbC123xyZ9/discovery", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
    claims: { sub: "4EFFD356-0000-4000-8000-000000000001" },
  });
  assert.equal((await handlers.setDiscovery(post({ decision: "public", note: "x" }))).status, 400);
  assert.equal((await handlers.setDiscovery(post({ decision: "eligible", note: " " }))).status, 400);
  assert.equal(calls.length, 0);
  const response = await handlers.setDiscovery(post({ decision: "eligible", note: "false positive" }));
  assert.deepEqual(response.body, { canonicalCode: "AbC123xyZ9", discoveryOverride: "eligible", changed: true, auditRecorded: true });
  assert.deepEqual(calls[0], { code: "AbC123xyZ9", decision: "eligible", actor: "founder:4effd356-0000-4000-8000-000000000001", detail: "false positive" });
});
