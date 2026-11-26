// Public read API (Feature Inventory Orders 62-64, 72, 76, 78):
//   GET /api/v1/links             listLatestPublicLinks   (public-read, latest_links)
//   GET /api/v1/links/{code}      getPublicLinkCard       (public-read, latest_links)
//   GET /api/v1/link-lookup?input exactLookupPublicLink   (public-search, public_search)
// Every response is no-store and carries only PublicLinkCard fields. A
// non-discoverable active link is indistinguishable from an unknown code;
// a disabled/blocked/pending code returns LINK_DISABLED with no card fields.

import { normalizeLookupInput } from "./lookup-normalizer.mjs";

const CODE = /^[A-Za-z0-9]{6,32}$/;
const EXPOSED_HEADERS = ["X-Request-ID", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"].join(", ");
const MESSAGES = Object.freeze({
  LINK_NOT_FOUND: "No public link matches this request.",
  LINK_DISABLED: "This link is not available.",
});

export function createPublicReadHandlers({
  canonicalBaseUrl,
  allowedOrigins,
  persistence,
  rateLimitGate,
  featureFlags,
  requestId = () => crypto.randomUUID(),
}) {
  const shortHost = new URL(canonicalBaseUrl).hostname;

  function context(request) {
    const id = requestId();
    const origin = request.headers.get("Origin");
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "Vary": "Origin",
      "X-Request-ID": id,
    });
    if (origin && allowedOrigins.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    }
    const send = (status, body) => new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status, headers });
    const fail = (status, code, message, details) =>
      send(status, { error: { code, message, requestId: id, ...(details ? { details } : {}) } });
    const unavailable = () => {
      headers.set("Retry-After", "1");
      return fail(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.");
    };
    return { headers, send, fail, unavailable };
  }

  // Method, flag, then rate limit. Returns a Response to stop, or the
  // allowed rate-limit result.
  async function gate(request, ctx, { flag, limitClass, pausedMessage }) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return { stop: ctx.fail(405, "VALIDATION_ERROR", "The request method or path is not supported.") };
    }
    let enabled = false;
    try {
      enabled = await featureFlags.isEnabled(flag);
    } catch {
      enabled = false;
    }
    if (!enabled) {
      ctx.headers.set("Retry-After", "60");
      return { stop: ctx.fail(503, "FEATURE_UNAVAILABLE", pausedMessage) };
    }
    // Fail closed: no limiter, or a limiter error, means 503 for this class.
    if (!rateLimitGate?.check) return { stop: ctx.unavailable() };
    let limit;
    try {
      limit = await rateLimitGate.check({ operation: limitClass, request });
    } catch {
      return { stop: ctx.unavailable() };
    }
    if (limit.decision === "limited") {
      ctx.headers.set("Retry-After", String(limit.retryAfter ?? 1));
      setRateHeaders(ctx.headers, limit);
      return { stop: ctx.fail(429, "RATE_LIMITED", "Too many requests. Retry after the indicated delay.") };
    }
    if (limit.decision !== "allowed") return { stop: ctx.unavailable() };
    setRateHeaders(ctx.headers, limit);
    return { limit };
  }

  function respondLookup(ctx, result) {
    if (result?.kind === "card" && result.card) return ctx.send(200, result.card);
    if (result?.kind === "unavailable") return ctx.fail(404, "LINK_DISABLED", MESSAGES.LINK_DISABLED);
    if (result?.kind === "not_found") return ctx.fail(404, "LINK_NOT_FOUND", MESSAGES.LINK_NOT_FOUND);
    return ctx.unavailable();
  }

  return Object.freeze({
    async listLatest(request) {
      const ctx = context(request);
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get("limit");
      const limit = rawLimit === null ? 100 : Number(rawLimit);
      const unknown = [...url.searchParams.keys()].find((key) => key !== "limit");
      if (unknown || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return ctx.fail(400, "VALIDATION_ERROR", "The request contains invalid fields.", [
          { field: unknown ?? "limit", issue: unknown ? "is not an allowed parameter" : "must be an integer from 1 to 100" },
        ]);
      }
      const gated = await gate(request, ctx, { flag: "latest_links", limitClass: "public-read", pausedMessage: "Latest Links is temporarily paused." });
      if (gated.stop) return gated.stop;
      let result;
      try {
        result = await persistence.listPublicLinks({ baseUrl: canonicalBaseUrl, limit });
      } catch {
        return ctx.unavailable();
      }
      if (!Array.isArray(result?.items)) return ctx.unavailable();
      return ctx.send(200, { items: result.items });
    },

    async getCard(request) {
      const ctx = context(request);
      const match = new URL(request.url).pathname.match(/\/api\/v1\/links\/([^/]+)$/);
      const code = match?.[1];
      if (!code || !CODE.test(code)) return ctx.fail(404, "LINK_NOT_FOUND", MESSAGES.LINK_NOT_FOUND);
      const gated = await gate(request, ctx, { flag: "latest_links", limitClass: "public-read", pausedMessage: "Public links are temporarily paused." });
      if (gated.stop) return gated.stop;
      try {
        return respondLookup(ctx, await persistence.publicLinkLookup({ code, baseUrl: canonicalBaseUrl }));
      } catch {
        return ctx.unavailable();
      }
    },

    async exactLookup(request) {
      const ctx = context(request);
      const url = new URL(request.url);
      const unknown = [...url.searchParams.keys()].find((key) => key !== "input");
      const normalized = normalizeLookupInput(url.searchParams.get("input"), shortHost);
      // Rejected shapes never reach the limiter or the database.
      if (unknown || url.searchParams.getAll("input").length !== 1 || !normalized.valid) {
        return ctx.fail(400, "VALIDATION_ERROR", "Enter a short URL or code.", [
          { field: unknown ?? "input", issue: "must be an exact short URL or code" },
        ]);
      }
      const gated = await gate(request, ctx, { flag: "public_search", limitClass: "public-search", pausedMessage: "Search is temporarily paused." });
      if (gated.stop) return gated.stop;
      try {
        return respondLookup(ctx, await persistence.publicLinkLookup({ code: normalized.code, baseUrl: canonicalBaseUrl }));
      } catch {
        return ctx.unavailable();
      }
    },
  });
}

function setRateHeaders(headers, limit) {
  if (limit.limit !== undefined) headers.set("RateLimit-Limit", String(limit.limit));
  if (limit.remaining !== undefined) headers.set("RateLimit-Remaining", String(limit.remaining));
  if (limit.reset !== undefined) headers.set("RateLimit-Reset", String(limit.reset));
}
