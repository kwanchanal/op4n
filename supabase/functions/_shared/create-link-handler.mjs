import { MAX_CODE_ATTEMPTS } from "./canonical-code.mjs";
import { hmacSha256Hex, sha256Hex } from "./crypto-values.mjs";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVATION_TOKEN = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 8192;
const ALLOWED_FIELDS = new Set(["destinationUrl", "title"]);

export function createLinkHandler(dependencies) {
  const {
    environment,
    canonicalBaseUrl,
    allowedOrigins,
    destinationPolicy,
    safetyPort,
    rateLimitGate,
    persistence,
    generateCanonicalCode,
    destinationHmacKey,
    fingerprintKeyVersion,
    requestId = () => crypto.randomUUID(),
  } = dependencies;

  return async function handle(request) {
    const id = requestId();
    const origin = request.headers.get("Origin");
    const headers = responseHeaders(id, origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.includes(origin)) {
        return errorResponse(403, "FORBIDDEN", "This origin is not permitted.", id, headers);
      }
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, Idempotency-Key");
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }

    const path = new URL(request.url).pathname;
    if (!path.endsWith("/api/v1/links") || request.method !== "POST") {
      return errorResponse(405, "VALIDATION_ERROR", "The request method or path is not supported.", id, headers);
    }

    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return errorResponse(415, "VALIDATION_ERROR", "The request content type is not supported.", id, headers);
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return errorResponse(413, "PAYLOAD_TOO_LARGE", "The request body is too large.", id, headers);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "PAYLOAD_TOO_LARGE", "The request body is too large.", id, headers);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return validationError(id, headers, "destinationUrl", "must be valid JSON");
    }
    if (!body || Array.isArray(body) || typeof body !== "object") {
      return validationError(id, headers, "destinationUrl", "must be provided in a JSON object");
    }
    const unknownField = Object.keys(body).find((field) => !ALLOWED_FIELDS.has(field));
    if (unknownField) {
      return validationError(id, headers, "destinationUrl", `unknown field: ${unknownField}`);
    }
    if (!Object.hasOwn(body, "destinationUrl")) {
      return validationError(id, headers, "destinationUrl", "is required");
    }
    if (body.title !== undefined && body.title !== null && typeof body.title !== "string") {
      return validationError(id, headers, "title", "must be a string or null");
    }
    if (typeof body.title === "string" && body.title.length > 200) {
      return validationError(id, headers, "title", "must not exceed 200 characters");
    }

    const rawKey = request.headers.get("Idempotency-Key") || "";
    if (!UUID_V4.test(rawKey)) {
      return validationError(id, headers, "Idempotency-Key", "must be a canonical UUID v4");
    }
    const normalizedKey = rawKey.toLowerCase();
    const destination = destinationPolicy.parse(body.destinationUrl);
    if (!destination.valid) {
      const status = destination.code === "UNSUPPORTED_PROTOCOL" ? 422 : 400;
      return errorResponse(status, destination.code, destination.message, id, headers, [
        { field: "destinationUrl", issue: "failed the server destination policy" },
      ]);
    }

    const title = normalizeTitle(body.title);
    const payloadDigest = await sha256Hex(JSON.stringify({
      destinationUrl: destination.normalizedUrl,
      title,
    }));
    const keyHash = await sha256Hex(normalizedKey);
    const idempotencyScope = {
      environment,
      operation: "createGuestCanonicalLink",
      keyHash,
      payloadDigest,
    };

    if (!rateLimitGate?.check) {
      return dependencyUnavailable(id, headers);
    }
    let rateLimit;
    try {
      rateLimit = await rateLimitGate.check({ operation: "public-create" });
    } catch {
      return dependencyUnavailable(id, headers);
    }
    if (rateLimit.decision !== "allowed") {
      if (rateLimit.decision === "unavailable") return dependencyUnavailable(id, headers);
      headers.set("Retry-After", String(rateLimit.retryAfter ?? 1));
      setRateHeaders(headers, rateLimit);
      return errorResponse(429, "RATE_LIMITED", "Too many requests. Retry after the indicated delay.", id, headers);
    }

    let reservation;
    try {
      reservation = await persistence.beginCreation(idempotencyScope);
    } catch {
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
    }
    if (reservation.kind === "conflict") {
      headers.set("Idempotency-Replayed", "false");
      return errorResponse(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request.", id, headers);
    }
    if (reservation.kind === "in_progress") {
      headers.set("Idempotency-Replayed", "false");
      headers.set("Retry-After", "1");
      return errorResponse(409, "IDEMPOTENCY_IN_PROGRESS", "An identical request is still being processed.", id, headers);
    }
    if (reservation.kind === "replayed") {
      headers.set("Idempotency-Replayed", "true");
      setRateHeaders(headers, rateLimit);
      return jsonResponse(201, reservation.response, headers);
    }
    if (reservation.kind !== "reserved") {
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
    }
    const reservationToken = reservation.reservationToken;
    if (typeof reservationToken !== "string" || !RESERVATION_TOKEN.test(reservationToken)) {
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
    }

    const releaseReservation = async () => {
      try {
        await persistence.releaseCreation({ ...idempotencyScope, reservationToken });
      } catch {
        // The record expires after the bounded retention window; never expose internals.
      }
    };

    let safety;
    try {
      safety = await safetyPort.decide({ destinationUrl: destination.normalizedUrl });
    } catch {
      await releaseReservation();
      return dependencyUnavailable(id, headers);
    }
    if (safety.decision === "blocked") {
      await releaseReservation();
      return errorResponse(422, "DESTINATION_BLOCKED", "This destination cannot be shortened.", id, headers);
    }
    if (safety.decision !== "approved") {
      await releaseReservation();
      return dependencyUnavailable(id, headers);
    }
    if (!(destinationHmacKey instanceof Uint8Array) || destinationHmacKey.length < 16 ||
        !fingerprintKeyVersion) {
      await releaseReservation();
      return dependencyUnavailable(id, headers);
    }

    let destinationFingerprint;
    try {
      destinationFingerprint = await hmacSha256Hex(
        destinationHmacKey,
        destination.normalizedUrl,
      );
    } catch {
      await releaseReservation();
      return dependencyUnavailable(id, headers);
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      let result;
      try {
        result = await persistence.createGuestLink({
          environment,
          ...idempotencyScope,
          reservationToken,
          candidateCode: generateCanonicalCode(),
          title,
          fullDestinationUrl: destination.normalizedUrl,
          safeOrigin: destination.publicSummary.origin,
          destinationFingerprint,
          fingerprintAlgorithm: "HMAC-SHA-256",
          fingerprintKeyVersion,
          summaryPolicyVersion: "r1-origin-only-v1",
          canonicalBaseUrl,
        });
      } catch {
        await releaseReservation();
        return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
      }

      if (result.kind === "code_collision") continue;
      if (result.kind === "created") {
        headers.set("Idempotency-Replayed", "false");
        setRateHeaders(headers, rateLimit);
        return jsonResponse(201, result.response, headers);
      }
      await releaseReservation();
      return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
    }

    await releaseReservation();
    return errorResponse(500, "INTERNAL_ERROR", "The request could not be completed.", id, headers);
  };
}

export function deterministicLocalRateLimitGate() {
  return Object.freeze({
    async check() {
      return { decision: "allowed", limit: 100, remaining: 99, reset: 60 };
    },
  });
}

function normalizeTitle(value) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function responseHeaders(requestId, origin, allowedOrigins) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
    "X-Request-ID": requestId,
  });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function validationError(requestId, headers, field, issue) {
  return errorResponse(400, "VALIDATION_ERROR", "The request contains invalid fields.", requestId, headers, [
    { field, issue },
  ]);
}

function dependencyUnavailable(requestId, headers) {
  headers.set("Retry-After", "1");
  return errorResponse(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", requestId, headers);
}

function errorResponse(status, code, message, requestId, headers, details) {
  const error = { code, message, requestId };
  if (details) error.details = details;
  return jsonResponse(status, { error }, headers);
}

function jsonResponse(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function setRateHeaders(headers, rateLimit) {
  headers.set("RateLimit-Limit", String(rateLimit.limit));
  headers.set("RateLimit-Remaining", String(rateLimit.remaining));
  headers.set("RateLimit-Reset", String(rateLimit.reset));
}
