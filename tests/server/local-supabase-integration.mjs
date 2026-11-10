import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evaluateCreateReadiness } from "../../supabase/functions/_shared/readiness.mjs";

const mode = process.argv[2] || "initial";
const evidencePath = new URL("../../.ci-artifacts/local-supabase-integration.json", import.meta.url);
const status = localStatus();
const apiUrl = status.env.API_URL;
const restUrl = status.env.REST_URL;
const functionsUrl = status.env.FUNCTIONS_URL || `${status.env.API_URL}/functions/v1`;
const secretKey = status.env.SECRET_KEY;
const publishableKey = status.env.PUBLISHABLE_KEY;
const anonKey = status.env.ANON_KEY;
const serviceHeaders = {
  apikey: secretKey,
  "Content-Type": "application/json",
};

if (mode === "verify-restart") {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const rows = await serviceRows("issued_codes", `canonical_code=eq.${evidence.persistenceCode}`);
  assert.equal(rows.length, 1, "local database row must survive stack restart");
  evidence.checks.persistenceAfterRestart = true;
  evidence.verifiedAfterRestartAtUtc = new Date().toISOString();
  await writeEvidence(evidence);
  console.log("local Supabase restart verification: PASS");
  process.exit(0);
}

assert.equal(status.runtime, "native");
const checks = {
  nativeRuntime: true,
  migrationApplied: false,
  sqlFunctionsExecuted: false,
  edgeFunctionExecuted: false,
  rlsRejectsAnon: false,
  rlsRejectsAuthenticated: false,
  transactionRollback: false,
  databaseIdempotencyConcurrency: false,
  staleLeaseTokenRejected: false,
  forcedCodeCollisionRetry: false,
  persistenceAfterRestart: false,
  publicProjectionProtected: false,
  productionReadinessFailClosed: false,
};

const productionReadiness = evaluateCreateReadiness({
  environment: "production",
  safetyAdapterKind: "missing",
  rateLimitAdapterKind: "missing",
  databaseConfigured: true,
  destinationHmacConfigured: true,
});
assert.equal(productionReadiness.ready, false);
assert.equal(productionReadiness.checks.safety, false);
assert.equal(productionReadiness.checks.rateLimit, false);
checks.productionReadinessFailClosed = true;

const tables = await serviceRows("issued_codes", "select=canonical_code&limit=1");
assert.ok(Array.isArray(tables));
checks.migrationApplied = true;

await assertRlsDenied(anonKey);
checks.rlsRejectsAnon = true;
const authenticatedToken = await createLocalAuthenticatedToken();
await assertRlsDenied(authenticatedToken);
checks.rlsRejectsAuthenticated = true;

const staleScope = await makeScope("stale");
const firstLease = await rpc("begin_creation_idempotency_v1", staleScope);
assert.equal(firstLease.kind, "reserved");
await patchRows("creation_idempotency", `key_hash=eq.${staleScope.p_key_hash}`, {
  lease_expires_at: "2000-01-01T00:00:00.000Z",
});
const currentLease = await rpc("begin_creation_idempotency_v1", staleScope);
assert.equal(currentLease.kind, "reserved");
assert.notEqual(firstLease.reservationToken, currentLease.reservationToken);
await rpc("release_creation_idempotency_v1", {
  ...staleScope,
  p_reservation_token: firstLease.reservationToken,
});
let reservationRows = await serviceRows(
  "creation_idempotency",
  `key_hash=eq.${staleScope.p_key_hash}&select=reservation_token,status`,
);
assert.equal(reservationRows.length, 1);
assert.equal(reservationRows[0].reservation_token, currentLease.reservationToken);
await assert.rejects(
  rpc("create_guest_link_v1", createParams(
    staleScope,
    firstLease.reservationToken,
    "STALETOK01",
  )),
  /local RPC failed/,
);
const currentCreated = await rpc("create_guest_link_v1", createParams(
  staleScope,
  currentLease.reservationToken,
  "CURRENT001",
));
assert.equal(currentCreated.kind, "created");
checks.sqlFunctionsExecuted = true;
checks.staleLeaseTokenRejected = true;

const rollbackScope = await makeScope("rollback");
const rollbackLease = await rpc("begin_creation_idempotency_v1", rollbackScope);
await assert.rejects(
  rpc("create_guest_link_v1", {
    ...createParams(rollbackScope, rollbackLease.reservationToken, "ROLLBACK01"),
    p_fingerprint_key_version: "",
  }),
  /local RPC failed/,
);
assert.equal((await serviceRows("issued_codes", "canonical_code=eq.ROLLBACK01")).length, 0);
assert.equal((await serviceRows("canonical_links", "title=eq.Rollback%20probe")).length, 0);
await rpc("release_creation_idempotency_v1", {
  ...rollbackScope,
  p_reservation_token: rollbackLease.reservationToken,
});
checks.transactionRollback = true;

const concurrentScope = await makeScope("concurrent");
const concurrentResults = await Promise.all([
  rpc("begin_creation_idempotency_v1", concurrentScope),
  rpc("begin_creation_idempotency_v1", concurrentScope),
]);
assert.deepEqual(
  concurrentResults.map((result) => result.kind).sort(),
  ["in_progress", "reserved"],
);
const concurrentLease = concurrentResults.find((result) => result.kind === "reserved");
const concurrentCreated = await rpc("create_guest_link_v1", createParams(
  concurrentScope,
  concurrentLease.reservationToken,
  "CONCUR0001",
));
assert.equal(concurrentCreated.kind, "created");
assert.equal((await serviceRows("issued_codes", "canonical_code=eq.CONCUR0001")).length, 1);
checks.databaseIdempotencyConcurrency = true;

if ((await serviceRows("issued_codes", "canonical_code=eq.COLLIDE001")).length === 0) {
  await insertRow("issued_codes", { canonical_code: "COLLIDE001" });
}
const publicResponse = await fetch(
  `${functionsUrl}/op4n-api/api/v1/links`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "http://127.0.0.1:5500",
    },
    body: JSON.stringify({
      title: "Public integration probe",
      destinationUrl: "https://example.com/private/path?token=protected#fragment",
    }),
  },
);
assert.equal(publicResponse.status, 201);
const publicBody = await publicResponse.json();
assert.equal(publicBody.canonicalCode, "SUCCESS001");
assert.deepEqual(Object.keys(publicBody).sort(), [
  "aggregateTotalClicks",
  "canonicalCode",
  "canonicalOpenUrl",
  "canonicalShortUrl",
  "displayTitle",
  "safeDestinationSummary",
].sort());
assert.equal(publicBody.safeDestinationSummary.origin, "https://example.com");
assert.doesNotMatch(
  JSON.stringify(publicBody),
  /private|token|protected|fragment|destinationFingerprint|fullDestination|linkId|reservation/i,
);
assert.equal((await serviceRows("issued_codes", "canonical_code=eq.SUCCESS001")).length, 1);
checks.edgeFunctionExecuted = true;
checks.forcedCodeCollisionRetry = true;
checks.publicProjectionProtected = true;

const persistenceScope = await makeScope("persistence");
const persistenceLease = await rpc("begin_creation_idempotency_v1", persistenceScope);
const persistenceCode = `P${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}`;
const persistenceCreated = await rpc("create_guest_link_v1", createParams(
  persistenceScope,
  persistenceLease.reservationToken,
  persistenceCode,
));
assert.equal(persistenceCreated.kind, "created");

await writeEvidence({
  generatedAtUtc: new Date().toISOString(),
  runtime: "native",
  cliVersion: "3.0.0",
  persistenceCode,
  checks,
});
console.log("local Supabase integration: PASS (restart verification pending)");

function localStatus() {
  const result = spawnSync(
    "npx",
    ["--yes", "supabase@3.0.0", "status", "--output-format", "json"],
    { cwd: new URL("../..", import.meta.url), encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("local Supabase status failed");
  return JSON.parse(result.stdout);
}

async function rpc(name, body) {
  const response = await fetch(`${restUrl}/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders,
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `local RPC failed: ${name} (${response.status}, ${responseBody?.code || "unknown"}, ${responseBody?.message || "no message"})`,
    );
  }
  return responseBody;
}

async function serviceRows(table, query) {
  const response = await fetch(`${restUrl}/${table}?${query}`, { headers: serviceHeaders });
  assert.equal(response.ok, true, `service query failed for ${table}`);
  return response.json();
}

async function insertRow(table, row) {
  const response = await fetch(`${restUrl}/${table}`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  assert.equal(response.ok, true, `service insert failed for ${table}`);
}

async function patchRows(table, query, values) {
  const response = await fetch(`${restUrl}/${table}?${query}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(values),
  });
  assert.equal(response.ok, true, `service patch failed for ${table}`);
}

async function assertRlsDenied(bearer) {
  const response = await fetch(`${restUrl}/canonical_links?select=id&limit=1`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${bearer}`,
    },
  });
  assert.equal(response.ok, false, "browser role must not read protected tables");
}

async function createLocalAuthenticatedToken() {
  const email = `integration-${crypto.randomUUID()}@example.test`;
  const password = `Test-only-${crypto.randomUUID()}`;
  const signup = await fetch(`${apiUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signup.ok, true, "local signup must succeed");
  const signupBody = await signup.json();
  if (signupBody.access_token) return signupBody.access_token;
  const signin = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signin.ok, true, "local sign-in must succeed");
  return (await signin.json()).access_token;
}

async function makeScope(label) {
  return {
    p_environment: "local",
    p_operation: "createGuestCanonicalLink",
    p_key_hash: await sha256(`${label}:${crypto.randomUUID()}`),
    p_payload_digest: await sha256(`${label}:payload`),
  };
}

function createParams(scope, reservationToken, code) {
  return {
    ...scope,
    p_reservation_token: reservationToken,
    p_candidate_code: code,
    p_title: code === "ROLLBACK01" ? "Rollback probe" : "Integration probe",
    p_full_destination_url: "https://example.com/private?token=protected#fragment",
    p_safe_origin: "https://example.com",
    p_destination_fingerprint: "c".repeat(64),
    p_fingerprint_algorithm: "HMAC-SHA-256",
    p_fingerprint_key_version: "test-only-v1",
    p_summary_policy_version: "r1-origin-only-v1",
    p_canonical_base_url: "https://staging.op4n.me",
  };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function writeEvidence(value) {
  await mkdir(new URL("../../.ci-artifacts/", import.meta.url), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}
