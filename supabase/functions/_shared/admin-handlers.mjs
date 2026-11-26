// Founder Admin operations (Feature Inventory Orders 57-60). Each handler runs
// behind createAdminGate (aal2 founder JWT) and receives {request, claims}.
// Handlers return {status, body, headers?}. The full destination is returned
// only by the audited reveal operation and is never logged.

import { hmacSha256Hex, sha256Hex } from "./crypto-values.mjs";

const CODE_PATTERN = /^[A-Za-z0-9]{6,32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4096;
export const DISABLE_REASONS = Object.freeze(["abuse_report", "safety_block", "policy_violation"]);
export const RESTORE_REASONS = Object.freeze(["operator_correction", "abuse_report"]);
const PAGE_SIZE = 50;

const fail = (status, code, message, details) => ({
  status,
  body: { error: { code, message, ...(details ? { details } : {}) } },
});
const invalid = (field, issue) => fail(400, "VALIDATION_ERROR", "The request contains invalid fields.", [{ field, issue }]);
const notFound = () => fail(404, "LINK_NOT_FOUND", "No link matches this request.");
const unavailable = () => ({ ...fail(503, "DEPENDENCY_UNAVAILABLE", "A required service is temporarily unavailable."), headers: { "Retry-After": "1" } });

export function adminPathParams(pathname) {
  const path = String(pathname);
  const link = path.match(/\/api\/v1\/admin\/links\/([^/]+)(?:\/(reveal|disable|restore|discovery))?$/);
  const kase = path.match(/\/api\/v1\/admin\/cases\/([^/]+)\/transition$/);
  return { code: link?.[1] ?? null, caseId: kase?.[1] ?? null };
}

async function readJson(request) {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return { failure: fail(415, "VALIDATION_ERROR", "The request content type is not supported.") };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { failure: fail(413, "PAYLOAD_TOO_LARGE", "The request body is too large.") };
  }
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return { body };
  } catch {
    return { failure: invalid("body", "must be a JSON object") };
  }
}

const hasOnly = (body, fields) => Object.keys(body).every((key) => fields.includes(key));

// Parses founder search input into an exact code or an exact destination.
export function classifyLookupQuery(query, shortHosts) {
  const text = String(query ?? "").trim();
  if (!text || text.length > 2048) return { kind: "invalid" };
  if (CODE_PATTERN.test(text)) return { kind: "code", code: text };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { kind: "invalid" };
  }
  if (shortHosts.includes(url.hostname.toLowerCase())) {
    const code = url.pathname.replace(/^\/+|\/+$/g, "");
    return CODE_PATTERN.test(code) && !url.search && !url.hash ? { kind: "code", code } : { kind: "invalid" };
  }
  return /^https?:\/\//i.test(text) ? { kind: "destination", url: text } : { kind: "invalid" };
}

export function createAdminHandlers({ persistence, destinationPolicy, destinationHmacKey, shortHosts, environment }) {
  const actorOf = (claims) => `founder:${String(claims.sub).toLowerCase()}`;
  const codeFrom = (request) => {
    const { code } = adminPathParams(new URL(request.url).pathname);
    return code && CODE_PATTERN.test(code) ? code : null;
  };

  async function call(operation) {
    try {
      return { value: await operation() };
    } catch {
      return { failure: unavailable() };
    }
  }

  return {
    // POST /api/v1/admin/link-lookup {query}
    async findLink({ request }) {
      const { body, failure } = await readJson(request);
      if (failure) return failure;
      if (!hasOnly(body, ["query"]) || typeof body.query !== "string") return invalid("query", "must be a string");
      const parsed = classifyLookupQuery(body.query, shortHosts);
      if (parsed.kind === "invalid") return invalid("query", "must be a code, a short URL, or a full destination URL");
      let fingerprint = null;
      if (parsed.kind === "destination") {
        const destination = destinationPolicy.parse(parsed.url);
        if (!destination.valid) return { status: 200, body: { found: false } };
        if (!(destinationHmacKey instanceof Uint8Array) || destinationHmacKey.length < 16) return unavailable();
        fingerprint = await hmacSha256Hex(destinationHmacKey, destination.normalizedUrl);
      }
      const found = await call(() => persistence.adminFindLink({ code: parsed.kind === "code" ? parsed.code : null, fingerprint }));
      if (found.failure) return found.failure;
      return { status: 200, body: found.value ? { found: true, canonicalCode: found.value } : { found: false } };
    },

    // GET /api/v1/admin/links/{code}
    async getRecord({ request }) {
      const code = codeFrom(request);
      if (!code) return notFound();
      const record = await call(() => persistence.adminLinkRecord(code));
      if (record.failure) return record.failure;
      return record.value ? { status: 200, body: record.value } : notFound();
    },

    // POST /api/v1/admin/links/{code}/reveal (audited)
    async revealDestination({ request, claims }) {
      const code = codeFrom(request);
      if (!code) return notFound();
      const result = await call(() => persistence.adminRevealDestination({ code, actor: actorOf(claims) }));
      if (result.failure) return result.failure;
      if (result.value?.kind !== "revealed") return notFound();
      return { status: 200, body: { canonicalCode: code, fullDestinationUrl: result.value.fullDestinationUrl, auditRecorded: true } };
    },

    // GET /api/v1/admin/cases?page=N
    async listCases({ request }) {
      const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
      if (!Number.isInteger(page) || page < 1 || page > 1000) return invalid("page", "must be a positive integer");
      const result = await call(() => persistence.adminListCases({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }));
      if (result.failure) return result.failure;
      return { status: 200, body: { page, pageSize: PAGE_SIZE, total: Number(result.value?.total ?? 0), items: result.value?.items ?? [] } };
    },

    // POST /api/v1/admin/cases/{caseId}/transition {action, note}
    async transitionCase({ request, claims }) {
      const { caseId } = adminPathParams(new URL(request.url).pathname);
      if (!caseId || !UUID_PATTERN.test(caseId)) return fail(404, "LINK_NOT_FOUND", "No open case matches this request.");
      const { body, failure } = await readJson(request);
      if (failure) return failure;
      if (!hasOnly(body, ["action", "note"]) || !["triage", "resolve"].includes(body.action)) return invalid("action", "must be triage or resolve");
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note || note.length > 1000) return invalid("note", "is required and must not exceed 1000 characters");
      const result = await call(() => persistence.adminTransitionCase({ caseId: caseId.toLowerCase(), action: body.action, actor: actorOf(claims), note }));
      if (result.failure) return result.failure;
      if (result.value?.kind !== "ok") return fail(404, "LINK_NOT_FOUND", "No open case matches this request.");
      return { status: 200, body: { caseId: caseId.toLowerCase(), caseState: result.value.caseState, auditRecorded: true } };
    },

    // POST /api/v1/admin/links/{code}/discovery {decision, note}
    // Overrides the Order 61 screening result (eligible | withheld) or returns
    // the link to its recorded policy result (policy). Audited.
    async setDiscovery({ request, claims }) {
      const code = codeFrom(request);
      if (!code) return notFound();
      const { body, failure } = await readJson(request);
      if (failure) return failure;
      if (!hasOnly(body, ["decision", "note"]) || !["eligible", "withheld", "policy"].includes(body.decision)) {
        return invalid("decision", "must be eligible, withheld, or policy");
      }
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note || note.length > 900) return invalid("note", "is required and must not exceed 900 characters");
      const result = await call(() => persistence.adminSetDiscovery({ code, decision: body.decision, actor: actorOf(claims), detail: note }));
      if (result.failure) return result.failure;
      const kind = result.value?.kind;
      if (kind !== "changed" && kind !== "unchanged") return notFound();
      return {
        status: 200,
        body: { canonicalCode: code, discoveryOverride: result.value.discoveryOverride ?? null, changed: kind === "changed", auditRecorded: kind === "changed" },
      };
    },

    // POST /api/v1/admin/links/{code}/disable | /restore {reasonCode, reasonDetail?}
    moderate(action) {
      const allowed = action === "disable" ? DISABLE_REASONS : RESTORE_REASONS;
      return async ({ request, claims }) => {
        const code = codeFrom(request);
        if (!code) return notFound();
        const key = request.headers.get("Idempotency-Key") || "";
        if (!UUID_V4.test(key)) return invalid("Idempotency-Key", "must be a canonical UUID v4");
        const { body, failure } = await readJson(request);
        if (failure) return failure;
        if (!hasOnly(body, ["reasonCode", "reasonDetail"])) return invalid("body", "contains an unknown field");
        if (!allowed.includes(body.reasonCode)) return invalid("reasonCode", `must be one of ${allowed.join(", ")}`);
        if (body.reasonDetail !== undefined && body.reasonDetail !== null &&
            (typeof body.reasonDetail !== "string" || body.reasonDetail.length > 1000)) {
          return invalid("reasonDetail", "must be a string of at most 1000 characters");
        }
        const detail = typeof body.reasonDetail === "string" ? body.reasonDetail.trim() || null : null;
        const result = await call(async () => persistence.adminModerateLink({
          code,
          action,
          actor: actorOf(claims),
          reasonCode: body.reasonCode,
          reasonDetail: detail,
          keyHash: await sha256Hex(`${environment}:admin:${key.toLowerCase()}`),
          payloadDigest: await sha256Hex(JSON.stringify({ action, code, reasonCode: body.reasonCode, detail })),
        }));
        if (result.failure) return result.failure;
        const kind = result.value?.kind;
        if (kind === "changed" || kind === "unchanged" || kind === "replayed") {
          return {
            status: 200,
            headers: { "Idempotency-Replayed": String(kind === "replayed") },
            body: { canonicalCode: code, lifecycleState: result.value.lifecycleState, changed: kind !== "unchanged", auditRecorded: kind !== "unchanged" },
          };
        }
        if (kind === "safety_conflict") {
          return fail(409, "SAFETY_HOLD", `This link cannot be restored while its safety state is ${result.value.safetyState}.`);
        }
        if (kind === "conflict") return fail(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request.");
        return notFound();
      };
    },
  };
}
