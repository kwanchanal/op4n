// Postgres fixed-window rate limiting for public API classes.
// Identity = HMAC-SHA-256(dailyKey, clientAddress), dailyKey =
// HMAC-SHA-256(masterKey, "op4n-rate-limit:" + UTC date). The raw address is
// never stored, logged, or returned. Limits are configuration (OP4N_RATE_LIMITS).

import { hmacSha256Hex } from "./crypto-values.mjs";

// PENDING (non-blocking): founder approves these defaults before Production.
export const DEFAULT_RATE_LIMITS = Object.freeze({
  "public-create": Object.freeze({
    identity: Object.freeze([
      Object.freeze({ seconds: 60, limit: 5 }),
      Object.freeze({ seconds: 3600, limit: 30 }),
      Object.freeze({ seconds: 86400, limit: 100 }),
    ]),
    global: Object.freeze([Object.freeze({ seconds: 86400, limit: 2000 })]),
  }),
  "public-report": Object.freeze({
    identity: Object.freeze([
      Object.freeze({ seconds: 3600, limit: 5 }),
      Object.freeze({ seconds: 86400, limit: 20 }),
    ]),
    global: Object.freeze([Object.freeze({ seconds: 86400, limit: 1000 })]),
  }),
  // Latest Links and the public card route.
  "public-read": Object.freeze({
    identity: Object.freeze([Object.freeze({ seconds: 60, limit: 120 })]),
    global: Object.freeze([Object.freeze({ seconds: 60, limit: 6000 })]),
  }),
  // Exact lookup: the daily cap bounds code enumeration per identity.
  "public-search": Object.freeze({
    identity: Object.freeze([
      Object.freeze({ seconds: 60, limit: 30 }),
      Object.freeze({ seconds: 86400, limit: 300 }),
    ]),
    global: Object.freeze([Object.freeze({ seconds: 86400, limit: 50000 })]),
  }),
});

// Every public class must be configured before the API starts.
export const REQUIRED_RATE_LIMIT_CLASSES = Object.freeze(["public-create", "public-read", "public-search", "public-report"]);

function validWindows(windows) {
  return Array.isArray(windows) && windows.length >= 1 && windows.length <= 8 &&
    windows.every((window) =>
      Number.isInteger(window?.seconds) && window.seconds >= 1 && window.seconds <= 86400 &&
      Number.isInteger(window?.limit) && window.limit >= 1);
}

// Merges an optional JSON override onto the defaults. Production must never
// start with a missing, unlimited, or malformed class, so invalid input throws.
export function resolveRateLimits(overrideJson) {
  const limits = { ...DEFAULT_RATE_LIMITS };
  if (overrideJson) {
    const parsed = JSON.parse(overrideJson);
    for (const [limitClass, definition] of Object.entries(parsed)) {
      limits[limitClass] = definition;
    }
  }
  for (const required of REQUIRED_RATE_LIMIT_CLASSES) {
    if (!limits[required]) throw new Error(`Rate-limit class ${required} has no finite, valid configuration.`);
  }
  for (const [limitClass, definition] of Object.entries(limits)) {
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(limitClass) || !validWindows(definition?.identity) ||
        (definition.global !== undefined && !validWindows(definition.global))) {
      throw new Error(`Rate-limit class ${limitClass} has no finite, valid configuration.`);
    }
  }
  return Object.freeze(limits);
}

// Client address as set by the platform edge. cf-connecting-ip and x-real-ip
// are set by the proxy; for x-forwarded-for only the right-most entry (added
// by the nearest trusted proxy) is used, never a client-supplied left entry.
export function clientAddress(headers) {
  const direct = headers.get("cf-connecting-ip") || headers.get("x-real-ip");
  if (direct) return direct.trim();
  const forwarded = (headers.get("x-forwarded-for") || "").split(",").map((item) => item.trim()).filter(Boolean);
  return forwarded.at(-1) || "unknown";
}

export async function rateLimitIdentity(masterKey, address, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const dailyKey = await hmacSha256Hex(masterKey, `op4n-rate-limit:${day}`);
  return hmacSha256Hex(new TextEncoder().encode(dailyKey), address);
}

export function createPostgresRateLimitGate({ environment, persistence, masterKey, limits, now = () => new Date() }) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length < 16) {
    throw new Error("Rate-limit key material is missing.");
  }
  return Object.freeze({
    kind: "real",
    async check({ operation, request }) {
      const definition = limits[operation];
      if (!definition) throw new Error(`No rate-limit class for ${operation}.`);
      const identity = await rateLimitIdentity(masterKey, clientAddress(request.headers), now());
      const perIdentity = await persistence.consumeRateLimit({
        environment, limitClass: operation, identity, windows: definition.identity,
      });
      const global = definition.global
        ? await persistence.consumeRateLimit({
          environment, limitClass: operation, identity: "global", windows: definition.global,
        })
        : null;
      const results = [perIdentity, global].filter(Boolean);
      if (results.some((result) => !["allowed", "limited"].includes(result?.decision))) {
        return { decision: "unavailable" };
      }
      const limited = results.filter((result) => result.decision === "limited");
      return {
        decision: limited.length ? "limited" : "allowed",
        limit: perIdentity.limit,
        remaining: limited.length ? 0 : perIdentity.remaining,
        reset: perIdentity.reset,
        retryAfter: Math.max(1, ...limited.map((result) => result.retryAfter)),
      };
    },
  });
}
