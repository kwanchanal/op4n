import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../../workers/redirect/src/index.mjs";

const ENV = Object.freeze({
  API_BASE_URL: "https://api.example.test/functions/v1/op4n-api",
  INTERNAL_SERVICE_CREDENTIAL: "c".repeat(64),
  FRONTEND_ORIGIN: "https://staging.op4n.com",
});
const DESTINATION = "https://example.com/landing?utm_source=x#section";
const NOW = () => new Date("2026-11-19T10:00:00.000Z");

function fakeApi(decisionOrError, { clickStatus = 202 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/redirect-lookup")) {
      if (decisionOrError instanceof Error) throw decisionOrError;
      if (typeof decisionOrError === "number") return new Response("{}", { status: decisionOrError });
      return Response.json(decisionOrError);
    }
    return new Response("{}", { status: clickStatus });
  };
  return { fetchImpl, calls };
}

function context() {
  const pending = [];
  return { pending, ctx: { waitUntil: (promise) => pending.push(promise) } };
}

const redirect = (code = "Abc123XYZ9") => ({
  decision: "redirect",
  canonicalCode: code,
  fullDestinationUrl: DESTINATION,
  destinationVersion: 1,
  destinationFingerprint: "f".repeat(64),
  cacheControl: "no-store",
  redirectStatus: 302,
});

async function run(path, { method = "GET", api = fakeApi(redirect()), env = ENV } = {}) {
  const { ctx, pending } = context();
  const response = await handleRequest(
    new Request(`https://staging.op4n.me${path}`, { method }),
    env,
    ctx,
    { fetchImpl: api.fetchImpl, now: NOW },
  );
  await Promise.all(pending);
  return { response, calls: api.calls, pending };
}

test("GET on an eligible code returns 302 no-store and records one click after the response", async () => {
  const { response, calls, pending } = await run("/Abc123XYZ9");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), DESTINATION);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(pending.length, 1, "click is scheduled with waitUntil");

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${ENV.INTERNAL_SERVICE_CREDENTIAL}`);
  assert.deepEqual(calls[0].body, { canonicalCode: "Abc123XYZ9" });
  const click = calls[1];
  assert.match(click.url, /\/api\/v1\/internal\/clicks$/);
  assert.equal(click.init.headers["Idempotency-Key"], click.body.eventId);
  assert.deepEqual(Object.keys(click.body).sort(), ["canonicalCode", "destinationVersion", "eventId", "occurredAt"]);
  assert.equal(click.body.occurredAt, "2026-11-19T10:00:00.000Z");
  assert.ok(!JSON.stringify(click.body).includes("example.com"), "click event never carries the destination");
});

test("HEAD returns the same redirect headers without a body and is not counted", async () => {
  const { response, calls, pending } = await run("/Abc123XYZ9", { method: "HEAD" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), DESTINATION);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.body, null);
  assert.equal(pending.length, 0);
  assert.equal(calls.length, 1);
});

test("only GET and HEAD can redirect; other methods get 405 without a lookup", async () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
    const { response, calls } = await run("/Abc123XYZ9", { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.equal(response.headers.get("Location"), null);
    assert.equal(calls.length, 0);
  }
});

test("malformed, extra-segment, and encoded paths never reach the lookup", async () => {
  for (const path of ["/abc", "/Abc123XYZ9/", "/Abc123XYZ9/extra", "/Abc%2F123XYZ9", "/Abc-123XYZ", "/" + "a".repeat(33), "/Abc123XYZ9.html"]) {
    const { response, calls } = await run(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(calls.length, 0, path);
  }
});

test("the request cannot supply or override the destination", async () => {
  const { response } = await run("/Abc123XYZ9?to=https://evil.example&url=https://evil.example");
  assert.equal(response.headers.get("Location"), DESTINATION);
});

test("unknown code returns the Not Found page; disabled returns the distinct unavailable page", async () => {
  const unknown = await run("/Zzzzzzzzzz", { api: fakeApi({ decision: "unknown", canonicalCode: "Zzzzzzzzzz" }) });
  const disabled = await run("/Abc123XYZ9", { api: fakeApi({ decision: "disabled", canonicalCode: "Abc123XYZ9" }) });
  for (const { response } of [unknown, disabled]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
    assert.match(response.headers.get("Content-Type"), /^text\/html/);
  }
  const unknownHtml = await unknown.response.text();
  const disabledHtml = await disabled.response.text();
  assert.match(unknownHtml, /doesn't exist/);
  assert.match(disabledHtml, /is unavailable/);
  assert.notEqual(unknownHtml, disabledHtml);
  for (const html of [unknownHtml, disabledHtml]) {
    assert.match(html, /<html lang="en">/);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.doesNotMatch(html, /example\.com|reason|moderat|report|owner/i);
  }
  const disabledHead = await run("/Abc123XYZ9", { method: "HEAD", api: fakeApi({ decision: "disabled", canonicalCode: "Abc123XYZ9" }) });
  assert.equal(disabledHead.response.status, 404);
  assert.equal(disabledHead.response.body, null);
});

test("lookup failure, timeout, non-200, and integrity failures fail closed with 503", async () => {
  const cases = [
    fakeApi(new Error("network")),
    fakeApi(503),
    fakeApi(401),
    fakeApi({ ...redirect(), canonicalCode: "Other12345" }),
    fakeApi({ ...redirect(), fullDestinationUrl: "javascript:alert(1)" }),
    fakeApi({ ...redirect(), destinationVersion: 2 }),
    fakeApi({ decision: "surprise" }),
  ];
  for (const api of cases) {
    const { response, pending } = await run("/Abc123XYZ9", { api });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(pending.length, 0);
    assert.doesNotMatch(await response.text(), /example\.com/);
  }
});

test("missing configuration fails closed", async () => {
  const { response, calls } = await run("/Abc123XYZ9", { env: { ...ENV, INTERNAL_SERVICE_CREDENTIAL: "" } });
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});

test("click failure never changes the redirect and retries once with the same event id", async () => {
  const api = fakeApi(redirect(), { clickStatus: 503 });
  const { response, calls } = await run("/Abc123XYZ9", { api });
  assert.equal(response.status, 302);
  const clicks = calls.filter((call) => call.url.endsWith("/clicks"));
  assert.equal(clicks.length, 2);
  assert.equal(clicks[0].body.eventId, clicks[1].body.eventId);
});

test("root redirects to the frontend and robots.txt disallows crawling", async () => {
  const root = await run("/");
  assert.equal(root.response.status, 302);
  assert.equal(root.response.headers.get("Location"), "https://staging.op4n.com/");
  const robots = await run("/robots.txt");
  assert.equal(robots.response.status, 200);
  assert.equal(await robots.response.text(), "User-agent: *\nDisallow: /\n");
});

test("no Worker response uses permanent or cacheable redirect semantics", async () => {
  const responses = [
    (await run("/Abc123XYZ9")).response,
    (await run("/")).response,
    (await run("/Zzzzzzzzzz", { api: fakeApi({ decision: "unknown" }) })).response,
    (await run("/Abc123XYZ9", { api: fakeApi(503) })).response,
  ];
  for (const response of responses) {
    assert.ok(![301, 307, 308].includes(response.status));
    assert.doesNotMatch(response.headers.get("Cache-Control") || "", /max-age|s-maxage|public/);
  }
});
