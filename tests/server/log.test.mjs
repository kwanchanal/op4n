import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { createLogger } from "../../supabase/functions/_shared/log.mjs";
import { createAdminGate } from "../../supabase/functions/_shared/admin-auth.mjs";

function capture() {
  const lines = [];
  const sink = { info: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  return { lines, logger: createLogger({ service: "op4n-api", environment: "staging", sink, now: () => new Date("2026-11-27T01:02:03Z") }) };
}

test("every line carries the required schema fields", () => {
  const { lines, logger } = capture();
  logger.info("api_request", { requestId: "req-1", status: 201, operation: "createGuestCanonicalLink" });
  logger.error("redirect_lookup_failed", { outcome: "error", code: "Abc123XYZ9" });
  for (const line of lines) {
    const entry = JSON.parse(line);
    for (const field of ["ts", "env", "service", "event", "outcome", "severity", "requestId"]) assert.ok(field in entry, field);
    assert.equal(entry.ts, "2026-11-27T01:02:03.000Z");
    assert.equal(entry.env, "staging");
  }
  assert.equal(JSON.parse(lines[1]).severity, "error");
});

test("secrets, destinations, headers, and addresses never reach a log line", () => {
  const { lines, logger } = capture();
  const SECRETS = ["TOKENVALUE", "frag-secret", "Bearer abc.def.ghi", "session=COOKIE", "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901", "203.0.113.9", "founder@example.com", "reset/PRIVATE"];
  logger.warn("hostile", {
    destinationUrl: "https://example.com/reset/PRIVATE?token=TOKENVALUE#frag-secret",
    fullDestinationUrl: "https://example.com/x",
    authorization: "Bearer abc.def.ghi",
    cookie: "session=COOKIE",
    "Idempotency-Key": "8f14e45f-ceea-4a5f-8b9e-12f4a7c6d901",
    ip: "203.0.113.9",
    email: "founder@example.com",
    note: "see https://example.com/reset/PRIVATE?token=TOKENVALUE#frag-secret",
    nested: { url: "https://example.com/?token=TOKENVALUE", count: 2 },
  });
  const text = lines.join("\n");
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.note, "see https://example.com/[redacted]");
  assert.equal(entry.nested.count, 2);
  assert.equal(entry.destinationUrl, "[redacted]");
});

test("a bare URL value keeps only its origin", () => {
  const { lines, logger } = capture();
  logger.info("probe", { target: "https://example.com/reset/PRIVATE?token=X" });
  assert.equal(JSON.parse(lines[0]).target, "https://example.com/[redacted]");
});

test("newline and control-character injection stays on one line", () => {
  const { lines, logger } = capture();
  logger.info("probe\n{\"event\":\"forged\"}", { code: "Abc\r\nX-Forged: 1", reason: "\u001b[31mred\u2028" });
  assert.equal(lines.length, 1);
  assert.ok(!/[\n\r\u001b\u2028]/.test(lines[0]));
  const entry = JSON.parse(lines[0]);
  assert.match(entry.event, /\\u000a/);
  assert.match(entry.code, /\\u000d\\u000a/);
});

test("logging failure never throws", () => {
  const broken = createLogger({ service: "x", environment: "staging", sink: { info: () => { throw new Error("sink down"); } } });
  assert.doesNotThrow(() => broken.info("event", { a: 1 }));
  const cyclic = {};
  cyclic.self = cyclic;
  const { logger } = capture();
  assert.doesNotThrow(() => logger.info("event", { cyclic }));
});

test("the Admin gate log goes through the logger without the subject identifier", async () => {
  const { lines, logger } = capture();
  const gate = createAdminGate({
    issuer: "https://x.supabase.co/auth/v1", audience: "authenticated", subjectAllowlist: "4effd356-0000-4000-8000-000000000001",
    keyStore: { keyFor: async () => null }, allowedOrigins: [],
    log: ({ event, requestId, status, ...fields }) => logger.warn(event, { ...fields, requestId, status }),
  });
  await gate("getAdminSession", async () => ({ status: 200, body: {} }))(new Request("https://x/api/v1/admin/session", {
    headers: { Authorization: "Bearer not.a.jwt" },
  }));
  assert.equal(JSON.parse(lines[0]).event, "admin_request");
  assert.ok(!lines[0].includes("not.a.jwt") && !lines[0].includes("4effd356"));
});

test("server and Worker code logs only through log.mjs", async () => {
  const roots = ["supabase/functions", "workers/redirect/src", "workers/notifier/src"];
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(mjs|ts)$/.test(entry.name) && !path.endsWith("_shared/log.mjs")) {
        const text = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
        if (/console\.(log|info|warn|error)\s*\(/.test(text)) offenders.push(path);
      }
    }
  }
  for (const root of roots) await walk(root);
  assert.deepEqual(offenders, []);
});
