// POST /api/v1/links/{code}/reports (submitPublicLinkReport).
// Persists one bounded public report and returns only an opaque receipt.
// Never reveals report, moderation, or safety state, and never changes the
// redirect. Rate-limited by the public-report class; paused by the
// public_reports kill switch.

import { sha256Hex } from "./crypto-values.mjs";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[A-Za-z0-9]{6,32}$/;
const MAX_BODY_BYTES = 4096;
export const REPORT_CATEGORIES = Object.freeze([
  "phishing", "malware", "child_safety", "illegal", "impersonation", "abuse", "spam", "other",
]);
const EXPOSED_HEADERS = [
  "X-Request-ID", "Retry-After", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Idempotency-Replayed",
].join(", ");

export function reportCodeFromPath(pathname) {
  const match = String(pathname).match(/\/api\/v1\/links\/([^/]+)\/reports$/);
  return match ? match[1] : null;
}

// Keeps line breaks and tabs, removes other control characters, trims.
export function sanitizeDetail(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return cleaned || null;
}

export function createReportHandler({
  environment,
  allowedOrigins,
  persistence,
  rateLimitGate,
  featureFlags,
  requestId = () => crypto.randomUUID(),
}) {
  return async function handleReport(request) {
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
    const fail = (status, code, message, details) => {
      const error = { code, message, requestId: id };
      if (details) error.details = details;
      return new Response(JSON.stringify({ error }), { status, headers });
    };

    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.includes(origin)) return fail(403, "FORBIDDEN", "This origin is not permitted.");
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, Idempotency-Key");
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return fail(405, "VALIDATION_ERROR", "The request method or path is not supported.");

    if (featureFlags) {
      let enabled = false;
      try {
        enabled = await featureFlags.isEnabled("public_reports");
      } catch {
        enabled = false;
      }
      if (!enabled) {
        headers.set("Retry-After", "60");
        return fail(503, "FEATURE_UNAVAILABLE", "Reporting is temporarily paused.");
      }
    }

    const code = reportCodeFromPath(new URL(request.url).pathname);
    if (!code || !CODE_PATTERN.test(code)) return fail(404, "LINK_NOT_FOUND", "No public link matches this request.");

    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return fail(415, "VALIDATION_ERROR", "The request content type is not supported.");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return fail(413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const invalid = (field, issue) =>
      fail(400, "VALIDATION_ERROR", "The request contains invalid fields.", [{ field, issue }]);
    if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("reasonCategory", "must be provided in a JSON object");
    const unknown = Object.keys(body).find((key) => !["reasonCategory", "detail"].includes(key));
    if (unknown) return invalid(unknown, "is not an allowed field");
    if (!REPORT_CATEGORIES.includes(body.reasonCategory)) return invalid("reasonCategory", "must be an approved category");
    if (body.detail !== undefined && body.detail !== null && typeof body.detail !== "string") {
      return invalid("detail", "must be a string or null");
    }
    const detail = sanitizeDetail(body.detail);
    if (detail && detail.length > 1000) return invalid("detail", "must not exceed 1000 characters");

    const key = request.headers.get("Idempotency-Key") || "";
    if (!UUID_V4.test(key)) return invalid("Idempotency-Key", "must be a canonical UUID v4");

    if (!rateLimitGate?.check) {
      headers.set("Retry-After", "1");
      return fail(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.");
    }
    let rateLimit;
    try {
      rateLimit = await rateLimitGate.check({ operation: "public-report", request });
    } catch {
      rateLimit = { decision: "unavailable" };
    }
    if (rateLimit.decision === "limited") {
      headers.set("Retry-After", String(rateLimit.retryAfter ?? 1));
      headers.set("RateLimit-Limit", String(rateLimit.limit));
      headers.set("RateLimit-Remaining", String(rateLimit.remaining));
      headers.set("RateLimit-Reset", String(rateLimit.reset));
      return fail(429, "RATE_LIMITED", "Too many requests. Retry after the indicated delay.");
    }
    if (rateLimit.decision !== "allowed") {
      headers.set("Retry-After", "1");
      return fail(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.");
    }

    let result;
    try {
      result = await persistence.submitReport({
        environment,
        canonicalCode: code,
        keyHash: await sha256Hex(key.toLowerCase()),
        payloadDigest: await sha256Hex(JSON.stringify({ code, reasonCategory: body.reasonCategory, detail })),
        reasonCategory: body.reasonCategory,
        detail,
      });
    } catch {
      headers.set("Retry-After", "1");
      return fail(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.");
    }

    if (result?.kind === "accepted" || result?.kind === "replayed") {
      headers.set("Idempotency-Replayed", String(result.kind === "replayed"));
      return new Response(JSON.stringify({ accepted: true, receiptId: result.receiptId }), { status: 202, headers });
    }
    if (result?.kind === "conflict") {
      return fail(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request.");
    }
    return fail(404, "LINK_NOT_FOUND", "No public link matches this request.");
  };
}
