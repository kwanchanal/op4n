// Pre-launch security verification (Feature Inventory Order 94). One test per
// automated category in docs/security/r1-threat-model.md.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { parse } from "yaml";
import { createAdminGate } from "../../supabase/functions/_shared/admin-auth.mjs";
import { createAdminHandlers } from "../../supabase/functions/_shared/admin-handlers.mjs";
import { createLinkHandler } from "../../supabase/functions/_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import {
  createClickHandler, createHealthHandlers, createNotificationClaimHandler, createNotificationCompleteHandler,
  createOpsDailyCheckHandler, createRedirectLookupHandler,
} from "../../supabase/functions/_shared/internal-handlers.mjs";
import { createPublicReadHandlers } from "../../supabase/functions/_shared/public-read-handlers.mjs";
import { clientAddress } from "../../supabase/functions/_shared/rate-limit.mjs";
import { handleRequest } from "../../workers/redirect/src/index.mjs";

const CREDENTIAL = "c".repeat(64);
// Any persistence call is a failure: unauthorized requests must stop first.
const tripwire = () => {
  const calls = [];
  return { calls, persistence: new Proxy({}, { get: (_t, name) => async () => { calls.push(name); return {}; } }) };
};

test("every internal operation rejects a missing or wrong service credential before touching data", async () => {
  const { calls, persistence } = tripwire();
  const health = createHealthHandlers({ credential: CREDENTIAL, persistence, environment: "staging", releaseSha: "a".repeat(40), environmentReady: true, frontendOrigin: "https://staging.op4n.com", destinationHmacKey: new Uint8Array(32), hmac: async () => "f".repeat(64) });
  const internal = {
    resolveCanonicalRedirect: ["POST", createRedirectLookupHandler({ credential: CREDENTIAL, persistence })],
    recordRedirectClick: ["POST", createClickHandler({ credential: CREDENTIAL, persistence })],
    claimFounderNotifications: ["POST", createNotificationClaimHandler({ credential: CREDENTIAL, persistence, environment: "staging" })],
    completeFounderNotifications: ["POST", createNotificationCompleteHandler({ credential: CREDENTIAL, persistence })],
    runOpsDailyCheck: ["POST", createOpsDailyCheckHandler({ credential: CREDENTIAL, persistence, environment: "staging" })],
    ensureSyntheticLink: ["POST", health.ensureSynthetic],
    getEnvironmentLiveness: ["GET", health.live],
    getEnvironmentReadiness: ["GET", health.ready],
  };
  for (const [operation, [method, handler]] of Object.entries(internal)) {
    for (const authorization of [null, "Bearer ", `Bearer ${"d".repeat(64)}`, `Basic ${CREDENTIAL}`, CREDENTIAL]) {
      const headers = { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) };
      const response = await handler(new Request("https://x/api/v1/internal/op", { method, headers, body: method === "POST" ? "{}" : undefined }));
      assert.equal(response.status, 401, `${operation} with ${authorization}`);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), null, `${operation} is not a browser endpoint`);
    }
  }
  assert.deepEqual(calls, []);
  globalThis.__internalOperations = Object.keys(internal);
});

test("every Admin operation rejects a missing, malformed, or forged JWT before touching data", async () => {
  const { calls, persistence } = tripwire();
  const gate = createAdminGate({
    issuer: "https://x.supabase.co/auth/v1", audience: "authenticated", subjectAllowlist: "4effd356-0000-4000-8000-000000000001",
    keyStore: { keyFor: async () => null }, allowedOrigins: ["https://staging.op4n.com"],
  });
  const admin = createAdminHandlers({ persistence, destinationPolicy: createDestinationPolicy(), destinationHmacKey: new Uint8Array(32), shortHosts: ["staging.op4n.me"], environment: "staging" });
  const operations = {
    getAdminSession: ["GET", async () => ({ status: 200, body: {} })],
    findAdminLink: ["POST", admin.findLink], getAdminLinkRecord: ["GET", admin.getRecord],
    revealAdminDestination: ["POST", admin.revealDestination], listAdminCases: ["GET", admin.listCases],
    transitionAdminCase: ["POST", admin.transitionCase], disableCanonicalLink: ["POST", admin.moderate("disable")],
    restoreCanonicalLink: ["POST", admin.moderate("restore")], setAdminDiscovery: ["POST", admin.setDiscovery],
  };
  const forged = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"4effd356-0000-4000-8000-000000000001","aal":"aal2"}').toString("base64url")}.`;
  for (const [operation, [method, handler]] of Object.entries(operations)) {
    for (const authorization of [null, "Bearer not-a-jwt", `Bearer ${forged}`, `Bearer ${CREDENTIAL}`]) {
      const route = gate(operation, handler, { methods: [method] });
      const response = await route(new Request("https://x/api/v1/admin/links/Abc123XYZ9", {
        method, headers: { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) },
        body: method === "POST" ? "{}" : undefined,
      }));
      assert.equal(response.status, 401, `${operation} with ${authorization}`);
    }
  }
  assert.deepEqual(calls, []);
  globalThis.__adminOperations = Object.keys(operations);
});

test("the authorization tests cover every protected operation in the contract", async () => {
  const spec = parse(await readFile(new URL("../../docs/api/r1-openapi.yaml", import.meta.url), "utf8"));
  const protectedOps = Object.values(spec.paths).flatMap((item) => Object.values(item))
    .filter((op) => op && ["environment-service", "founder-admin"].includes(op["x-access-class"]))
    .map((op) => op.operationId).sort();
  assert.deepEqual([...(globalThis.__internalOperations ?? []), ...(globalThis.__adminOperations ?? [])].sort(), protectedOps);
});

test("URL parser fuzz: only public HTTP(S) destinations pass, nothing throws", () => {
  const policy = createDestinationPolicy({ shortLinkHosts: ["op4n.me", "staging.op4n.me"] });
  const rejected = [
    "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://0177.0.0.1/", "http://localhost/", "http://[::1]/",
    "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.1/", "http://192.168.1.1/",
    "http://metadata.internal/", "http://printer.local/", "javascript:alert(1)", "data:text/html,x", "file:///etc/passwd",
    "ftp://example.com/", "https://user:pass@example.com/", "https://op4n.me/ABCDEFGHIJ", "https://OP4N.ME./ABCDEFGHIJ",
    "https://staging.op4n.me/x", "//example.com", "", " ", "\u0000", "https://exa mple.com/",
    `https://example.com/${"a".repeat(3000)}`,
  ];
  for (const input of rejected) {
    let result;
    assert.doesNotThrow(() => { result = policy.parse(input); }, input);
    assert.equal(result.valid, false, `accepted ${JSON.stringify(input)}`);
  }
  for (const input of ["https://example.com/", "http://93.184.216.34/", "https://xn--bcher-kva.example/", "https://example.com:8443/a?b#c"]) {
    assert.equal(policy.parse(input).valid, true, input);
  }
});

test("XSS: hostile titles and summaries render as text on every public card surface", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://op4n.com/" });
  const { window } = dom;
  window.eval(await readFile(new URL("../../public-card.js", import.meta.url), "utf8"));
  window.op4nPublicCard.init();
  const payload = `"><img src=x onerror=alert(1)><script>alert(2)</script>'"`;
  const card = window.op4nPublicCard.createPublicCard({
    id: payload, code: "Abc123XYZ9", title: payload, shortUrl: "https://op4n.me/Abc123XYZ9",
    openUrl: "https://op4n.me/Abc123XYZ9", destinationSummary: `https://example.com/${payload}`, clickCount: 1, source: "public",
  });
  window.document.body.append(card);
  assert.equal(card.querySelectorAll("img, script").length, 0);
  assert.ok(card.querySelector(".link-title").textContent.includes("<img"));
  const blocked = window.op4nPublicCard.createPublicCard({ id: "x", code: "Abc123XYZ9", title: "t", shortUrl: "https://op4n.me/Abc123XYZ9", openUrl: "javascript:alert(1)", destinationSummary: "x", clickCount: 0 });
  assert.equal(blocked.querySelector('a[href^="javascript"]'), null, "non-HTTP open URLs are never linked");
});

test("CORS/CSRF: foreign origins get no credentials-free access to writes and no CORS grant on reads", async () => {
  const create = createLinkHandler({
    environment: "staging", canonicalBaseUrl: "https://staging.op4n.me", allowedOrigins: ["https://staging.op4n.com"],
    destinationPolicy: createDestinationPolicy(), safetyPort: {}, rateLimitGate: {}, featureFlags: { isEnabled: async () => true },
    persistence: {}, generateCanonicalCode: () => "x", destinationHmacKey: new Uint8Array(32), fingerprintKeyVersion: "v",
  });
  const preflight = await create(new Request("https://x/api/v1/links", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } }));
  assert.equal(preflight.status, 403);
  // A form-encoded cross-site POST (no preflight) is refused by content type.
  const formPost = await create(new Request("https://x/api/v1/links", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" }, body: "destinationUrl=https://e.com" }));
  assert.equal(formPost.status, 415);
  assert.equal(formPost.headers.get("Access-Control-Allow-Origin"), null);
  const reads = createPublicReadHandlers({ canonicalBaseUrl: "https://staging.op4n.me", allowedOrigins: ["https://staging.op4n.com"], persistence: { listPublicLinks: async () => ({ items: [] }) }, rateLimitGate: { check: async () => ({ decision: "allowed" }) }, featureFlags: { isEnabled: async () => true } });
  const list = await reads.listLatest(new Request("https://x/api/v1/links", { headers: { Origin: "https://evil.example" } }));
  assert.equal(list.headers.get("Access-Control-Allow-Origin"), null);
});

test("rate-limit identity ignores client-supplied forwarding entries", () => {
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 198.51.100.9" })), "198.51.100.9");
  assert.equal(clientAddress(new Headers({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "6.6.6.6" })), "198.51.100.7");
});

test("open redirect: the short host redirects only stored codes, never a path or parameter", async () => {
  const lookups = [];
  const env = { API_BASE_URL: "https://api.test", INTERNAL_SERVICE_CREDENTIAL: CREDENTIAL, FRONTEND_ORIGIN: "https://staging.op4n.com" };
  for (const path of ["//evil.example", "/%2F%2Fevil.example", "/Abc123XYZ9?url=https://evil.example", "/Abc123XYZ9/https://evil.example", "/\\evil.example", "/https:/evil.example"]) {
    const response = await handleRequest(new Request(`https://staging.op4n.me${path}`), env, { waitUntil() {} }, {
      fetchImpl: async (url, init) => { lookups.push(JSON.parse(init.body)); return Response.json({ decision: "unknown" }); },
    });
    const location = response.headers.get("Location");
    assert.ok(!location || !location.includes("evil"), `${path} -> ${location}`);
  }
  assert.ok(lookups.every((body) => /^[A-Za-z0-9]{6,32}$/.test(body.canonicalCode)), "only clean codes reach the lookup");
});
