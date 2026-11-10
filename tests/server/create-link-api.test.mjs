import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalCodeGenerator } from "../../supabase/functions/_shared/canonical-code.mjs";
import {
  createLinkHandler,
  deterministicLocalRateLimitGate,
} from "../../supabase/functions/_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import { evaluateCreateReadiness } from "../../supabase/functions/_shared/readiness.mjs";
import { deterministicSafetyPort } from "../../supabase/functions/_shared/safety-port.mjs";

const IDEMPOTENCY_KEY = "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901";
const ORIGIN = "http://127.0.0.1:5500";
const TEST_HMAC_BYTES = new Uint8Array([
  84, 69, 83, 84, 45, 79, 78, 76, 89, 45, 78, 79, 84, 45, 83, 69,
  67, 82, 69, 84, 45, 75, 69, 89,
]);

test("creates a six-field public Guest card with contract headers", async () => {
  const persistence = memoryPersistence();
  const handler = buildHandler({ persistence });
  const response = await handler(createRequest({
    title: "Documentation",
    destinationUrl: "https://example.com/private?token=secret#fragment",
  }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Idempotency-Replayed"), "false");
  assert.equal(Object.keys(body).length, 6);
  assert.deepEqual(body.safeDestinationSummary, {
    origin: "https://example.com",
    displayValue: "https://example.com",
  });
  assert.equal(body.aggregateTotalClicks, 0);
  assert.equal(body.canonicalOpenUrl, body.canonicalShortUrl);
  assert.doesNotMatch(JSON.stringify(body), /private|token|secret|fragment|destinationFingerprint|fullDestination|linkId/);
  assert.equal(persistence.snapshot().links.length, 1);
});

test("supports absent and null title with safe fallback", async () => {
  for (const payload of [
    { destinationUrl: "https://example.com/one" },
    { title: null, destinationUrl: "https://example.com/two" },
  ]) {
    const response = await buildHandler({ persistence: memoryPersistence() })(createRequest(payload));
    assert.equal((await response.json()).displayTitle, "Untitled link");
  }
});

test("rejects invalid method, media type, body, fields, key, and body size", async () => {
  const handler = buildHandler({ persistence: memoryPersistence() });
  const cases = [
    new Request("http://local/functions/v1/op4n-api/api/v1/links", { method: "GET" }),
    new Request("http://local/functions/v1/op4n-api/api/v1/links", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "Idempotency-Key": IDEMPOTENCY_KEY },
      body: "{}",
    }),
    rawRequest("{broken"),
    createRequest({ destinationUrl: "https://example.com", extra: true }),
    new Request("http://local/functions/v1/op4n-api/api/v1/links", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "not-a-uuid" },
      body: JSON.stringify({ destinationUrl: "https://example.com" }),
    }),
    rawRequest(JSON.stringify({ destinationUrl: "https://example.com", title: "x".repeat(9000) })),
  ];
  const expected = [405, 415, 400, 400, 400, 413];
  for (let index = 0; index < cases.length; index += 1) {
    const response = await handler(cases[index]);
    assert.equal(response.status, expected[index]);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Vary"), "Origin");
    if (cases[index].headers.get("Origin") === ORIGIN) {
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
    }
    assert.equal(typeof (await response.json()).error.requestId, "string");
  }
});

test("handles exact-origin browser preflight without credentials", async () => {
  const handler = buildHandler({ persistence: memoryPersistence() });
  const response = await handler(new Request(
    "http://local/functions/v1/op4n-api/api/v1/links",
    { method: "OPTIONS", headers: { Origin: ORIGIN } },
  ));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("rejects unsupported destinations before persistence", async () => {
  const persistence = memoryPersistence();
  const handler = buildHandler({ persistence });
  for (const destinationUrl of [
    "javascript:alert(1)",
    "file:///tmp/example",
    "https://user:password@example.com",
    "https://op4n.me/ABCDEFGHIJ",
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    const response = await handler(createRequest({ destinationUrl }, crypto.randomUUID()));
    assert.ok([400, 422].includes(response.status));
  }
  assert.equal(persistence.snapshot().links.length, 0);
});

test("fails closed for blocked or unavailable safety and missing production gates", async () => {
  const blocked = await buildHandler({
    persistence: memoryPersistence(),
    safetyDecision: "blocked",
  })(createRequest({ destinationUrl: "https://example.com" }));
  assert.equal(blocked.status, 422);
  assert.equal((await blocked.json()).error.code, "DESTINATION_BLOCKED");

  const unavailable = await buildHandler({
    persistence: memoryPersistence(),
    safetyDecision: "unavailable",
  })(createRequest({ destinationUrl: "https://example.com" }));
  assert.equal(unavailable.status, 503);

  const readiness = evaluateCreateReadiness({
    environment: "production",
    safetyAdapterKind: "missing",
    rateLimitAdapterKind: "missing",
    databaseConfigured: true,
    destinationHmacConfigured: true,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.safety, false);
  assert.equal(readiness.checks.rateLimit, false);
});

test("replays same payload, conflicts different payload, and reports in-progress", async () => {
  const persistence = memoryPersistence();
  const handler = buildHandler({ persistence });
  const createdRequest = () => createRequest(
    { destinationUrl: "https://example.com/same" },
    IDEMPOTENCY_KEY.toUpperCase(),
  );
  const replayRequest = () => createRequest({ destinationUrl: "https://example.com/same" });

  const created = await handler(createdRequest());
  const replay = await handler(replayRequest());
  assert.equal(created.status, 201);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("Idempotency-Replayed"), "true");
  assert.deepEqual(await replay.json(), await created.json());
  assert.equal(persistence.snapshot().links.length, 1);

  const conflict = await handler(createRequest({ destinationUrl: "https://example.com/different" }));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(conflict.headers.has("Retry-After"), false);

  persistence.setInProgress(true);
  const inProgress = await handler(createRequest(
    { destinationUrl: "https://example.com/pending" },
    "9f14e45f-ceea-4a5f-8b9e-12f4a7c6d902",
  ));
  assert.equal(inProgress.status, 409);
  assert.equal((await inProgress.json()).error.code, "IDEMPOTENCY_IN_PROGRESS");
  assert.equal(inProgress.headers.get("Retry-After"), "1");
});

test("reservation fencing rejects stale release and stale commit after takeover", async () => {
  const persistence = memoryPersistence();
  const scope = {
    environment: "local",
    operation: "createGuestCanonicalLink",
    keyHash: "a".repeat(64),
    payloadDigest: "b".repeat(64),
  };
  const first = await persistence.beginCreation(scope);
  persistence.expireLease(scope);
  const second = await persistence.beginCreation(scope);

  assert.notEqual(first.reservationToken, second.reservationToken);
  await persistence.releaseCreation({ ...scope, reservationToken: first.reservationToken });
  assert.equal(persistence.snapshot().idempotency.length, 1);
  await assert.rejects(
    persistence.createGuestLink(creationInput(scope, first.reservationToken)),
    /missing reservation/,
  );
  const committed = await persistence.createGuestLink(
    creationInput(scope, second.reservationToken),
  );
  assert.equal(committed.kind, "created");
  assert.equal(persistence.snapshot().links.length, 1);
});

test("concurrent identical requests create only one link", async () => {
  const persistence = memoryPersistence();
  const handler = buildHandler({ persistence });
  persistence.pauseCreation();
  const firstPromise = handler(createRequest({ destinationUrl: "https://example.com/concurrent" }));
  await persistence.creationStarted();
  const second = await handler(createRequest({ destinationUrl: "https://example.com/concurrent" }));
  persistence.resumeCreation();
  const first = await firstPromise;

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error.code, "IDEMPOTENCY_IN_PROGRESS");
  assert.equal(persistence.snapshot().links.length, 1);
});

test("retries a forced code collision and bounds exhaustion", async () => {
  const successPersistence = memoryPersistence({ collisions: 1 });
  const success = await buildHandler({ persistence: successPersistence })(
    createRequest({ destinationUrl: "https://example.com/collision" }),
  );
  assert.equal(success.status, 201);
  assert.equal(successPersistence.snapshot().attempts, 2);
  assert.equal(successPersistence.snapshot().links.length, 1);

  const exhaustedPersistence = memoryPersistence({ collisions: 99 });
  const exhausted = await buildHandler({ persistence: exhaustedPersistence })(
    createRequest({ destinationUrl: "https://example.com/exhausted" }),
  );
  assert.equal(exhausted.status, 500);
  assert.equal((await exhausted.json()).error.code, "INTERNAL_ERROR");
  assert.equal(exhaustedPersistence.snapshot().attempts, 5);
  assert.equal(exhaustedPersistence.snapshot().links.length, 0);
  assert.equal(exhaustedPersistence.snapshot().idempotency.length, 0);
});

test("releases an idempotency reservation after a persistence failure", async () => {
  const persistence = memoryPersistence();
  persistence.createGuestLink = async () => {
    throw new Error("injected persistence failure");
  };
  const response = await buildHandler({ persistence })(
    createRequest({ destinationUrl: "https://example.com/failure" }),
  );
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
  assert.equal(persistence.snapshot().links.length, 0);
  assert.equal(persistence.snapshot().idempotency.length, 0);
});

function buildHandler({ persistence, safetyDecision = "approved" }) {
  let nextByte = 1;
  return createLinkHandler({
    environment: "local",
    canonicalBaseUrl: "https://staging.op4n.me",
    allowedOrigins: [ORIGIN],
    destinationPolicy: createDestinationPolicy({
      shortLinkHosts: ["op4n.me", "staging.op4n.me"],
    }),
    safetyPort: deterministicSafetyPort(safetyDecision),
    rateLimitGate: deterministicLocalRateLimitGate(),
    persistence,
    generateCanonicalCode: createCanonicalCodeGenerator({
      randomSource(length) {
        const value = nextByte++;
        return new Uint8Array(length).fill(value);
      },
    }),
    destinationHmacKey: TEST_HMAC_BYTES,
    fingerprintKeyVersion: "test-only-v1",
  });
}

function createRequest(body, key = IDEMPOTENCY_KEY) {
  return new Request("http://local/functions/v1/op4n-api/api/v1/links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      Origin: ORIGIN,
    },
    body: JSON.stringify(body),
  });
}

function rawRequest(body) {
  return new Request("http://local/functions/v1/op4n-api/api/v1/links", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": IDEMPOTENCY_KEY,
      Origin: ORIGIN,
    },
    body,
  });
}

function memoryPersistence({ collisions = 0 } = {}) {
  const idempotency = new Map();
  const links = [];
  let attempts = 0;
  let forceInProgress = false;
  let tokenSequence = 0;
  let creationGate = null;
  let signalCreationStarted = null;
  let creationStartedPromise = null;
  return {
    async beginCreation(input) {
      if (forceInProgress) return { kind: "in_progress" };
      const scope = `${input.environment}:${input.operation}:${input.keyHash}`;
      const existing = idempotency.get(scope);
      if (existing && !existing.expired) {
        if (existing.payloadDigest !== input.payloadDigest) return { kind: "conflict" };
        if (existing.status === "succeeded") {
          return { kind: "replayed", response: existing.response };
        }
        return { kind: "in_progress" };
      }
      const reservationToken = (++tokenSequence).toString(16).padStart(64, "0");
      idempotency.set(scope, {
        payloadDigest: input.payloadDigest,
        reservationToken,
        status: "in_progress",
        expired: false,
      });
      return { kind: "reserved", reservationToken };
    },
    async releaseCreation(input) {
      const scope = `${input.environment}:${input.operation}:${input.keyHash}`;
      const existing = idempotency.get(scope);
      if (existing?.status === "in_progress" &&
          existing.payloadDigest === input.payloadDigest &&
          existing.reservationToken === input.reservationToken) {
        idempotency.delete(scope);
      }
      return { kind: "released" };
    },
    async createGuestLink(input) {
      attempts += 1;
      const scope = `${input.environment}:${input.operation}:${input.keyHash}`;
      const existing = idempotency.get(scope);
      if (!existing || existing.status !== "in_progress" ||
          existing.payloadDigest !== input.payloadDigest ||
          existing.reservationToken !== input.reservationToken || existing.expired) {
        throw new Error("missing reservation");
      }
      if (creationGate) {
        signalCreationStarted();
        await creationGate;
      }
      if (attempts <= collisions) return { kind: "code_collision" };
      const canonicalShortUrl = `${input.canonicalBaseUrl}/${input.candidateCode}`;
      const response = {
        canonicalCode: input.candidateCode,
        displayTitle: input.title || "Untitled link",
        canonicalShortUrl,
        canonicalOpenUrl: canonicalShortUrl,
        safeDestinationSummary: {
          origin: input.safeOrigin,
          displayValue: input.safeOrigin,
        },
        aggregateTotalClicks: 0,
      };
      links.push({
        code: input.candidateCode,
        destination: input.fullDestinationUrl,
        fingerprint: input.destinationFingerprint,
      });
      idempotency.set(scope, {
        payloadDigest: input.payloadDigest,
        status: "succeeded",
        response,
      });
      return { kind: "created", response };
    },
    setInProgress(value) {
      forceInProgress = value;
    },
    expireLease(input) {
      const scope = `${input.environment}:${input.operation}:${input.keyHash}`;
      const existing = idempotency.get(scope);
      if (existing) existing.expired = true;
    },
    pauseCreation() {
      creationStartedPromise = new Promise((resolve) => {
        signalCreationStarted = resolve;
      });
      creationGate = new Promise((resolve) => {
        this.resumeCreation = resolve;
      });
    },
    creationStarted() {
      return creationStartedPromise;
    },
    resumeCreation() {},
    snapshot() {
      return {
        links: structuredClone(links),
        attempts,
        idempotency: structuredClone([...idempotency.values()]),
      };
    },
  };
}

function creationInput(scope, reservationToken) {
  return {
    ...scope,
    reservationToken,
    candidateCode: "ABCDEFGHIJ",
    title: null,
    fullDestinationUrl: "https://example.com/private?x=1#fragment",
    safeOrigin: "https://example.com",
    destinationFingerprint: "c".repeat(64),
    fingerprintAlgorithm: "HMAC-SHA-256",
    fingerprintKeyVersion: "test-only-v1",
    summaryPolicyVersion: "r1-origin-only-v1",
    canonicalBaseUrl: "https://staging.op4n.me",
  };
}
