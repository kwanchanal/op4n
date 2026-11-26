// Post-deploy Staging smoke: proves the deployed API creates a link for the
// Staging origin and refuses the Production origin. Prints no secrets, no
// project reference, and no destination.

import { randomUUID } from "node:crypto";

const STAGING_ORIGIN = "https://staging.op4n.com";
const SHORT_HOST_ORIGIN = "https://staging.op4n.me";
const SMOKE_DESTINATION = "https://example.com/op4n-staging-smoke";
const PRODUCTION_ORIGIN = "https://op4n.com";
const BURST_ATTEMPTS = 11;
const CARD_FIELDS = [
  "aggregateTotalClicks",
  "canonicalCode",
  "canonicalOpenUrl",
  "canonicalShortUrl",
  "displayTitle",
  "safeDestinationSummary",
];

export function checkCreateResponse(status, headers, body) {
  const failures = [];
  if (status !== 201) failures.push(`create returned ${status}, expected 201`);
  if (headers.get("access-control-allow-origin") !== STAGING_ORIGIN) {
    failures.push("create did not allow the Staging origin");
  }
  if (headers.get("cache-control") !== "no-store") failures.push("create is not no-store");
  const card = body?.link ?? body;
  const keys = Object.keys(card ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(CARD_FIELDS)) {
    failures.push("create response is not exactly the PublicLinkCard fields");
  }
  if (!String(card?.canonicalShortUrl ?? "").startsWith("https://staging.op4n.me/")) {
    failures.push("short URL is not on staging.op4n.me");
  }
  return failures;
}

export function checkForeignPreflight(status, headers) {
  const failures = [];
  if (headers.get("access-control-allow-origin")) {
    failures.push("Production origin received an Access-Control-Allow-Origin header");
  }
  if (status === 204) failures.push("Production origin preflight was accepted");
  return failures;
}

export function checkRedirect(status, headers, expectedLocation) {
  const failures = [];
  if (status !== 302) failures.push(`redirect returned ${status}, expected 302`);
  if (headers.get("location") !== expectedLocation) failures.push("redirect Location is not the stored destination");
  if (headers.get("cache-control") !== "no-store") failures.push("redirect is not no-store");
  return failures;
}

export function checkNoRedirect(status, headers, expectedStatus) {
  const failures = [];
  if (status !== expectedStatus) failures.push(`expected ${expectedStatus}, got ${status}`);
  if (headers.get("location")) failures.push("non-redirect response carried a Location header");
  if (headers.get("cache-control") !== "no-store") failures.push("non-redirect response is not no-store");
  return failures;
}

export function checkReportReceipt(status, body) {
  if (status !== 202) return [`report returned ${status}, expected 202`];
  const keys = Object.keys(body ?? {}).sort().join(",");
  if (keys !== "accepted,receiptId" || body.accepted !== true) return ["report receipt is not exactly {accepted, receiptId}"];
  return [];
}

export function checkPlatformRejectsSpoof(status, headers) {
  if (status === 403 && !headers.get("x-request-id")) return [];
  return [`a client-supplied CF-Connecting-IP reached the function (status ${status})`];
}

export function checkRateLimited(response) {
  if (!response) return [`${BURST_ATTEMPTS} rapid creates with spoofed client headers were never rate-limited`];
  const failures = [];
  if (!(Number(response.headers.get("retry-after")) >= 1)) failures.push("429 has no Retry-After");
  if (response.headers.get("ratelimit-remaining") !== "0") failures.push("429 RateLimit-Remaining is not 0");
  return failures;
}

// A burst that was never limited is only a failure when every request left
// from the same public address. Hosted runners can rotate their outbound
// address per connection (observed 2026-11-23), which makes each request a
// fresh client; that outcome is inconclusive, not a pass.
export function checkBurstOutcome(response, distinctEgressCount) {
  if (response) return { failures: checkRateLimited(response), inconclusive: false };
  if (distinctEgressCount > 1) return { failures: [], inconclusive: true };
  return { failures: checkRateLimited(null), inconclusive: false };
}

async function egressAddress(apiOrigin) {
  const response = await fetch(`${apiOrigin}/cdn-cgi/trace`, { cache: "no-store" });
  const text = await response.text();
  return text.match(/^ip=(.+)$/m)?.[1]?.trim() ?? "unknown";
}

export function checkAdminDenied(status, body) {
  if (status === 401 && body?.error?.code === "UNAUTHORIZED") return [];
  return [`Admin session without a valid JWT returned ${status} ${body?.error?.code ?? ""}`.trim()];
}

export function checkSignupDisabled(status, body) {
  if (status >= 400 && status < 500 && /signup_disabled/i.test(String(body?.error_code ?? body?.code ?? ""))) return [];
  return [`public sign-up is not disabled (status ${status})`];
}

export function publishableKeyFrom(text) {
  return String(text).match(/publishableKey:\s*"([^"]+)"/)?.[1] ?? null;
}

export function checkRuntimeConfig(text, ref) {
  return /adapter:\s*"http"/.test(text) &&
    text.includes(`https://${ref}.supabase.co/functions/v1/op4n-api`) &&
    /shortLinkHost:\s*"staging\.op4n\.me"/.test(text) &&
    /environment:\s*"staging"/.test(text);
}

function selfTest() {
  const good = new Headers({ "access-control-allow-origin": STAGING_ORIGIN, "cache-control": "no-store" });
  const card = {
    aggregateTotalClicks: 0,
    canonicalCode: "ABCDEFGH",
    canonicalOpenUrl: "https://staging.op4n.me/ABCDEFGH",
    canonicalShortUrl: "https://staging.op4n.me/ABCDEFGH",
    displayTitle: "Staging smoke",
    safeDestinationSummary: { origin: "https://example.com", displayValue: "https://example.com" },
  };
  const cases = [
    [checkCreateResponse(201, good, card).length === 0, true],
    [checkCreateResponse(201, good, { link: card }).length === 0, true],
    [checkCreateResponse(503, good, card).length === 0, false],
    [checkCreateResponse(201, new Headers({ "cache-control": "no-store" }), card).length === 0, false],
    [checkCreateResponse(201, good, { ...card, fullDestinationUrl: "x" }).length === 0, false],
    [checkCreateResponse(201, good, { ...card, canonicalShortUrl: "https://op4n.me/ABCDEFGH" }).length === 0, false],
    [checkForeignPreflight(403, new Headers()).length === 0, true],
    [checkForeignPreflight(204, new Headers({ "access-control-allow-origin": PRODUCTION_ORIGIN })).length === 0, false],
    [checkRuntimeConfig('environment: "staging", adapter: "http", apiBaseUrl: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/op4n-api", shortLinkHost: "staging.op4n.me"', "abcdefghijklmnopqrst"), true],
    [checkRedirect(302, new Headers({ location: SMOKE_DESTINATION, "cache-control": "no-store" }), SMOKE_DESTINATION).length === 0, true],
    [checkRedirect(301, new Headers({ location: SMOKE_DESTINATION, "cache-control": "no-store" }), SMOKE_DESTINATION).length === 0, false],
    [checkRedirect(302, new Headers({ location: "https://evil.example", "cache-control": "no-store" }), SMOKE_DESTINATION).length === 0, false],
    [checkNoRedirect(404, new Headers({ "cache-control": "no-store" }), 404).length === 0, true],
    [checkRateLimited(null).length === 0, false],
    [checkPlatformRejectsSpoof(403, new Headers()).length === 0, true],
    [checkReportReceipt(202, { accepted: true, receiptId: "x" }).length === 0, true],
    [checkReportReceipt(202, { accepted: true, receiptId: "x", workflowState: "new" }).length === 0, false],
    [checkReportReceipt(404, null).length === 0, false],
    [checkPlatformRejectsSpoof(204, new Headers({ "x-request-id": "abc" })).length === 0, false],
    [checkRateLimited({ headers: new Headers({ "retry-after": "42", "ratelimit-remaining": "0" }) }).length === 0, true],
    [checkRateLimited({ headers: new Headers({ "ratelimit-remaining": "0" }) }).length === 0, false],
    [checkAdminDenied(401, { error: { code: "UNAUTHORIZED" } }).length === 0, true],
    [checkAdminDenied(200, { admin: true }).length === 0, false],
    [checkAdminDenied(503, { error: { code: "FEATURE_UNAVAILABLE" } }).length === 0, false],
    [checkSignupDisabled(422, { error_code: "signup_disabled" }).length === 0, true],
    [checkSignupDisabled(200, { id: "x" }).length === 0, false],
    [checkSignupDisabled(400, { error_code: "email_address_invalid" }).length === 0, false],
    [publishableKeyFrom('publishableKey: "sb_publishable_x",'), "sb_publishable_x"],
    [checkBurstOutcome(null, 1).failures.length === 0, false],
    [checkBurstOutcome(null, 3).inconclusive, true],
    [checkBurstOutcome(null, 3).failures.length === 0, true],
    [checkBurstOutcome({ headers: new Headers({ "retry-after": "5", "ratelimit-remaining": "0" }) }, 3).inconclusive, false],
    [checkNoRedirect(404, new Headers({ location: "https://x", "cache-control": "no-store" }), 404).length === 0, false],
    [checkRuntimeConfig('environment: "local", adapter: "mock", apiBaseUrl: "", shortLinkHost: "op4n.me"', "abcdefghijklmnopqrst"), false],
    [checkRuntimeConfig('environment: "staging", adapter: "http", apiBaseUrl: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1/op4n-api", shortLinkHost: "staging.op4n.me"', "abcdefghijklmnopqrst"), false],
  ];
  cases.forEach(([actual, expected], index) => {
    if (actual !== expected) throw new Error(`staging smoke self-test ${index + 1} failed`);
  });
  console.log(`PASS staging smoke self-tests: ${cases.length} cases`);
}

async function run() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const releaseSha = process.env.RELEASE_SHA ?? "";
  if (!/^[a-z0-9]{20}$/.test(ref ?? "")) throw new Error("SUPABASE_PROJECT_REF is required");
  const endpoint = `https://${ref}.supabase.co/functions/v1/op4n-api/api/v1/links`;
  const failures = [];

  const created = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
      Origin: STAGING_ORIGIN,
    },
    body: JSON.stringify({
      destinationUrl: SMOKE_DESTINATION,
      title: `Staging deploy smoke ${releaseSha.slice(0, 7)}`.trim(),
    }),
  });
  const body = await created.json().catch(() => null);
  failures.push(...checkCreateResponse(created.status, created.headers, body));

  const foreign = await fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,idempotency-key",
    },
  });
  failures.push(...checkForeignPreflight(foreign.status, foreign.headers));

  // Reports: an eligible link accepts a report with an opaque receipt; an
  // unknown code is 404. Reports never change the redirect.
  if (typeof body?.canonicalCode === "string") {
    const reported = await fetch(`${endpoint}/${body.canonicalCode}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), Origin: STAGING_ORIGIN },
      body: JSON.stringify({ reasonCategory: "other", detail: "Staging deploy smoke report" }),
    });
    failures.push(...checkReportReceipt(reported.status, await reported.json().catch(() => null)));
  }
  const unknownReport = await fetch(`${endpoint}/ZZZZZZZZZZ/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID(), Origin: STAGING_ORIGIN },
    body: JSON.stringify({ reasonCategory: "spam" }),
  });
  await unknownReport.body?.cancel();
  if (unknownReport.status !== 404) failures.push(`report for an unknown code returned ${unknownReport.status}`);

  // The Worker on staging.op4n.me must redirect the new code and refuse others.
  const code = body?.canonicalCode;
  if (typeof code === "string") {
    const redirect = await fetch(`${SHORT_HOST_ORIGIN}/${code}`, { redirect: "manual" });
    failures.push(...checkRedirect(redirect.status, redirect.headers, SMOKE_DESTINATION));
    const head = await fetch(`${SHORT_HOST_ORIGIN}/${code}`, { method: "HEAD", redirect: "manual" });
    failures.push(...checkRedirect(head.status, head.headers, SMOKE_DESTINATION).map((item) => `HEAD ${item}`));
  }
  const unknown = await fetch(`${SHORT_HOST_ORIGIN}/ZZZZZZZZZZ`, { redirect: "manual" });
  failures.push(...checkNoRedirect(unknown.status, unknown.headers, 404).map((item) => `unknown code: ${item}`));
  const malformed = await fetch(`${SHORT_HOST_ORIGIN}/not/a/code`, { redirect: "manual" });
  failures.push(...checkNoRedirect(malformed.status, malformed.headers, 404).map((item) => `malformed path: ${item}`));
  const post = await fetch(`${SHORT_HOST_ORIGIN}/ZZZZZZZZZZ`, { method: "POST", redirect: "manual" });
  failures.push(...checkNoRedirect(post.status, post.headers, 405).map((item) => `POST: ${item}`));

  // The platform edge (Cloudflare in front of Supabase) rejects a
  // client-supplied CF-Connecting-IP before our function runs, so that header
  // cannot be spoofed. Observed on Staging 2026-11-23: 403 with no X-Request-ID.
  const spoofedCf = await fetch(endpoint, {
    method: "OPTIONS",
    headers: { Origin: STAGING_ORIGIN, "Access-Control-Request-Method": "POST", "CF-Connecting-IP": "203.0.113.250" },
  });
  await spoofedCf.body?.cancel();
  failures.push(...checkPlatformRejectsSpoof(spoofedCf.status, spoofedCf.headers));

  // Rate limit: the real Postgres limiter allows 5 creates per minute per
  // client. Spoofed forwarding headers must not create fresh identities, so a
  // burst from this runner is limited no matter what the headers claim.
  let limitedResponse = null;
  const apiOrigin = new URL(endpoint).origin;
  const egress = new Set();
  // The limiter uses fixed 60 s windows, so a burst can straddle a window
  // boundary. 11 requests (2 x limit + 1) guarantee that one window sees at
  // least 6 even when the burst is split across two windows.
  for (let attempt = 0; attempt < BURST_ATTEMPTS && !limitedResponse; attempt += 1) {
    egress.add(await egressAddress(apiOrigin));
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
        Origin: STAGING_ORIGIN,
        "X-Forwarded-For": `203.0.113.${attempt + 10}`,
        "X-Real-IP": `203.0.113.${attempt + 10}`,
      },
      body: JSON.stringify({ destinationUrl: `${SMOKE_DESTINATION}/burst-${attempt}`, title: "Rate-limit smoke" }),
    });
    await response.body?.cancel();
    if (response.status === 429) limitedResponse = response;
    else if (response.status !== 201) failures.push(`burst request returned ${response.status}`);
  }
  // Addresses stay in memory; only their count is printed.
  const burst = checkBurstOutcome(limitedResponse, egress.size);
  failures.push(...burst.failures);
  if (burst.inconclusive) {
    console.log(`::warning::Rate-limit burst inconclusive: this runner used ${egress.size} outbound addresses, so each request was a new client. Verify the limiter from a fixed address.`);
  }

  // The deployed frontend must select the http adapter and point at this
  // project's API. Pages can take a few seconds to serve a new deployment.
  let configOk = false;
  let configText = "";
  for (let attempt = 0; attempt < 10 && !configOk; attempt += 1) {
    const response = await fetch(`${STAGING_ORIGIN}/config/runtime-config.js`, { cache: "no-store" })
      .catch(() => null);
    configText = response?.ok ? await response.text() : "";
    configOk = checkRuntimeConfig(configText, ref);
    if (!configOk) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!configOk) failures.push("Staging frontend runtime config does not select the http adapter for this project");

  // Admin: no JWT is rejected by the deployed gate (proves it is configured,
  // not 503), and Supabase Auth refuses public sign-up.
  const adminEndpoint = `https://${ref}.supabase.co/functions/v1/op4n-api/api/v1/admin/session`;
  const anonymousAdmin = await fetch(adminEndpoint, { headers: { Origin: STAGING_ORIGIN } });
  failures.push(...checkAdminDenied(anonymousAdmin.status, await anonymousAdmin.json().catch(() => null)));
  const publishableKey = publishableKeyFrom(configText);
  if (!publishableKey) {
    failures.push("Staging runtime config has no publishable key for Admin sign-in");
  } else {
    const signup = await fetch(`https://${ref}.supabase.co/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `op4n-smoke-${randomUUID()}@example.com`, password: randomUUID() }),
    });
    failures.push(...checkSignupDisabled(signup.status, await signup.json().catch(() => null)));
  }

  if (failures.length) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    console.error(`request id: ${created.headers.get("x-request-id") ?? "none"}`);
    process.exit(1);
  }
  console.log("PASS Staging smoke: create, CORS, reports, redirect, spoof rejection, rate limit, runtime config, Admin gate, and disabled sign-up");
}

if (process.argv.includes("--self-test")) selfTest();
else await run();
