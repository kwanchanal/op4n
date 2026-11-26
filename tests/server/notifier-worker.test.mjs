import assert from "node:assert/strict";
import test from "node:test";
import { createLogger } from "../../supabase/functions/_shared/log.mjs";
import { buildMime, DAILY_CHECK_CRON, renderDigest, runDailyCheck, runDigest } from "../../workers/notifier/src/index.mjs";
import { createOpsDailyCheckHandler } from "../../supabase/functions/_shared/internal-handlers.mjs";
import { readFile } from "node:fs/promises";

const ENV = {
  API_BASE_URL: "https://api.test/functions/v1/op4n-api",
  INTERNAL_SERVICE_CREDENTIAL: "c".repeat(40),
  OP4N_ENVIRONMENT: "staging",
  FRONTEND_ORIGIN: "https://staging.op4n.com",
  SHORT_HOST: "staging.op4n.me",
  NOTIFY_FROM: "notify-staging@op4n.com",
  NOTIFY_TO: "founder@example.com",
};
const BATCH = "11111111-2222-4333-8444-555555555555";
const ENTRIES = [
  { canonicalCode: "Abc123XYZ9", kind: "report", reasonCategory: "phishing", priority: "S1", count: 7, firstAt: "2026-11-26T10:00:00Z", lastAt: "2026-11-26T10:04:00Z" },
  { canonicalCode: "Abc123XYZ9", kind: "report", reasonCategory: "spam", priority: "S3", count: 3, firstAt: "2026-11-26T10:01:00Z", lastAt: "2026-11-26T10:02:00Z" },
  { canonicalCode: "Zzz999yyy8", kind: "safety_block", reasonCategory: null, priority: "S1", count: 1, firstAt: "2026-11-26T10:03:00Z", lastAt: "2026-11-26T10:03:00Z" },
];

function fakeApi({ claim, completeStatus = 200, exhausted = 0 }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (url.endsWith("/claim")) return new Response(JSON.stringify(claim), { status: 200 });
    return new Response(JSON.stringify({ updated: 1, exhausted }), { status: completeStatus });
  };
  return { calls, fetchImpl };
}
// The real structured logger writing into memory.
const quietLog = () => {
  const lines = [];
  const sink = { info: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  return { ...createLogger({ service: "notifier-worker", environment: "staging", sink }), lines };
};

test("ten reports and a safety block become one digest email", async () => {
  const sent = [];
  const { calls, fetchImpl } = fakeApi({ claim: { batchId: BATCH, events: 11, entries: ENTRIES } });
  const result = await runDigest(ENV, { fetchImpl, log: quietLog(), now: () => new Date("2026-11-26T10:05:00Z"), send: async (...args) => sent.push(args) });
  assert.deepEqual(result, { outcome: "sent", events: 11, exhausted: 0 });
  assert.equal(sent.length, 1, "one email per batch");
  assert.equal(sent[0][1], "founder@example.com");
  assert.match(sent[0][2], /Subject: \[Op4n Staging\] S1 11 new moderation events on 2 links/);
  assert.match(sent[0][2], /staging\.op4n\.me\/Abc123XYZ9  phishing report x7/);
  assert.match(sent[0][2], /staging\.op4n\.me\/Zzz999yyy8  automatic safety block x1/);
  assert.match(sent[0][2], /https:\/\/staging\.op4n\.com\/admin/);
  assert.deepEqual(calls.map((call) => [call.url.split("/").pop(), call.body]), [["claim", {}], ["complete", { batchId: BATCH, outcome: "sent" }]]);
  assert.ok(calls.every((call) => call.auth === `Bearer ${"c".repeat(40)}`));
});

test("an empty outbox sends nothing", async () => {
  const sent = [];
  const { calls, fetchImpl } = fakeApi({ claim: { batchId: null, events: 0, entries: [] } });
  assert.deepEqual(await runDigest(ENV, { fetchImpl, log: quietLog(), send: async (...a) => sent.push(a) }), { outcome: "empty" });
  assert.equal(sent.length, 0);
  assert.equal(calls.length, 1);
});

test("a send failure completes the batch as failed and exhaustion is logged as an alert", async () => {
  const log = quietLog();
  const { calls, fetchImpl } = fakeApi({ claim: { batchId: BATCH, events: 1, entries: ENTRIES.slice(0, 1) }, exhausted: 1 });
  const result = await runDigest(ENV, { fetchImpl, log, send: async () => { throw new Error("destination address not verified"); } });
  assert.deepEqual(result, { outcome: "failed", events: 1, exhausted: 1 });
  assert.deepEqual(calls[1].body, { batchId: BATCH, outcome: "failed" });
  assert.ok(log.lines.some((line) => line.includes("founder_notification_send_failed")));
  assert.ok(log.lines.some((line) => line.includes("founder_notification_exhausted")));
  assert.ok(!log.lines.join("\n").includes("founder@example.com"), "the destination address is never logged");
});

test("an unreachable API throws so the rows stay in the outbox", async () => {
  const fetchImpl = async () => new Response("{}", { status: 503 });
  await assert.rejects(runDigest(ENV, { fetchImpl, log: quietLog(), send: async () => {} }));
});

test("the digest never contains destinations, query strings, fragments, or report text", () => {
  const hostile = [{ ...ENTRIES[0], canonicalCode: "Abc123XYZ9\r\nBcc: x@y.z", destination: "https://evil.example/login?token=1#f", detail: "call my phone" }];
  const { subject, text } = renderDigest({ entries: hostile, events: 1, environment: "staging", shortHost: "staging.op4n.me", adminUrl: "https://staging.op4n.com/admin" });
  const mime = buildMime({ from: "a@op4n.com", to: "b@example.com\r\nBcc: c@d.e", subject: `${subject}\r\nBcc: x`, text, messageId: BATCH, date: new Date(0) });
  for (const forbidden of ["evil.example", "token=", "#f", "call my phone"]) {
    assert.ok(!mime.includes(forbidden), `digest must not contain ${forbidden}`);
  }
  assert.ok(!/\r\nBcc:/.test(mime), "no header injection");
  assert.match(text, /staging\.op4n\.me\/Abc123XYZ9Bccxyz/);
});

test("operational alerts render without codes or URLs and lead the subject", () => {
  const { subject, text } = renderDigest({
    entries: [
      { kind: "ops_alert", alertCode: "quota_critical", alertDetail: "CRITICAL Edge Function invocations ~700000/month (140% of 500000)\r\nBcc: x@y.z", priority: "S1", count: 1, canonicalCode: null, firstAt: "2026-11-27T01:07:00Z", lastAt: "2026-11-27T01:07:00Z" },
      { kind: "report", reasonCategory: "spam", priority: "S3", count: 2, canonicalCode: "Abc123XYZ9", firstAt: "2026-11-27T01:00:00Z", lastAt: "2026-11-27T01:01:00Z" },
    ],
    events: 3, environment: "staging", shortHost: "staging.op4n.me", adminUrl: "https://staging.op4n.com/admin",
  });
  assert.equal(subject, "[Op4n Staging] S1 1 operational alert and 2 moderation events");
  assert.match(text, /S1  operational alert \(quota_critical\): CRITICAL Edge Function invocations/);
  assert.ok(!/\r|\nBcc/.test(text.split("operational alert")[1].split("\n")[0]), "alert detail cannot inject lines");
});

test("the daily check runs on its own cron, calls the API once, and never throws", async () => {
  const calls = [];
  const summary = await runDailyCheck(ENV, {
    fetchImpl: async (url, init) => { calls.push([url, init.headers.Authorization]); return Response.json({ alertsQueued: ["quota_warning"] }); },
    log: quietLog(),
  });
  assert.deepEqual(summary, { alertsQueued: ["quota_warning"] });
  assert.deepEqual(calls, [[`${ENV.API_BASE_URL}/api/v1/internal/ops/daily-check`, `Bearer ${ENV.INTERNAL_SERVICE_CREDENTIAL}`]]);
  const log = quietLog();
  assert.equal(await runDailyCheck(ENV, { fetchImpl: async () => new Response("", { status: 503 }), log }), null);
  assert.ok(log.lines.some((line) => line.includes("ops_daily_check_failed")));
  const wrangler = await readFile(new URL("../../workers/notifier/wrangler.toml", import.meta.url), "utf8");
  assert.ok(wrangler.includes(`"${DAILY_CHECK_CRON}"`), "the daily cron is configured");
});

test("the daily-check endpoint needs the service credential and returns counts only", async () => {
  const credential = "c".repeat(64);
  const handler = createOpsDailyCheckHandler({
    credential, environment: "staging",
    persistence: { opsDailyCheck: async ({ environment }) => ({ estimatedMonthlyInvocations: 690000, invocationPercent: 138, databasePercent: 2, staleS1Cases: 0, alertsQueued: ["quota_critical"], environment }) },
  });
  const denied = await handler(new Request("https://x/api/v1/internal/ops/daily-check", { method: "POST" }));
  assert.equal(denied.status, 401);
  const response = await handler(new Request("https://x/api/v1/internal/ops/daily-check", { method: "POST", headers: { Authorization: `Bearer ${credential}` } }));
  assert.deepEqual(await response.json(), { estimatedMonthlyInvocations: 690000, invocationPercent: 138, databasePercent: 2, staleS1Cases: 0, alertsQueued: ["quota_critical"] });
});
