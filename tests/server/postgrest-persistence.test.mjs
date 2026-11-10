import assert from "node:assert/strict";
import test from "node:test";
import { createPostgrestPersistence } from "../../supabase/functions/_shared/postgrest-persistence.mjs";

const TEST_BACKEND_VALUE = String.fromCharCode(
  116, 101, 115, 116, 45, 111, 110, 108, 121, 45, 98, 97, 99, 107, 101, 110, 100,
);

test("uses explicit RPCs for reservation, release, and transactional creation", async () => {
  const calls = [];
  const persistence = createPostgrestPersistence({
    supabaseUrl: "http://127.0.0.1:54321",
    secretKey: TEST_BACKEND_VALUE,
    async fetchImpl(url, init) {
      calls.push({ url, init });
      const name = url.split("/").at(-1);
      return Response.json({
        kind: name === "begin_creation_idempotency_v1"
          ? "reserved"
          : name === "release_creation_idempotency_v1"
            ? "released"
            : "created",
        response: {},
      });
    },
  });
  const scope = {
    environment: "local",
    operation: "createGuestCanonicalLink",
    keyHash: "a".repeat(64),
    payloadDigest: "b".repeat(64),
    reservationToken: "d".repeat(64),
  };

  assert.equal((await persistence.beginCreation(scope)).kind, "reserved");
  assert.equal((await persistence.releaseCreation(scope)).kind, "released");
  assert.equal((await persistence.createGuestLink({
    ...scope,
    candidateCode: "ABCDEFGHIJ",
    title: null,
    fullDestinationUrl: "https://example.com/private?x=1#fragment",
    safeOrigin: "https://example.com",
    destinationFingerprint: "c".repeat(64),
    fingerprintAlgorithm: "HMAC-SHA-256",
    fingerprintKeyVersion: "test-only-v1",
    summaryPolicyVersion: "r1-origin-only-v1",
    canonicalBaseUrl: "https://staging.op4n.me",
  })).kind, "created");

  assert.deepEqual(
    calls.map((call) => call.url.split("/").at(-1)),
    [
      "begin_creation_idempotency_v1",
      "release_creation_idempotency_v1",
      "create_guest_link_v1",
    ],
  );
  assert.ok(calls.every((call) => call.init.method === "POST"));
  const bodies = calls.map((call) => JSON.parse(call.init.body));
  assert.equal(Object.hasOwn(bodies[0], "p_reservation_token"), false);
  assert.equal(bodies[1].p_reservation_token, scope.reservationToken);
  assert.equal(bodies[2].p_reservation_token, scope.reservationToken);
});

test("retries only the issued-code unique constraint", async () => {
  const make = (details) => createPostgrestPersistence({
    supabaseUrl: "http://127.0.0.1:54321",
    secretKey: TEST_BACKEND_VALUE,
    fetchImpl: async () => Response.json({
      code: "23505",
      details,
    }, { status: 409 }),
  });
  const input = {
    environment: "local",
    operation: "createGuestCanonicalLink",
    keyHash: "a".repeat(64),
    payloadDigest: "b".repeat(64),
    reservationToken: "d".repeat(64),
    candidateCode: "ABCDEFGHIJ",
  };

  assert.equal((await make("issued_codes_canonical_code_key").createGuestLink(input)).kind, "code_collision");
  await assert.rejects(
    make("creation_idempotency_scope_key").createGuestLink(input),
    /Database creation operation failed/,
  );
});
