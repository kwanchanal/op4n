// Post-deploy Staging smoke: proves the deployed API creates a link for the
// Staging origin and refuses the Production origin. Prints no secrets, no
// project reference, and no destination.

import { randomUUID } from "node:crypto";

const STAGING_ORIGIN = "https://staging.op4n.com";
const PRODUCTION_ORIGIN = "https://op4n.com";
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
      destinationUrl: "https://example.com/op4n-staging-smoke",
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

  if (failures.length) {
    failures.forEach((message) => console.error(`FAIL ${message}`));
    console.error(`request id: ${created.headers.get("x-request-id") ?? "none"}`);
    process.exit(1);
  }
  console.log("PASS Staging smoke: create 201 for Staging origin; Production origin refused");
}

if (process.argv.includes("--self-test")) selfTest();
else await run();
