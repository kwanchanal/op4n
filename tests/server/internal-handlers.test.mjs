import assert from "node:assert/strict";
import test from "node:test";
import {
  createClickHandler,
  createNotificationClaimHandler,
  createNotificationCompleteHandler,
  createRedirectLookupHandler,
} from "../../supabase/functions/_shared/internal-handlers.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const CREDENTIAL = "c".repeat(64);
const EVENT_ID = "79cb42d9-bd78-4da8-a77f-f8d7f6ea31c2";
const BASE = "http://local/functions/v1/op4n-api/api/v1/internal";

function post(path, body, { credential = CREDENTIAL, headers = {} } = {}) {
  return new Request(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const redirectDecision = {
  decision: "redirect",
  canonicalCode: "Abc123XYZ9",
  fullDestinationUrl: "https://example.com/p?q=1",
  destinationVersion: 1,
  destinationFingerprint: "f".repeat(64),
  cacheControl: "no-store",
  redirectStatus: 302,
};

function lookupHandler(decision, overrides = {}) {
  const calls = [];
  const handler = createRedirectLookupHandler({
    credential: CREDENTIAL,
    persistence: {
      async resolveRedirect(code) {
        calls.push(code);
        if (decision instanceof Error) throw decision;
        return decision;
      },
    },
    ...overrides,
  });
  return { handler, calls };
}

test("router maps only approved paths", () => {
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/links"), "createGuestCanonicalLink");
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/internal/redirect-lookup"), "resolveCanonicalRedirect");
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/internal/clicks"), "recordRedirectClick");
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/admin/links/x"), null);
  assert.equal(routeOperation(""), null);
});

test("redirect lookup returns the contract decision with no CORS headers", async () => {
  const { handler, calls } = lookupHandler(redirectDecision);
  const response = await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("Vary"), null);
  assert.deepEqual(await response.json(), redirectDecision);
  assert.deepEqual(calls, ["Abc123XYZ9"]);
});

test("unknown and disabled decisions never carry a destination", async () => {
  for (const decision of [{ decision: "unknown" }, { decision: "disabled", fullDestinationUrl: "https://leak.example" }, null]) {
    const { handler } = lookupHandler(decision);
    const body = await (await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }))).json();
    assert.ok(["unknown", "disabled"].includes(body.decision));
    assert.equal(body.fullDestinationUrl, undefined);
  }
});

test("internal routes reject missing or wrong credentials and unsafe requests", async () => {
  const { handler, calls } = lookupHandler(redirectDecision);
  const cases = [
    [post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }, { credential: null }), 401],
    [post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }, { credential: "x".repeat(64) }), 401],
    [new Request(`${BASE}/redirect-lookup`, { method: "OPTIONS", headers: { Origin: "https://op4n.com" } }), 405],
    [new Request(`${BASE}/redirect-lookup`, { method: "GET", headers: { Authorization: `Bearer ${CREDENTIAL}` } }), 405],
    [post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }, { headers: { "Content-Type": "text/plain" } }), 415],
    [post("redirect-lookup", "{broken"), 400],
    [post("redirect-lookup", { canonicalCode: "a/b" }), 400],
    [post("redirect-lookup", { canonicalCode: "Abc123XYZ9", destination: "https://x" }), 400],
    [post("redirect-lookup", { canonicalCode: "x".repeat(3000) }), 413],
  ];
  for (const [request, status] of cases) {
    const response = await handler(request);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
  assert.deepEqual(calls, [], "no lookup happens for a rejected request");
});

test("an unset or short credential fails closed with 503", async () => {
  for (const credential of [undefined, "", "short"]) {
    const { handler } = lookupHandler(redirectDecision, { credential });
    const response = await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }, { credential: "anything" }));
    assert.equal(response.status, 503);
  }
});

test("database failure and malformed redirect decisions never redirect", async () => {
  let { handler } = lookupHandler(new Error("db down"));
  assert.equal((await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }))).status, 503);
  ({ handler } = lookupHandler({ ...redirectDecision, fullDestinationUrl: "javascript:alert(1)" }));
  assert.equal((await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }))).status, 500);
  ({ handler } = lookupHandler({ ...redirectDecision, canonicalCode: "Other12345" }));
  assert.equal((await handler(post("redirect-lookup", { canonicalCode: "Abc123XYZ9" }))).status, 500);
});

function clickHandler(result) {
  const calls = [];
  const handler = createClickHandler({
    credential: CREDENTIAL,
    persistence: {
      async recordClick(input) {
        calls.push(input);
        if (result instanceof Error) throw result;
        return result;
      },
    },
  });
  return { handler, calls };
}

const click = (overrides = {}, headers = { "Idempotency-Key": EVENT_ID }) => post("clicks", {
  eventId: EVENT_ID,
  canonicalCode: "Abc123XYZ9",
  destinationVersion: 1,
  occurredAt: "2026-11-19T10:00:00Z",
  ...overrides,
}, { headers });

test("click recording accepts, replays, and rejects conflicts", async () => {
  let { handler, calls } = clickHandler({ kind: "accepted", recordedAt: "2026-11-19T10:00:01Z" });
  let response = await handler(click());
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Idempotency-Replayed"), "false");
  assert.deepEqual(await response.json(), { accepted: true, eventId: EVENT_ID, recordedAt: "2026-11-19T10:00:01.000Z" });
  assert.equal(calls[0].occurredAt, "2026-11-19T10:00:00.000Z");

  ({ handler } = clickHandler({ kind: "replayed", recordedAt: "2026-11-19T10:00:01Z" }));
  response = await handler(click());
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Idempotency-Replayed"), "true");

  ({ handler } = clickHandler({ kind: "conflict" }));
  assert.equal((await handler(click())).status, 409);
  ({ handler } = clickHandler({ kind: "invalid" }));
  assert.equal((await handler(click())).status, 400);
  ({ handler } = clickHandler(new Error("db down")));
  assert.equal((await handler(click())).status, 503);
});

test("click recording validates identity, payload, and key equality", async () => {
  const { handler, calls } = clickHandler({ kind: "accepted", recordedAt: "2026-11-19T10:00:01Z" });
  for (const request of [
    click({}, {}),
    click({}, { "Idempotency-Key": "8a1b42d9-bd78-4da8-a77f-f8d7f6ea31c3" }),
    click({ eventId: "not-a-uuid" }),
    click({ destinationVersion: 2 }),
    click({ occurredAt: "yesterday" }),
    click({ canonicalCode: "../x" }),
    click({ ipAddress: "203.0.113.1" }),
  ]) {
    assert.equal((await handler(request)).status, 400);
  }
  assert.deepEqual(calls, []);
});

test("notification claim and complete require the internal credential and validate input", async () => {
  assert.equal(routeOperation(`/functions/v1/op4n-api/api/v1/internal/notifications/claim`), "claimFounderNotifications");
  assert.equal(routeOperation(`/functions/v1/op4n-api/api/v1/internal/notifications/complete`), "completeFounderNotifications");
  const calls = [];
  const persistence = {
    async claimNotifications(input) {
      calls.push(["claim", input]);
      return { batchId: "11111111-2222-4333-8444-555555555555", events: 2, entries: [
        { canonicalCode: "Abc123XYZ9", kind: "report", reasonCategory: "spam", priority: "S3", count: 2, firstAt: "2026-11-26T10:00:00Z", lastAt: "2026-11-26T10:01:00Z", destination: "https://leak.example" },
      ] };
    },
    async completeNotifications(input) {
      calls.push(["complete", input]);
      return { updated: 2, exhausted: 0 };
    },
  };
  const claim = createNotificationClaimHandler({ credential: CREDENTIAL, persistence, environment: "staging" });
  const complete = createNotificationCompleteHandler({ credential: CREDENTIAL, persistence });

  assert.equal((await claim(post("notifications/claim", {}, { credential: "wrong".repeat(10) }))).status, 401);
  assert.equal((await claim(post("notifications/claim", { limit: 999 }))).status, 400);
  const claimed = await claim(post("notifications/claim", {}));
  assert.equal(claimed.status, 200);
  const body = await claimed.json();
  assert.equal(body.events, 2);
  assert.ok(!JSON.stringify(body).includes("leak.example"), "only allowlisted entry fields are returned");
  assert.deepEqual(calls[0], ["claim", { environment: "staging", limit: 200, leaseSeconds: 120 }]);

  assert.equal((await complete(post("notifications/complete", { batchId: "nope", outcome: "sent" }))).status, 400);
  assert.equal((await complete(post("notifications/complete", { batchId: body.batchId, outcome: "maybe" }))).status, 400);
  const done = await complete(post("notifications/complete", { batchId: body.batchId, outcome: "sent" }));
  assert.deepEqual(await done.json(), { updated: 2, exhausted: 0 });
  assert.equal(done.headers.get("Access-Control-Allow-Origin"), null, "internal routes have no CORS");
});
