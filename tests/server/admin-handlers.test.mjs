import assert from "node:assert/strict";
import test from "node:test";
import { adminPathParams, classifyLookupQuery, createAdminHandlers } from "../../supabase/functions/_shared/admin-handlers.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import { hmacSha256Hex } from "../../supabase/functions/_shared/crypto-values.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const KEY = new TextEncoder().encode("TEST-ONLY-DESTINATION-HMAC-KEY-01");
const CLAIMS = { sub: "4EFFD356-0000-4000-8000-000000000001", aal: "aal2" };
const BASE = "http://local/functions/v1/op4n-api/api/v1/admin";
const IDEM = "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901";

function build(overrides = {}) {
  const calls = [];
  const persistence = new Proxy({}, {
    get: (_target, name) => async (input) => {
      calls.push([name, input]);
      const handler = overrides[name];
      if (handler instanceof Error) throw handler;
      return typeof handler === "function" ? handler(input) : handler;
    },
  });
  const handlers = createAdminHandlers({
    persistence,
    destinationPolicy: createDestinationPolicy({ shortLinkHosts: ["op4n.me", "staging.op4n.me"] }),
    destinationHmacKey: KEY,
    shortHosts: ["staging.op4n.me"],
    environment: "staging",
  });
  return { handlers, calls };
}

const json = (path, body, { method = "POST", key } = {}) => new Request(`${BASE}${path}`, {
  method,
  headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
  body: method === "GET" ? undefined : JSON.stringify(body),
});
const get = (path) => new Request(`${BASE}${path}`);

test("routes and path params map every Admin operation", () => {
  const cases = {
    "/x/api/v1/admin/session": "getAdminSession",
    "/x/api/v1/admin/link-lookup": "findAdminLink",
    "/x/api/v1/admin/links/Abc123XYZ9": "getAdminLinkRecord",
    "/x/api/v1/admin/links/Abc123XYZ9/reveal": "revealAdminDestination",
    "/x/api/v1/admin/links/Abc123XYZ9/disable": "disableCanonicalLink",
    "/x/api/v1/admin/links/Abc123XYZ9/restore": "restoreCanonicalLink",
    "/x/api/v1/admin/cases": "listAdminCases",
    "/x/api/v1/admin/cases/11111111-2222-4333-8444-555555555555/transition": "transitionAdminCase",
  };
  for (const [path, operation] of Object.entries(cases)) assert.equal(routeOperation(path), operation, path);
  assert.deepEqual(adminPathParams("/x/api/v1/admin/links/Abc123XYZ9/disable"), { code: "Abc123XYZ9", caseId: null });
});

test("lookup input accepts exact code, exact short URL, or a full destination and rejects partial strings", () => {
  const hosts = ["staging.op4n.me"];
  assert.deepEqual(classifyLookupQuery(" Abc123XYZ9 ", hosts), { kind: "code", code: "Abc123XYZ9" });
  assert.deepEqual(classifyLookupQuery("https://staging.op4n.me/Abc123XYZ9", hosts), { kind: "code", code: "Abc123XYZ9" });
  assert.deepEqual(classifyLookupQuery("staging.op4n.me/Abc123XYZ9", hosts), { kind: "code", code: "Abc123XYZ9" });
  assert.deepEqual(classifyLookupQuery("https://example.com/p?q=1", hosts), { kind: "destination", url: "https://example.com/p?q=1" });
  for (const partial of ["Abc", "exa mple", "staging.op4n.me/Abc", "staging.op4n.me/Abc123XYZ9?x=1", "", "ftp://x.y"]) {
    assert.equal(classifyLookupQuery(partial, hosts).kind, "invalid", partial);
  }
});

test("destination lookup matches by HMAC fingerprint of the normalized URL, never by text", async () => {
  const { handlers, calls } = build({ adminFindLink: "Abc123XYZ9" });
  const response = await handlers.findLink({ request: json("/link-lookup", { query: "HTTPS://Example.com/p?q=1" }), claims: CLAIMS });
  assert.deepEqual(response, { status: 200, body: { found: true, canonicalCode: "Abc123XYZ9" } });
  const normalized = createDestinationPolicy().parse("HTTPS://Example.com/p?q=1").normalizedUrl;
  assert.deepEqual(calls[0], ["adminFindLink", { code: null, fingerprint: await hmacSha256Hex(KEY, normalized) }]);
  assert.ok(!JSON.stringify(calls).includes("example.com"), "the destination is not sent as text");
  const none = build({ adminFindLink: null });
  assert.deepEqual(await none.handlers.findLink({ request: json("/link-lookup", { query: "Zzz999yyy8" }), claims: CLAIMS }), { status: 200, body: { found: false } });
  assert.equal((await none.handlers.findLink({ request: json("/link-lookup", { query: "exam" }), claims: CLAIMS })).status, 400);
});

test("record, reveal, queue, and transitions map persistence results", async () => {
  const { handlers, calls } = build({
    adminLinkRecord: (code) => (code === "Abc123XYZ9" ? { canonicalCode: code, lifecycleState: "active" } : null),
    adminRevealDestination: { kind: "revealed", fullDestinationUrl: "https://example.com/p?q=1" },
    adminListCases: { total: 51, items: [{ caseId: "c" }] },
    adminTransitionCase: { kind: "ok", caseState: "triaged" },
  });
  assert.equal((await handlers.getRecord({ request: get("/links/Abc123XYZ9"), claims: CLAIMS })).status, 200);
  assert.equal((await handlers.getRecord({ request: get("/links/Zzz999yyy8"), claims: CLAIMS })).status, 404);
  assert.equal((await handlers.getRecord({ request: get("/links/bad-code"), claims: CLAIMS })).status, 404);
  const revealed = await handlers.revealDestination({ request: json("/links/Abc123XYZ9/reveal", {}), claims: CLAIMS });
  assert.deepEqual(revealed.body, { canonicalCode: "Abc123XYZ9", fullDestinationUrl: "https://example.com/p?q=1", auditRecorded: true });
  assert.equal(calls.find(([name]) => name === "adminRevealDestination")[1].actor, "founder:4effd356-0000-4000-8000-000000000001");
  const queue = await handlers.listCases({ request: get("/cases?page=2"), claims: CLAIMS });
  assert.deepEqual(queue.body, { page: 2, pageSize: 50, total: 51, items: [{ caseId: "c" }] });
  assert.deepEqual(calls.find(([name]) => name === "adminListCases")[1], { limit: 50, offset: 50 });
  assert.equal((await handlers.listCases({ request: get("/cases?page=0"), claims: CLAIMS })).status, 400);
  const caseId = "11111111-2222-4333-8444-555555555555";
  assert.equal((await handlers.transitionCase({ request: json(`/cases/${caseId}/transition`, { action: "triage", note: "" }), claims: CLAIMS })).status, 400);
  assert.equal((await handlers.transitionCase({ request: json(`/cases/${caseId}/transition`, { action: "delete", note: "x" }), claims: CLAIMS })).status, 400);
  const triaged = await handlers.transitionCase({ request: json(`/cases/${caseId}/transition`, { action: "triage", note: " Checking " }), claims: CLAIMS });
  assert.deepEqual(triaged.body, { caseId, caseState: "triaged", auditRecorded: true });
});

test("disable and restore validate reasons and keys, and map every outcome", async () => {
  const outcomes = { kind: "changed", lifecycleState: "disabled" };
  const { handlers, calls } = build({ adminModerateLink: () => outcomes });
  const disable = handlers.moderate("disable");
  const restore = handlers.moderate("restore");
  const request = (body, key = IDEM, path = "/links/Abc123XYZ9/disable") => ({ request: json(path, body, { key }), claims: CLAIMS });

  assert.equal((await disable(request({}))).status, 400, "reason is required");
  assert.equal((await disable(request({ reasonCode: "operator_correction" }))).status, 400, "restore-only reason");
  assert.equal((await disable(request({ reasonCode: "abuse_report" }, "nope"))).status, 400, "key is required");
  assert.equal((await disable(request({ reasonCode: "abuse_report", reasonDetail: "x".repeat(1001) }))).status, 400);
  assert.equal((await disable(request({ reasonCode: "abuse_report", extra: 1 }))).status, 400);
  assert.equal(calls.length, 0, "invalid input never reaches persistence");

  let response = await disable(request({ reasonCode: "abuse_report", reasonDetail: "  confirmed  " }));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { canonicalCode: "Abc123XYZ9", lifecycleState: "disabled", changed: true, auditRecorded: true });
  assert.equal(response.headers["Idempotency-Replayed"], "false");
  assert.equal(calls[0][1].reasonDetail, "confirmed");
  assert.match(calls[0][1].keyHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls[0]).includes(IDEM), "raw idempotency key is not persisted");

  for (const [kind, status, code] of [
    ["replayed", 200, undefined], ["unchanged", 200, undefined], ["conflict", 409, "IDEMPOTENCY_CONFLICT"],
    ["safety_conflict", 409, "SAFETY_HOLD"], ["unknown", 404, "LINK_NOT_FOUND"],
  ]) {
    Object.assign(outcomes, { kind, lifecycleState: "active", safetyState: "blocked" });
    response = await restore(request({ reasonCode: "operator_correction" }, IDEM, "/links/Abc123XYZ9/restore"));
    assert.equal(response.status, status, kind);
    assert.equal(response.body.error?.code, code, kind);
  }
  const down = build({ adminModerateLink: new Error("db down") });
  assert.equal((await down.handlers.moderate("disable")(request({ reasonCode: "abuse_report" }))).status, 503);
});
