import assert from "node:assert/strict";
import test from "node:test";
import {
  clientAddress,
  createPostgresRateLimitGate,
  DEFAULT_RATE_LIMITS,
  rateLimitIdentity,
  resolveRateLimits,
} from "../../supabase/functions/_shared/rate-limit.mjs";
import { createFeatureFlagReader } from "../../supabase/functions/_shared/feature-flags.mjs";
import { createLinkHandler } from "../../supabase/functions/_shared/create-link-handler.mjs";
import { createDestinationPolicy } from "../../supabase/functions/_shared/destination-policy.mjs";
import { resolveRuntimeModes } from "../../supabase/functions/_shared/runtime-modes.mjs";

const KEY = new TextEncoder().encode("TEST-ONLY-RATE-LIMIT-KEY-0001");

test("client address prefers platform headers and never a client-supplied left XFF entry", () => {
  assert.equal(clientAddress(new Headers({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4" })), "198.51.100.7");
  assert.equal(clientAddress(new Headers({ "x-real-ip": "198.51.100.8" })), "198.51.100.8");
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.9" })), "198.51.100.9");
  assert.equal(clientAddress(new Headers()), "unknown");
});

test("identity is a 64-hex HMAC that rotates daily and never contains the address", async () => {
  const day1 = await rateLimitIdentity(KEY, "198.51.100.7", new Date("2026-11-20T01:00:00Z"));
  const day1Later = await rateLimitIdentity(KEY, "198.51.100.7", new Date("2026-11-20T23:59:00Z"));
  const day2 = await rateLimitIdentity(KEY, "198.51.100.7", new Date("2026-11-21T00:00:00Z"));
  const other = await rateLimitIdentity(KEY, "198.51.100.8", new Date("2026-11-20T01:00:00Z"));
  assert.match(day1, /^[0-9a-f]{64}$/);
  assert.equal(day1, day1Later);
  assert.notEqual(day1, day2);
  assert.notEqual(day1, other);
  assert.ok(!day1.includes("198"));
});

function fakePersistence(results) {
  const calls = [];
  return {
    calls,
    async consumeRateLimit(input) {
      calls.push(input);
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const request = new Request("http://local/api/v1/links", { headers: { "cf-connecting-ip": "198.51.100.7" } });

test("gate consumes identity and global windows and merges the decision", async () => {
  const persistence = fakePersistence([
    { decision: "allowed", limit: 5, remaining: 4, reset: 30, retryAfter: 1 },
    { decision: "allowed", limit: 2000, remaining: 1999, reset: 3600, retryAfter: 1 },
  ]);
  const gate = createPostgresRateLimitGate({ environment: "staging", persistence, masterKey: KEY, limits: DEFAULT_RATE_LIMITS });
  const result = await gate.check({ operation: "public-create", request });
  assert.deepEqual(result, { decision: "allowed", limit: 5, remaining: 4, reset: 30, retryAfter: 1 });
  assert.equal(persistence.calls.length, 2);
  assert.match(persistence.calls[0].identity, /^[0-9a-f]{64}$/);
  assert.equal(persistence.calls[1].identity, "global");
  assert.ok(!JSON.stringify(persistence.calls).includes("198.51.100.7"), "raw address never leaves the function");
});

test("gate reports limited when either window is exceeded, with the longest retry", async () => {
  const persistence = fakePersistence([
    { decision: "allowed", limit: 5, remaining: 2, reset: 30, retryAfter: 1 },
    { decision: "limited", limit: 2000, remaining: 0, reset: 4000, retryAfter: 4000 },
  ]);
  const gate = createPostgresRateLimitGate({ environment: "staging", persistence, masterKey: KEY, limits: DEFAULT_RATE_LIMITS });
  const result = await gate.check({ operation: "public-create", request });
  assert.equal(result.decision, "limited");
  assert.equal(result.retryAfter, 4000);
  assert.equal(result.remaining, 0);
});

test("unexpected limiter output is unavailable and storage errors propagate (handler returns 503)", async () => {
  const odd = createPostgresRateLimitGate({
    environment: "staging",
    persistence: fakePersistence([{ decision: "maybe" }, { decision: "allowed" }]),
    masterKey: KEY,
    limits: DEFAULT_RATE_LIMITS,
  });
  assert.equal((await odd.check({ operation: "public-create", request })).decision, "unavailable");
  const failing = createPostgresRateLimitGate({
    environment: "staging",
    persistence: fakePersistence([new Error("db down")]),
    masterKey: KEY,
    limits: DEFAULT_RATE_LIMITS,
  });
  await assert.rejects(failing.check({ operation: "public-create", request }));
  assert.throws(() => createPostgresRateLimitGate({ environment: "staging", persistence: {}, masterKey: new Uint8Array(4), limits: DEFAULT_RATE_LIMITS }));
});

test("rate-limit configuration must be finite and valid", () => {
  assert.deepEqual(resolveRateLimits(undefined)["public-create"].identity[0], { seconds: 60, limit: 5 });
  const override = resolveRateLimits(JSON.stringify({ "public-create": { identity: [{ seconds: 60, limit: 50 }] } }));
  assert.equal(override["public-create"].identity[0].limit, 50);
  for (const bad of [
    { "public-create": { identity: [] } },
    { "public-create": { identity: [{ seconds: 60, limit: 0 }] } },
    { "public-create": { identity: [{ seconds: 999999, limit: 5 }] } },
    { "public-create": { identity: [{ seconds: 60, limit: 5 }], global: [{ seconds: 60 }] } },
    { "Bad Class": { identity: [{ seconds: 60, limit: 5 }] } },
  ]) {
    assert.throws(() => resolveRateLimits(JSON.stringify(bad)), /no finite, valid configuration/);
  }
});

test("postgres rate limiting is the real adapter in every environment", () => {
  for (const environment of ["local", "staging", "production"]) {
    assert.equal(resolveRuntimeModes({ environment, rateLimitMode: "postgres" }).rateLimit, "real");
  }
});

test("feature flag reader caches for the TTL and fails safe to off", async () => {
  let clock = 0;
  let reads = 0;
  let flags = { guest_creation: true };
  const reader = createFeatureFlagReader({
    ttlMs: 30_000,
    now: () => clock,
    persistence: { async getFeatureFlags() { reads += 1; if (flags instanceof Error) throw flags; return flags; } },
  });
  assert.equal(await reader.isEnabled("guest_creation"), true);
  flags = { guest_creation: false };
  clock = 10_000;
  assert.equal(await reader.isEnabled("guest_creation"), true, "cached value within TTL");
  clock = 31_000;
  assert.equal(await reader.isEnabled("guest_creation"), false, "change visible after TTL");
  assert.equal(reads, 2);
  flags = new Error("db down");
  clock = 70_000;
  assert.equal(await reader.isEnabled("guest_creation"), false, "unreadable flags are off");
  assert.equal(await reader.isEnabled("unknown_flag"), false);
});

test("create handler returns 503 FEATURE_UNAVAILABLE when guest creation is paused", async () => {
  let touched = false;
  const handler = createLinkHandler({
    environment: "staging",
    canonicalBaseUrl: "https://staging.op4n.me",
    allowedOrigins: ["https://staging.op4n.com"],
    destinationPolicy: createDestinationPolicy(),
    safetyPort: { async decide() { touched = true; return { decision: "approved" }; } },
    rateLimitGate: { async check() { touched = true; return { decision: "allowed" }; } },
    featureFlags: { async isEnabled(key) { assert.equal(key, "guest_creation"); return false; } },
    persistence: new Proxy({}, { get() { touched = true; return async () => ({}); } }),
    generateCanonicalCode: () => "PAUSED0001",
    destinationHmacKey: new Uint8Array(32),
    fingerprintKeyVersion: "v1",
  });
  const response = await handler(new Request("http://local/functions/v1/op4n-api/api/v1/links", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://staging.op4n.com", "Idempotency-Key": "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901" },
    body: JSON.stringify({ destinationUrl: "https://example.com" }),
  }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://staging.op4n.com");
  assert.equal((await response.json()).error.code, "FEATURE_UNAVAILABLE");
  assert.equal(touched, false, "no rate limit, safety, or persistence work when paused");
});
