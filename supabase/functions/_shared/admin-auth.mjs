// Admin authentication for /api/v1/admin/* (Feature Inventory: "Require MFA
// and least privilege for Admin access").
//
// A request is an Admin request only when its bearer token is a Supabase Auth
// user JWT that:
//   - is signed by a key from this environment's JWKS (ES256),
//   - has the configured issuer and audience, and is within exp/nbf,
//   - names a subject in FOUNDER_SUBJECT_ALLOWLIST, and
//   - carries aal2 (TOTP verified in this session).
// High-risk actions additionally require iat within the last 15 minutes.
// Configuration that is missing fails closed (503); nothing here trusts a
// short code, a cookie, or a client-supplied header other than Authorization.

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 60;
export const RECENT_AUTH_SECONDS = 15 * 60;

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJson(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

export function parseSubjectAllowlist(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item));
}

// Caches the JWKS and refetches once when a token names an unknown key id,
// which covers Supabase signing-key rotation.
export function createJwksKeyStore({ loadJwks, now = () => Date.now() }) {
  let cache = null;
  let loadedAt = 0;
  async function refresh() {
    const jwks = await loadJwks();
    if (!jwks || !Array.isArray(jwks.keys)) throw new Error("JWKS is malformed.");
    cache = jwks.keys;
    loadedAt = now();
  }
  return {
    async keyFor(kid) {
      if (!cache || now() - loadedAt > JWKS_TTL_MS) await refresh();
      let jwk = cache.find((key) => key.kid === kid);
      if (!jwk) {
        await refresh();
        jwk = cache.find((key) => key.kid === kid);
      }
      return jwk || null;
    },
  };
}

async function verifySignature(jwk, signingInput, signature) {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
}

// Returns {ok: true, claims} or {ok: false, status, code}.
export async function verifyAdminToken(token, { keyStore, issuer, audience, allowlist, nowSeconds, requireRecentAuth = false }) {
  const deny = (status, code) => ({ ok: false, status, code });
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return deny(401, "UNAUTHORIZED");
  let header;
  let claims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson(parts[1]);
  } catch {
    return deny(401, "UNAUTHORIZED");
  }
  if (header.alg !== "ES256" || typeof header.kid !== "string") return deny(401, "UNAUTHORIZED");
  const jwk = await keyStore.keyFor(header.kid);
  if (!jwk) return deny(401, "UNAUTHORIZED");
  let valid = false;
  try {
    valid = await verifySignature(jwk, `${parts[0]}.${parts[1]}`, base64UrlToBytes(parts[2]));
  } catch {
    valid = false;
  }
  if (!valid) return deny(401, "UNAUTHORIZED");

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer || !audiences.includes(audience)) return deny(401, "UNAUTHORIZED");
  if (!Number.isFinite(claims.exp) || claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) return deny(401, "UNAUTHORIZED");
  if (Number.isFinite(claims.nbf) && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) return deny(401, "UNAUTHORIZED");

  if (!allowlist.includes(String(claims.sub || "").toLowerCase())) return deny(403, "FORBIDDEN");
  if (claims.aal !== "aal2") return deny(403, "MFA_REQUIRED");
  if (requireRecentAuth && !(Number.isFinite(claims.iat) && nowSeconds - claims.iat <= RECENT_AUTH_SECONDS)) {
    return deny(401, "REAUTH_REQUIRED");
  }
  return { ok: true, claims };
}

const MESSAGES = {
  UNAUTHORIZED: "Sign in to continue.",
  FORBIDDEN: "This account is not permitted to use Admin.",
  MFA_REQUIRED: "Verify your authenticator code to continue.",
  REAUTH_REQUIRED: "Sign in again to confirm this action.",
  FEATURE_UNAVAILABLE: "Admin is not available in this environment.",
};

// Wraps Admin operation handlers. Each operation receives
// ({request, claims, requestId}) and returns {status, body}.
export function createAdminGate({
  issuer,
  audience,
  subjectAllowlist,
  keyStore,
  allowedOrigins,
  log = (entry) => console.info(JSON.stringify(entry)),
  now = () => Date.now(),
  requestId = () => crypto.randomUUID(),
}) {
  const allowlist = parseSubjectAllowlist(subjectAllowlist);
  const configured = Boolean(issuer && audience && allowlist.length && keyStore);

  return function adminRoute(operation, handler, { methods = ["GET"], requireRecentAuth = false } = {}) {
    return async function handleAdmin(request) {
      const id = requestId();
      const origin = request.headers.get("Origin");
      const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "Vary": "Origin",
        "X-Request-ID": id,
        "X-Robots-Tag": "noindex",
      });
      if (origin && allowedOrigins.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Expose-Headers", "X-Request-ID, Idempotency-Replayed, Retry-After");
      }
      const respond = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
      const fail = (status, code) => {
        log({ event: "admin_request", operation, requestId: id, actor: null, status, code });
        return respond(status, { error: { code, message: MESSAGES[code] ?? "The request could not be completed.", requestId: id } });
      };

      if (request.method === "OPTIONS") {
        if (!origin || !allowedOrigins.includes(origin)) return fail(403, "FORBIDDEN");
        headers.set("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
        headers.set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, Idempotency-Key");
        headers.set("Access-Control-Max-Age", "600");
        return respond(204, null);
      }
      if (!methods.includes(request.method)) {
        log({ event: "admin_request", operation, requestId: id, actor: null, status: 405 });
        return respond(405, { error: { code: "VALIDATION_ERROR", message: "The request method is not supported.", requestId: id } });
      }
      if (!configured) {
        headers.set("Retry-After", "60");
        return fail(503, "FEATURE_UNAVAILABLE");
      }

      const authorization = request.headers.get("Authorization") || "";
      const match = authorization.match(/^Bearer\s+(\S+)$/i);
      if (!match) return fail(401, "UNAUTHORIZED");
      let verdict;
      try {
        verdict = await verifyAdminToken(match[1], {
          keyStore,
          issuer,
          audience,
          allowlist,
          nowSeconds: Math.floor(now() / 1000),
          requireRecentAuth,
        });
      } catch {
        headers.set("Retry-After", "1");
        log({ event: "admin_request", operation, requestId: id, actor: null, status: 503, code: "DEPENDENCY_UNAVAILABLE" });
        return respond(503, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "A required service is temporarily unavailable.", requestId: id } });
      }
      if (!verdict.ok) return fail(verdict.status, verdict.code);

      // The actor is a logical label; the subject identifier is protected
      // configuration and is never logged.
      const result = await handler({ request, claims: verdict.claims, requestId: id });
      for (const [name, value] of Object.entries(result.headers ?? {})) headers.set(name, value);
      const body = result.body?.error ? { error: { ...result.body.error, requestId: id } } : result.body;
      log({ event: "admin_request", operation, requestId: id, actor: "founder", status: result.status, code: result.body?.error?.code });
      return respond(result.status, body);
    };
  };
}

// GET /api/v1/admin/session: confirms an authorized aal2 Admin session.
export function adminSessionHandler({ environment, now = () => Date.now() }) {
  return async ({ claims }) => ({
    status: 200,
    body: {
      admin: true,
      environment,
      assuranceLevel: claims.aal,
      recentAuth: Math.floor(now() / 1000) - claims.iat <= RECENT_AUTH_SECONDS,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    },
  });
}
