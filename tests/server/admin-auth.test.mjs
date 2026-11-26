import assert from "node:assert/strict";
import test from "node:test";
import {
  adminSessionHandler,
  createAdminGate,
  createJwksKeyStore,
  parseSubjectAllowlist,
} from "../../supabase/functions/_shared/admin-auth.mjs";
import { routeOperation } from "../../supabase/functions/_shared/router.mjs";

const ISSUER = "https://exampleprojectref00.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const FOUNDER = "4effd356-0000-4000-8000-000000000001";
const STRANGER = "4effd356-0000-4000-8000-000000000002";
const ORIGIN = "https://staging.op4n.com";
const NOW_MS = Date.UTC(2026, 10, 26, 10, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);

const encode = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kid, alg: "ES256", kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, use: "sig" } };
}

async function sign(key, claims, header = {}) {
  const head = encode({ alg: "ES256", typ: "JWT", kid: key.kid, ...header });
  const body = encode(claims);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(signature).toString("base64url")}`;
}

const baseClaims = (overrides = {}) => ({
  iss: ISSUER, aud: AUDIENCE, sub: FOUNDER, aal: "aal2", role: "authenticated",
  iat: NOW - 60, exp: NOW + 3600, ...overrides,
});

async function setup({ keys, jwksFails = false, configured = true } = {}) {
  const signing = keys ?? [await makeKey("kid-1")];
  const published = { keys: signing.map((key) => key.jwk) };
  const loads = { count: 0 };
  const logs = [];
  const keyStore = createJwksKeyStore({
    now: () => NOW_MS,
    loadJwks: async () => {
      loads.count += 1;
      if (jwksFails) throw new Error("jwks down");
      return published;
    },
  });
  const adminRoute = createAdminGate({
    issuer: configured ? ISSUER : undefined,
    audience: AUDIENCE,
    subjectAllowlist: configured ? FOUNDER : "",
    keyStore,
    allowedOrigins: [ORIGIN],
    log: (entry) => logs.push(entry),
    now: () => NOW_MS,
  });
  const session = adminRoute("getAdminSession", adminSessionHandler({ environment: "staging", now: () => NOW_MS }));
  const highRisk = adminRoute("disableLink", async () => ({ status: 200, body: { ok: true } }), { methods: ["POST"], requireRecentAuth: true });
  return { signing, published, loads, logs, session, highRisk };
}

const request = (token, { method = "GET", path = "/api/v1/admin/session" } = {}) =>
  new Request(`http://local/functions/v1/op4n-api${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

async function codeOf(response) {
  return (await response.json()).error?.code;
}

test("router maps the Admin session path", () => {
  assert.equal(routeOperation("/functions/v1/op4n-api/api/v1/admin/session"), "getAdminSession");
});

test("an allowlisted aal2 founder JWT is accepted", async () => {
  const { signing, session } = await setup();
  const response = await session(request(await sign(signing[0], baseClaims())));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const body = await response.json();
  assert.deepEqual(body, { admin: true, environment: "staging", assuranceLevel: "aal2", recentAuth: true, expiresAt: new Date((NOW + 3600) * 1000).toISOString() });
});

test("missing, malformed, forged, and mis-scoped tokens return 401", async () => {
  const { signing, session } = await setup();
  const other = await makeKey("kid-1");
  const cases = [
    [null, "no JWT"],
    ["not-a-jwt", "malformed"],
    [await sign(other, baseClaims()), "signed by a key outside the JWKS"],
    [await sign(signing[0], baseClaims(), { alg: "HS256" }), "wrong algorithm"],
    [await sign(signing[0], baseClaims({ iss: "https://otherproject00000.supabase.co/auth/v1" })), "other project issuer"],
    [await sign(signing[0], baseClaims({ aud: "anon" })), "wrong audience"],
    [await sign(signing[0], baseClaims({ exp: NOW - 120 })), "expired"],
    [await sign(signing[0], baseClaims({ nbf: NOW + 600 })), "not yet valid"],
  ];
  for (const [token, label] of cases) {
    const response = await session(request(token));
    assert.equal(response.status, 401, label);
    assert.equal(await codeOf(response), "UNAUTHORIZED", label);
  }
  const tampered = (await sign(signing[0], baseClaims({ sub: STRANGER }))).split(".");
  tampered[1] = encode(baseClaims());
  assert.equal((await session(request(tampered.join(".")))).status, 401, "payload swapped after signing");
});

test("a non-allowlisted subject or an aal1 session returns 403", async () => {
  const { signing, session } = await setup();
  let response = await session(request(await sign(signing[0], baseClaims({ sub: STRANGER }))));
  assert.equal(response.status, 403);
  assert.equal(await codeOf(response), "FORBIDDEN");
  response = await session(request(await sign(signing[0], baseClaims({ aal: "aal1" }))));
  assert.equal(response.status, 403);
  assert.equal(await codeOf(response), "MFA_REQUIRED");
});

test("high-risk actions reject a JWT issued more than 15 minutes ago", async () => {
  const { signing, highRisk } = await setup();
  const stale = await highRisk(request(await sign(signing[0], baseClaims({ iat: NOW - 16 * 60 })), { method: "POST" }));
  assert.equal(stale.status, 401);
  assert.equal(await codeOf(stale), "REAUTH_REQUIRED");
  const fresh = await highRisk(request(await sign(signing[0], baseClaims({ iat: NOW - 14 * 60 })), { method: "POST" }));
  assert.equal(fresh.status, 200);
  const wrongMethod = await highRisk(request(await sign(signing[0], baseClaims())));
  assert.equal(wrongMethod.status, 405);
});

test("missing configuration and JWKS failure fail closed", async () => {
  const unconfigured = await setup({ configured: false });
  let response = await unconfigured.session(request(await sign(unconfigured.signing[0], baseClaims())));
  assert.equal(response.status, 503);
  assert.equal(await codeOf(response), "FEATURE_UNAVAILABLE");
  const down = await setup({ jwksFails: true });
  response = await down.session(request(await sign(down.signing[0], baseClaims())));
  assert.equal(response.status, 503);
  assert.equal(await codeOf(response), "DEPENDENCY_UNAVAILABLE");
});

test("JWKS is cached and refetched once for a rotated key id", async () => {
  const first = await makeKey("kid-1");
  const { published, loads, session } = await setup({ keys: [first] });
  await session(request(await sign(first, baseClaims())));
  await session(request(await sign(first, baseClaims())));
  assert.equal(loads.count, 1, "second request uses the cache");
  const rotated = await makeKey("kid-2");
  published.keys = [...published.keys, rotated.jwk];
  assert.equal((await session(request(await sign(rotated, baseClaims())))).status, 200);
  assert.equal(loads.count, 2, "unknown kid triggers one refresh");
});

test("every Admin request is logged with request ID and logical actor, never the subject or token", async () => {
  const { signing, session, logs } = await setup();
  const token = await sign(signing[0], baseClaims());
  await session(request(token));
  await session(request(await sign(signing[0], baseClaims({ sub: STRANGER }))));
  await session(request(null));
  assert.equal(logs.length, 3);
  assert.ok(logs.every((entry) => /^[0-9a-f-]{36}$/.test(entry.requestId) && entry.operation === "getAdminSession"));
  assert.equal(logs[0].actor, "founder");
  assert.equal(logs[1].actor, null);
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(FOUNDER) && !text.includes(STRANGER) && !text.includes(token.split(".")[2]));
});

test("preflight allows only the environment origin and the Authorization header", async () => {
  const { session } = await setup();
  const allowed = await session(new Request("http://local/api/v1/admin/session", { method: "OPTIONS", headers: { Origin: ORIGIN } }));
  assert.equal(allowed.status, 204);
  assert.match(allowed.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  const denied = await session(new Request("http://local/api/v1/admin/session", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }));
  assert.equal(denied.status, 403);
});

test("the allowlist accepts only UUID subjects", () => {
  assert.deepEqual(parseSubjectAllowlist(` ${FOUNDER.toUpperCase()}, nope ,,`), [FOUNDER]);
  assert.deepEqual(parseSubjectAllowlist(undefined), []);
});
