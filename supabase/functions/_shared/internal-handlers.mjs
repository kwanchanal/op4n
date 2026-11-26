// Internal service operations for the Workers:
//   POST /api/v1/internal/redirect-lookup          (resolveCanonicalRedirect)
//   POST /api/v1/internal/clicks                   (recordRedirectClick)
//   POST /api/v1/internal/notifications/claim      (claimFounderNotifications)
//   POST /api/v1/internal/notifications/complete   (completeFounderNotifications)
// Authorized only by the environment-scoped INTERNAL_SERVICE_CREDENTIAL.
// These are not browser endpoints: no CORS headers, no Vary: Origin.

const CODE_PATTERN = /^[A-Za-z0-9]{6,32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2048;

function headers(requestId) {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
  });
}

function json(status, body, requestId, extra = {}) {
  const responseHeaders = headers(requestId);
  for (const [name, value] of Object.entries(extra)) responseHeaders.set(name, value);
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function error(status, code, message, requestId, extra) {
  return json(status, { error: { code, message, requestId } }, requestId, extra);
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % a.length] ?? 0) ^ (b[index % b.length] ?? 0);
  }
  return difference === 0 && a.length > 0;
}

// Returns a Response when the request must be rejected, otherwise null.
function guard(request, credential, requestId) {
  if (request.method !== "POST") {
    return error(405, "VALIDATION_ERROR", "The request method is not supported.", requestId, { Allow: "POST" });
  }
  if (typeof credential !== "string" || credential.length < 32) {
    return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", requestId, { "Retry-After": "1" });
  }
  const authorization = request.headers.get("Authorization") || "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(presented, credential)) {
    return error(401, "UNAUTHORIZED", "The request is not authorized.", requestId);
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return error(415, "VALIDATION_ERROR", "The request content type is not supported.", requestId);
  }
  return null;
}

async function readJson(request, requestId) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { failure: error(413, "PAYLOAD_TOO_LARGE", "The request body is too large.", requestId) };
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { body };
  } catch {
    return { failure: error(400, "VALIDATION_ERROR", "The request contains invalid fields.", requestId) };
  }
}

function hasOnly(body, fields) {
  return Object.keys(body).every((key) => fields.includes(key));
}

export function createRedirectLookupHandler({ credential, persistence, requestId = () => crypto.randomUUID() }) {
  return async function handleRedirectLookup(request) {
    const id = requestId();
    const rejected = guard(request, credential, id);
    if (rejected) return rejected;
    const { body, failure } = await readJson(request, id);
    if (failure) return failure;
    if (!hasOnly(body, ["canonicalCode"]) || typeof body.canonicalCode !== "string" ||
        !CODE_PATTERN.test(body.canonicalCode)) {
      return error(400, "VALIDATION_ERROR", "The request contains invalid fields.", id);
    }

    let decision;
    try {
      decision = await persistence.resolveRedirect(body.canonicalCode);
    } catch {
      return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", id, { "Retry-After": "1" });
    }

    if (decision?.decision === "redirect") {
      const valid = decision.canonicalCode === body.canonicalCode &&
        /^https?:\/\//.test(String(decision.fullDestinationUrl)) &&
        decision.destinationVersion === 1 &&
        typeof decision.destinationFingerprint === "string";
      if (!valid) {
        return error(500, "INTERNAL_ERROR", "The request could not be completed.", id);
      }
      return json(200, {
        decision: "redirect",
        canonicalCode: decision.canonicalCode,
        fullDestinationUrl: decision.fullDestinationUrl,
        destinationVersion: 1,
        destinationFingerprint: decision.destinationFingerprint,
        cacheControl: "no-store",
        redirectStatus: 302,
      }, id);
    }
    if (decision?.decision === "disabled") {
      return json(200, { decision: "disabled", canonicalCode: body.canonicalCode }, id);
    }
    return json(200, { decision: "unknown", canonicalCode: body.canonicalCode }, id);
  };
}

export function createClickHandler({ credential, persistence, requestId = () => crypto.randomUUID() }) {
  return async function handleClick(request) {
    const id = requestId();
    const rejected = guard(request, credential, id);
    if (rejected) return rejected;
    const { body, failure } = await readJson(request, id);
    if (failure) return failure;

    const key = request.headers.get("Idempotency-Key") || "";
    const valid = hasOnly(body, ["eventId", "canonicalCode", "destinationVersion", "occurredAt"]) &&
      UUID_V4.test(String(body.eventId)) &&
      key.toLowerCase() === String(body.eventId).toLowerCase() &&
      typeof body.canonicalCode === "string" && CODE_PATTERN.test(body.canonicalCode) &&
      body.destinationVersion === 1 &&
      typeof body.occurredAt === "string" && Number.isFinite(Date.parse(body.occurredAt));
    if (!valid) {
      return error(400, "VALIDATION_ERROR", "The request contains invalid fields.", id);
    }

    let result;
    try {
      result = await persistence.recordClick({
        eventId: String(body.eventId).toLowerCase(),
        canonicalCode: body.canonicalCode,
        destinationVersion: 1,
        occurredAt: new Date(body.occurredAt).toISOString(),
      });
    } catch {
      return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", id, { "Retry-After": "1" });
    }

    if (result?.kind === "accepted" || result?.kind === "replayed") {
      return json(202, {
        accepted: true,
        eventId: String(body.eventId).toLowerCase(),
        recordedAt: new Date(result.recordedAt).toISOString(),
      }, id, { "Idempotency-Replayed": String(result.kind === "replayed") });
    }
    if (result?.kind === "conflict") {
      return error(409, "IDEMPOTENCY_CONFLICT", "The event identity was already used for a different click.", id);
    }
    return error(400, "VALIDATION_ERROR", "The request contains invalid fields.", id);
  };
}

const unavailable = (id) =>
  error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", id, { "Retry-After": "1" });

// Claims due founder notifications for this environment. The response holds
// only short codes, kinds, reason categories, counts, and times.
export function createNotificationClaimHandler({ credential, persistence, environment, requestId = () => crypto.randomUUID() }) {
  return async function handleClaim(request) {
    const id = requestId();
    const rejected = guard(request, credential, id);
    if (rejected) return rejected;
    const { body, failure } = await readJson(request, id);
    if (failure) return failure;
    if (!hasOnly(body, [])) return error(400, "VALIDATION_ERROR", "The request contains invalid fields.", id);
    let result;
    try {
      result = await persistence.claimNotifications({ environment, limit: 200, leaseSeconds: 120 });
    } catch {
      return unavailable(id);
    }
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    return json(200, {
      batchId: result?.batchId ?? null,
      events: Number(result?.events ?? 0),
      entries: entries.map((entry) => ({
        canonicalCode: entry.kind === "ops_alert" ? null : String(entry.canonicalCode),
        kind: ["safety_block", "ops_alert"].includes(entry.kind) ? entry.kind : "report",
        reasonCategory: entry.reasonCategory ?? null,
        alertCode: entry.kind === "ops_alert" ? String(entry.alertCode) : null,
        alertDetail: entry.kind === "ops_alert" ? String(entry.alertDetail ?? "").slice(0, 200) : null,
        priority: ["S1", "S2", "S3"].includes(entry.priority) ? entry.priority : "S3",
        count: Number(entry.count),
        firstAt: new Date(entry.firstAt).toISOString(),
        lastAt: new Date(entry.lastAt).toISOString(),
      })),
    }, id);
  };
}

export function createNotificationCompleteHandler({ credential, persistence, requestId = () => crypto.randomUUID() }) {
  return async function handleComplete(request) {
    const id = requestId();
    const rejected = guard(request, credential, id);
    if (rejected) return rejected;
    const { body, failure } = await readJson(request, id);
    if (failure) return failure;
    if (!hasOnly(body, ["batchId", "outcome"]) || !UUID_V4.test(String(body.batchId)) ||
        !["sent", "failed"].includes(body.outcome)) {
      return error(400, "VALIDATION_ERROR", "The request contains invalid fields.", id);
    }
    let result;
    try {
      result = await persistence.completeNotifications({ batchId: String(body.batchId).toLowerCase(), outcome: body.outcome });
    } catch {
      return unavailable(id);
    }
    return json(200, { updated: Number(result?.updated ?? 0), exhausted: Number(result?.exhausted ?? 0) }, id);
  };
}

// ── Health and synthetic monitoring (Order 81) ─────────────────────────
//   GET  /api/v1/internal/health/live       (getEnvironmentLiveness)
//   GET  /api/v1/internal/health/ready      (getEnvironmentReadiness)
//   POST /api/v1/internal/synthetic/ensure  (ensureSyntheticLink)
// Service credential only. Responses carry no project reference or secret.

export const SYNTHETIC_CODE = "SYNTHETIC1";

function authorize(request, credential, requestId, method) {
  if (request.method !== method) {
    return error(405, "VALIDATION_ERROR", "The request method is not supported.", requestId, { Allow: method });
  }
  if (typeof credential !== "string" || credential.length < 32) {
    return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", requestId, { "Retry-After": "1" });
  }
  const authorization = request.headers.get("Authorization") || "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(presented, credential)) {
    return error(401, "UNAUTHORIZED", "The request is not authorized.", requestId);
  }
  return null;
}

export function createHealthHandlers({
  credential,
  persistence,
  environment,
  releaseSha,
  configVersion,
  environmentReady,
  frontendOrigin,
  destinationHmacKey,
  hmac,
  requestId = () => crypto.randomUUID(),
}) {
  const identity = () => ({
    environment,
    releaseSha: /^[0-9a-f]{40}$/.test(releaseSha || "") ? releaseSha : "0".repeat(40),
    configVersion: configVersion || "unset",
  });

  return Object.freeze({
    // Answers without touching the database.
    async live(request) {
      const id = requestId();
      const denied = authorize(request, credential, id, "GET");
      if (denied) return denied;
      return json(200, { status: "live", ...identity() }, id);
    },

    async ready(request) {
      const id = requestId();
      const denied = authorize(request, credential, id, "GET");
      if (denied) return denied;
      const checks = [{ name: "router", status: "ready" }];
      const environmentOk = ["staging", "production"].includes(environment) &&
        /^[0-9a-f]{40}$/.test(releaseSha || "") && environmentReady === true;
      checks.push({ name: "environment", status: environmentOk ? "ready" : "not_ready" });
      let database = null;
      try {
        database = await persistence.healthReadiness();
      } catch {
        database = null;
      }
      checks.push({ name: "database", status: database?.database === true ? "ready" : "not_ready" });
      checks.push({ name: "schema", status: database?.schema === true ? "ready" : "not_ready" });
      let lookup = null;
      try {
        lookup = database ? await persistence.resolveRedirect(SYNTHETIC_CODE) : null;
      } catch {
        lookup = null;
      }
      checks.push({ name: "redirectLookup", status: lookup?.decision === "redirect" ? "ready" : "not_ready" });
      if (checks.every((check) => check.status === "ready")) {
        return json(200, { status: "ready", ...identity(), checks }, id);
      }
      return json(503, {
        error: { code: "DEPENDENCY_UNAVAILABLE", message: "The environment is not ready.", requestId: id },
        readiness: { status: "not_ready", checks },
      }, id, { "Retry-After": "30" });
    },

    // Idempotently creates this environment's synthetic link, which redirects
    // to the frontend so monitors exercise the whole redirect path.
    async ensureSynthetic(request) {
      const id = requestId();
      const denied = authorize(request, credential, id, "POST");
      if (denied) return denied;
      if (!/^https:\/\/[^/?#]+$/.test(frontendOrigin || "")) {
        return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", id, { "Retry-After": "1" });
      }
      const destination = `${frontendOrigin}/?monitor=synthetic`;
      try {
        const result = await persistence.ensureSyntheticLink({
          code: SYNTHETIC_CODE,
          destination,
          origin: frontendOrigin,
          fingerprint: await hmac(destinationHmacKey, destination),
        });
        return json(200, { canonicalCode: SYNTHETIC_CODE, created: result?.kind === "created" }, id);
      } catch {
        return error(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable.", id, { "Retry-After": "1" });
      }
    },
  });
}

// POST /api/v1/internal/ops/daily-check (runOpsDailyCheck): called once a day
// by the notifier Worker. Queues quota and stale-S1 alerts into the outbox.
export function createOpsDailyCheckHandler({ credential, persistence, environment, requestId = () => crypto.randomUUID() }) {
  return async function handleOpsDailyCheck(request) {
    const id = requestId();
    const denied = authorize(request, credential, id, "POST");
    if (denied) return denied;
    try {
      const summary = await persistence.opsDailyCheck({ environment });
      return json(200, {
        estimatedMonthlyInvocations: Number(summary?.estimatedMonthlyInvocations ?? 0),
        invocationPercent: Number(summary?.invocationPercent ?? 0),
        databasePercent: Number(summary?.databasePercent ?? 0),
        staleS1Cases: Number(summary?.staleS1Cases ?? 0),
        alertsQueued: Array.isArray(summary?.alertsQueued) ? summary.alertsQueued.map(String) : [],
      }, id);
    } catch {
      return unavailable(id);
    }
  };
}
