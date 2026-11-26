// Executes the real migrations in PGlite (Postgres compiled to WASM) and
// exercises the redirect lookup, click recording, and retention functions.
// pg_cron is not available in PGlite, so only the scheduling block is skipped.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const EVENT_A = "79cb42d9-bd78-4da8-a77f-f8d7f6ea31c2";
const EVENT_B = "8a1b42d9-bd78-4da8-a77f-f8d7f6ea31c3";
const CODE = "Abc123XYZ9";

async function database() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create role anon; create role authenticated; create role service_role; create schema extensions;");
  await db.exec(await migration("202611090001_create_guest_link_slice.sql"));
  for (const [name, job] of [
    ["202611190001_redirect_lookup_and_clicks.sql", "op4n_purge_expired_click_events"],
    ["202611200001_rate_limits_and_feature_flags.sql", "op4n_purge_rate_limit_counters"],
    ["202611230001_reports_and_moderation.sql", null],
    ["202611260001_notification_outbox.sql", "op4n_purge_sent_notifications"],
    ["202611260002_admin_moderation.sql", null],
    ["202611270001_public_discovery.sql", null],
    ["202611270002_health_synthetic.sql", null],
  ]) {
    const sql = await migration(name);
    if (job) assert.match(sql, new RegExp(`cron\\.schedule\\(\\s*'${job}'`));
    // pg_cron is not available in PGlite; only the scheduling block is skipped.
    await db.exec(sql.replace(/create extension if not exists pg_cron[\s\S]*?(?=commit;)/, ""));
  }
  return db;
}

async function value(db, sql, params = []) {
  const row = (await db.query(sql, params)).rows[0];
  return Object.values(row)[0];
}

async function createLink(db) {
  const reservation = await value(
    db,
    "select public.begin_creation_idempotency_v1('staging','createGuestCanonicalLink',$1,$2)",
    ["a".repeat(64), "b".repeat(64)],
  );
  const created = await value(
    db,
    `select public.create_guest_link_v1('staging','createGuestCanonicalLink',$1,$2,$3,$4,'T',
      'https://example.com/p?q=1','https://example.com',$5,'HMAC-SHA-256','v1','r1-origin-only-v1','https://staging.op4n.me')`,
    ["a".repeat(64), "b".repeat(64), reservation.reservationToken, CODE, "f".repeat(64)],
  );
  assert.equal(created.kind, "created");
}

const resolve = (db, code) => value(db, "select public.resolve_canonical_redirect_v1($1)", [code]);
const record = (db, eventId, code, version = 1, at = "now()") =>
  value(db, `select public.record_click_v1($1,$2,$3,${at})`, [eventId, code, version]);
const total = async (db) => Number(await value(db, "select total_clicks from public.click_aggregates"));

test("redirect lookup returns redirect, unknown, and disabled decisions", async () => {
  const db = await database();
  await createLink(db);

  const allowed = await resolve(db, CODE);
  assert.deepEqual(
    { ...allowed, destinationFingerprint: undefined },
    {
      decision: "redirect",
      canonicalCode: CODE,
      fullDestinationUrl: "https://example.com/p?q=1",
      destinationVersion: 1,
      destinationFingerprint: undefined,
      cacheControl: "no-store",
      redirectStatus: 302,
    },
  );
  for (const code of [CODE.toLowerCase(), "ZZZZZZZZZZ", "a/b", "", null]) {
    const decision = await resolve(db, code);
    assert.equal(decision.decision, "unknown");
    assert.equal(decision.fullDestinationUrl, undefined);
  }

  await db.exec("update public.canonical_links set lifecycle_state = 'disabled', disabled_at = now()");
  const disabled = await resolve(db, CODE);
  assert.equal(disabled.decision, "disabled");
  assert.equal(disabled.fullDestinationUrl, undefined);

  await db.exec("update public.canonical_links set lifecycle_state = 'active', disabled_at = null, safety_state = 'blocked'");
  assert.equal((await resolve(db, CODE)).decision, "disabled");
  await db.exec("update public.canonical_links set safety_state = 'pending'");
  assert.equal((await resolve(db, CODE)).decision, "disabled");
  await assert.rejects(db.exec("delete from public.issued_codes"));
});

test("click recording deduplicates events and keeps aggregates monotonic", async () => {
  const db = await database();
  await createLink(db);

  assert.equal((await record(db, EVENT_A, CODE)).kind, "accepted");
  assert.equal((await record(db, EVENT_A, CODE)).kind, "replayed");
  assert.equal(await total(db), 1);
  assert.equal((await record(db, EVENT_A, CODE, 2)).kind, "invalid");
  assert.equal((await record(db, EVENT_B, CODE, 1, "now() - interval '2 hours'")).kind, "invalid");
  assert.equal((await record(db, EVENT_B, CODE, 1, "now() + interval '1 hour'")).kind, "invalid");
  assert.equal((await record(db, EVENT_B, "ZZZZZZZZZZ")).kind, "invalid");
  assert.equal((await record(db, EVENT_B, CODE)).kind, "accepted");
  assert.equal(await total(db), 2);

  await assert.rejects(db.exec("update public.click_aggregates set total_clicks = 0"));
  await assert.rejects(db.exec("delete from public.click_aggregates"));
  await assert.rejects(db.exec("delete from public.click_events"));
  await assert.rejects(db.exec("update public.click_events set occurred_at = now()"));

  const columns = (await db.query(
    "select column_name from information_schema.columns where table_name = 'click_events'",
  )).rows.map((row) => row.column_name);
  for (const forbidden of ["ip", "ip_address", "user_agent", "referrer", "device", "location"]) {
    assert.ok(!columns.includes(forbidden), `click_events must not have ${forbidden}`);
  }
});

test("retention deletes only expired counted events and never lowers totals", async () => {
  const db = await database();
  await createLink(db);
  await record(db, EVENT_A, CODE);
  await record(db, EVENT_B, CODE);
  const linkId = await value(db, "select link_id from public.click_aggregates");
  const destinationId = await value(db, "select id from public.protected_destination_versions");
  await db.query(
    `insert into public.click_events (link_id, destination_version_id, ingestion_key, occurred_at, recorded_at, counted_aggregate_version)
     values ($1, $2, gen_random_uuid(), now() - interval '40 days', now() - interval '40 days', 1)`,
    [linkId, destinationId],
  );
  assert.equal(Number(await value(db, "select public.purge_expired_click_events_v1()")), 1);
  assert.equal(Number(await value(db, "select count(*) from public.click_events")), 2);
  assert.equal(await total(db), 2);
});

test("browser roles cannot execute the new functions or read the new tables", async () => {
  const db = await database();
  const grants = (await db.query(
    `select grantee from information_schema.role_routine_grants
     where routine_name in ('resolve_canonical_redirect_v1', 'record_click_v1', 'purge_expired_click_events_v1')
       and grantee in ('anon', 'authenticated', 'PUBLIC')`,
  )).rows;
  assert.deepEqual(grants, []);
  const tableGrants = (await db.query(
    `select grantee from information_schema.role_table_grants
     where table_name in ('click_events', 'click_aggregates') and grantee in ('anon', 'authenticated')`,
  )).rows;
  assert.deepEqual(tableGrants, []);
});

const IDENTITY = "a".repeat(64);
const consume = (db, windows, identity = IDENTITY, limitClass = "public-create") => value(
  db,
  "select public.consume_rate_limit_v1('staging', $1, $2, $3::jsonb)",
  [limitClass, identity, JSON.stringify(windows)],
);

test("rate limiter allows up to the limit, then limits with a retry delay", async () => {
  const db = await database();
  const windows = [{ seconds: 60, limit: 5 }, { seconds: 3600, limit: 30 }];
  for (let index = 1; index <= 5; index += 1) {
    const result = await consume(db, windows);
    assert.equal(result.decision, "allowed");
    assert.equal(result.limit, 5, "tightest window is reported");
    assert.equal(result.remaining, 5 - index);
  }
  const limited = await consume(db, windows);
  assert.equal(limited.decision, "limited");
  assert.equal(limited.remaining, 0);
  assert.ok(limited.retryAfter >= 1 && limited.retryAfter <= 60);
  assert.equal((await consume(db, windows, "b".repeat(64))).decision, "allowed", "identities are independent");
  assert.equal((await consume(db, [{ seconds: 86400, limit: 2 }], "global")).decision, "allowed");
});

test("rate limiter rejects invalid windows and identities", async () => {
  const db = await database();
  await assert.rejects(consume(db, []));
  await assert.rejects(consume(db, [{ seconds: 0, limit: 5 }]));
  await assert.rejects(consume(db, [{ seconds: 60, limit: 0 }]));
  await assert.rejects(consume(db, [{ seconds: 60, limit: 5 }], "203.0.113.1"), "raw IPs are rejected by the identity check");
  const columns = (await db.query(
    "select column_name from information_schema.columns where table_name = 'rate_limit_counters'",
  )).rows.map((row) => row.column_name);
  assert.ok(!columns.some((name) => /ip|address|agent/.test(name)));
});

test("rate-limit cleanup removes only windows older than 25 hours", async () => {
  const db = await database();
  await consume(db, [{ seconds: 60, limit: 5 }]);
  await db.query(
    `insert into public.rate_limit_counters (environment, limit_class, identity_hash, window_seconds, window_start, request_count)
     values ('staging', 'public-create', $1, 60, now() - interval '2 days', 3)`,
    [IDENTITY],
  );
  assert.equal(Number(await value(db, "select public.purge_rate_limit_counters_v1()")), 1);
  assert.equal(Number(await value(db, "select count(*) from public.rate_limit_counters")), 1);
});

test("feature flags default on, require a new reason, and are audited", async () => {
  const db = await database();
  assert.deepEqual(await value(db, "select public.get_feature_flags_v1()"), {
    guest_creation: true,
    latest_links: true,
    public_search: true,
    public_reports: true,
  });
  await assert.rejects(db.exec("update public.feature_flags set enabled = false where flag_key = 'guest_creation'"));
  await db.exec("update public.feature_flags set enabled = false, reason = 'Abuse spike drill' where flag_key = 'guest_creation'");
  assert.equal((await value(db, "select public.get_feature_flags_v1()")).guest_creation, false);
  const audit = (await db.query(
    "select old_enabled, new_enabled, reason, actor from public.feature_flag_audit where flag_key = 'guest_creation' order by occurred_at",
  )).rows;
  assert.equal(audit.length, 2, "seed insert and the change are both audited");
  assert.deepEqual({ ...audit[1], actor: typeof audit[1].actor }, {
    old_enabled: true, new_enabled: false, reason: "Abuse spike drill", actor: "string",
  });
  await assert.rejects(db.exec("delete from public.feature_flags where flag_key = 'guest_creation'"));
  await assert.rejects(db.exec("update public.feature_flag_audit set reason = 'edited'"));
  await assert.rejects(db.exec("delete from public.feature_flag_audit"));
  await assert.rejects(db.exec("insert into public.feature_flags (flag_key, enabled, reason) values ('unknown_flag', true, 'nope')"));
});

test("browser roles cannot use the rate-limit or feature-flag functions", async () => {
  const db = await database();
  const grants = (await db.query(
    `select grantee from information_schema.role_routine_grants
     where routine_name in ('consume_rate_limit_v1', 'purge_rate_limit_counters_v1', 'get_feature_flags_v1')
       and grantee in ('anon', 'authenticated', 'PUBLIC')`,
  )).rows;
  assert.deepEqual(grants, []);
});

const report = (db, key, reason = "phishing", detail = "Looks like a fake login", code = CODE, digest = "d".repeat(64)) => value(
  db,
  "select public.submit_report_v1('staging', $1, $2, $3, $4, $5)",
  [code, key.repeat(64).slice(0, 64), digest, reason, detail],
);

test("reports persist with a receipt, replay idempotently, and reject conflicts", async () => {
  const db = await database();
  await createLink(db);
  const first = await report(db, "1");
  assert.equal(first.kind, "accepted");
  assert.match(first.receiptId, /^[0-9a-f-]{36}$/);
  const replay = await report(db, "1");
  assert.deepEqual(replay, { kind: "replayed", receiptId: first.receiptId });
  assert.equal((await report(db, "1", "spam", null, CODE, "e".repeat(64))).kind, "conflict");
  assert.equal(Number(await value(db, "select count(*) from public.reports")), 1);
  const stored = (await db.query("select reason_code, report_detail, workflow_state from public.reports")).rows[0];
  assert.deepEqual(stored, { reason_code: "phishing", report_detail: "Looks like a fake login", workflow_state: "new" });
});

test("reports open one case per link at the most severe priority and never touch the redirect", async () => {
  const db = await database();
  await createLink(db);
  await report(db, "1", "spam");
  assert.equal(await value(db, "select priority from public.moderation_cases"), "S3");
  await report(db, "2", "impersonation");
  assert.equal(await value(db, "select priority from public.moderation_cases"), "S2");
  await report(db, "3", "malware");
  await report(db, "4", "other");
  assert.equal(Number(await value(db, "select count(*) from public.moderation_cases")), 1);
  assert.equal(await value(db, "select priority from public.moderation_cases"), "S1");
  assert.equal((await resolve(db, CODE)).decision, "redirect", "a report never disables the redirect");
});

test("reports for unknown or inactive links are unavailable and invalid input is rejected", async () => {
  const db = await database();
  await createLink(db);
  assert.equal((await report(db, "5", "spam", null, "ZZZZZZZZZZ")).kind, "unavailable");
  assert.equal((await report(db, "6", "spam", null, "../etc")).kind, "unavailable");
  await assert.rejects(report(db, "7", "not_a_category"));
  await assert.rejects(report(db, "8", "spam", "x".repeat(1001)));
  await db.exec("update public.canonical_links set lifecycle_state = 'disabled', disabled_at = now()");
  assert.equal((await report(db, "9", "spam")).kind, "unavailable");
  const columns = (await db.query("select column_name from information_schema.columns where table_name = 'reports'")).rows.map((row) => row.column_name);
  for (const forbidden of ["ip", "ip_address", "client_ip", "user_agent", "device", "reporter_email", "account_id"]) {
    assert.ok(!columns.includes(forbidden), `reports must not have ${forbidden}`);
  }
});

test("moderation actions are append-only and state changes require a reason", async () => {
  const db = await database();
  await createLink(db);
  const linkId = await value(db, "select id from public.canonical_links");
  await assert.rejects(db.query("insert into public.moderation_actions (link_id, actor_principal_id, action_type) values ($1, 'founder', 'disable')", [linkId]));
  await db.query("insert into public.moderation_actions (link_id, actor_principal_id, action_type, reason_code) values ($1, 'founder', 'disable', 'abuse_report')", [linkId]);
  await assert.rejects(db.exec("update public.moderation_actions set reason_code = 'safety_block'"));
  await assert.rejects(db.exec("delete from public.moderation_actions"));
  const grants = (await db.query(
    `select grantee from information_schema.role_routine_grants
     where routine_name in ('submit_report_v1', 'report_severity') and grantee in ('anon', 'authenticated', 'PUBLIC')`,
  )).rows;
  assert.deepEqual(grants, []);
});

const claim = (db) => value(db, "select public.claim_notifications_v1('staging', 200, 120)");
const complete = (db, batch, outcome) => value(db, "select public.complete_notifications_v1($1, $2)", [batch, outcome]);

test("accepted reports enqueue one notification each; replays do not", async () => {
  const db = await database();
  await createLink(db);
  await report(db, "1", "phishing");
  await report(db, "1", "phishing");
  await report(db, "2", "spam");
  assert.equal(Number(await value(db, "select count(*) from public.notification_outbox")), 2);
  const columns = (await db.query("select column_name from information_schema.columns where table_name = 'notification_outbox'")).rows.map((row) => row.column_name);
  for (const forbidden of ["destination", "full_destination_url", "report_detail", "detail", "ip", "email"]) {
    assert.ok(!columns.includes(forbidden), `outbox must not have ${forbidden}`);
  }
});

test("a claim groups ten reports into one digest batch and a second claim finds nothing", async () => {
  const db = await database();
  await createLink(db);
  for (let index = 0; index < 10; index += 1) await report(db, String(index), index < 7 ? "phishing" : "spam");
  const batch = await claim(db);
  assert.equal(batch.events, 10);
  assert.deepEqual(batch.entries.map((entry) => [entry.canonicalCode, entry.reasonCategory, entry.count, entry.priority]), [
    [CODE, "phishing", 7, "S1"],
    [CODE, "spam", 3, "S3"],
  ]);
  assert.equal((await claim(db)).batchId, null, "claimed rows are leased");
  assert.deepEqual(await complete(db, batch.batchId, "sent"), { updated: 10, exhausted: 0 });
  assert.equal(Number(await value(db, "select count(*) from public.notification_outbox where state = 'sent'")), 10);
  assert.equal(Number(await value(db, "select public.purge_sent_notifications_v1()")), 0, "fresh sent rows are kept");
  await db.exec("update public.notification_outbox set sent_at = now() - interval '31 days'");
  assert.equal(Number(await value(db, "select public.purge_sent_notifications_v1()")), 10);
});

test("failures retry with backoff, an expired lease is reclaimed, and 3 failures exhaust", async () => {
  const db = await database();
  await createLink(db);
  await report(db, "1", "malware");
  let batch = await claim(db);
  assert.deepEqual(await complete(db, batch.batchId, "failed"), { updated: 1, exhausted: 0 });
  assert.equal((await claim(db)).batchId, null, "backoff delays the retry");
  await db.exec("update public.notification_outbox set available_at = now() - interval '1 second'");
  batch = await claim(db);
  assert.equal(batch.events, 1);
  await db.exec("update public.notification_outbox set lease_until = now() - interval '1 second'");
  const reclaimed = await claim(db);
  assert.equal(reclaimed.events, 1, "a crashed sender's lease expires and the row is not lost");
  assert.deepEqual(await complete(db, batch.batchId, "sent"), { updated: 0, exhausted: 0 }, "a stale batch cannot complete");
  await complete(db, reclaimed.batchId, "failed");
  await db.exec("update public.notification_outbox set available_at = now() - interval '1 second'");
  const third = await claim(db);
  assert.deepEqual(await complete(db, third.batchId, "failed"), { updated: 1, exhausted: 1 });
  assert.equal(await value(db, "select state from public.notification_outbox"), "failed");
  assert.equal(Number(await value(db, "select attempts from public.notification_outbox")), 3);
});

test("safety blocks enqueue an S1 entry and browser roles cannot touch the outbox", async () => {
  const db = await database();
  await createLink(db);
  const linkId = await value(db, "select id from public.canonical_links");
  await db.query("select public.enqueue_safety_block_notification_v1('staging', $1)", [linkId]);
  const batch = await claim(db);
  assert.deepEqual(batch.entries.map((entry) => [entry.kind, entry.reasonCategory, entry.priority]), [["safety_block", null, "S1"]]);
  const grants = (await db.query(
    `select grantee from information_schema.role_routine_grants
     where routine_name in ('claim_notifications_v1', 'complete_notifications_v1', 'enqueue_safety_block_notification_v1')
       and grantee in ('anon', 'authenticated', 'PUBLIC')`,
  )).rows;
  assert.deepEqual(grants, []);
});

const moderate = (db, action, key, reason = "abuse_report", digest = "a".repeat(64)) => value(
  db,
  "select public.admin_moderate_link_v1($1, $2, 'founder-subject', $3, 'note', $4, $5)",
  [CODE, action, reason, key.repeat(64).slice(0, 64), digest],
);

test("admin lookup finds by code or exact fingerprint and hides the full destination until revealed", async () => {
  const db = await database();
  await createLink(db);
  await report(db, "1", "phishing");
  assert.equal(await value(db, "select public.admin_find_link_v1($1, null)", [CODE]), CODE);
  assert.equal(await value(db, "select public.admin_find_link_v1(null, $1)", ["f".repeat(64)]), CODE);
  assert.equal(await value(db, "select public.admin_find_link_v1(null, $1)", ["e".repeat(64)]), null);
  assert.equal(await value(db, "select public.admin_find_link_v1($1, null)", ["Abc123"]), null, "no partial match");
  const record = await value(db, "select public.admin_link_record_v1($1)", [CODE]);
  assert.equal(record.canonicalCode, CODE);
  assert.equal(record.safeDestinationOrigin, "https://example.com");
  assert.equal(record.reportCount, 1);
  assert.deepEqual(record.reportsByReason, { phishing: 1 });
  assert.equal(record.openCase.priority, "S1");
  assert.ok(!JSON.stringify(record).includes("p?q=1"), "record excludes the full destination");
  const revealed = await value(db, "select public.admin_reveal_destination_v1($1, 'founder-subject')", [CODE]);
  assert.deepEqual(revealed, { kind: "revealed", fullDestinationUrl: "https://example.com/p?q=1" });
  assert.equal(await value(db, "select action_type from public.moderation_actions"), "reveal_destination", "reveal is audited");
});

test("queue lists open cases by severity without destinations; triage and resolve are audited", async () => {
  const db = await database();
  await createLink(db);
  await report(db, "1", "spam");
  await report(db, "2", "malware");
  const queue = await value(db, "select public.admin_list_cases_v1(50, 0)");
  assert.equal(queue.total, 1);
  assert.equal(queue.items[0].priority, "S1");
  assert.deepEqual(queue.items[0].reportsByReason, { spam: 1, malware: 1 });
  assert.ok(!JSON.stringify(queue).includes("p?q=1"));
  const caseId = queue.items[0].caseId;
  await assert.rejects(db.query("select public.admin_transition_case_v1($1, 'triage', 'founder-subject', '  ')", [caseId]), /note is required/);
  assert.equal((await value(db, "select public.admin_transition_case_v1($1, 'triage', 'founder-subject', 'Looking')", [caseId])).caseState, "triaged");
  assert.equal(Number(await value(db, "select count(*) from public.reports where workflow_state = 'triaged'")), 2);
  assert.equal((await value(db, "select public.admin_transition_case_v1($1, 'resolve', 'founder-subject', 'Not abusive')", [caseId])).caseState, "closed");
  assert.equal((await value(db, "select public.admin_list_cases_v1(50, 0)")).total, 0);
  const actions = (await db.query("select action_type, reason_detail, actor_principal_id from public.moderation_actions order by occurred_at")).rows;
  assert.deepEqual(actions.map((row) => [row.action_type, row.reason_detail, row.actor_principal_id]), [
    ["triage", "Looking", "founder-subject"], ["resolve", "Not abusive", "founder-subject"],
  ]);
});

test("disable and restore change redirect state atomically, idempotently, and with audit", async () => {
  const db = await database();
  await createLink(db);
  await assert.rejects(db.query("select public.admin_moderate_link_v1($1, 'disable', 'f', null, null, $2, $3)", [CODE, "1".repeat(64), "a".repeat(64)]));
  const disabled = await moderate(db, "disable", "1");
  assert.deepEqual(disabled, { kind: "changed", canonicalCode: CODE, lifecycleState: "disabled" });
  assert.equal((await resolve(db, CODE)).decision, "disabled", "redirect shows the unavailable page");
  // Discovery screening is untouched; lifecycle alone removes it from discovery.
  assert.equal(await value(db, "select discovery_state from public.canonical_links"), "eligible");
  assert.deepEqual(await value(db, "select public.list_public_links_v1('https://staging.op4n.me', 100)"), { items: [] });
  assert.deepEqual(await value(db, "select public.public_link_lookup_v1($1, 'https://staging.op4n.me')", [CODE]), { kind: "unavailable" });
  assert.equal((await moderate(db, "disable", "1")).kind, "replayed");
  assert.equal((await moderate(db, "disable", "1", "abuse_report", "b".repeat(64))).kind, "conflict");
  assert.equal((await moderate(db, "disable", "2")).kind, "unchanged");
  const restored = await moderate(db, "restore", "3", "operator_correction");
  assert.deepEqual(restored, { kind: "changed", canonicalCode: CODE, lifecycleState: "active" });
  assert.equal((await resolve(db, CODE)).decision, "redirect");
  assert.equal((await value(db, "select public.public_link_lookup_v1($1, 'https://staging.op4n.me')", [CODE])).kind, "card");
  const history = (await value(db, "select public.admin_link_record_v1($1)", [CODE])).history;
  assert.deepEqual(history.map((entry) => [entry.actionType, entry.reasonCode]), [["restore", "operator_correction"], ["disable", "abuse_report"]]);
});

test("restore is refused while safety is pending or blocked", async () => {
  const db = await database();
  await createLink(db);
  await moderate(db, "disable", "1");
  await db.exec("update public.canonical_links set safety_state = 'blocked'");
  assert.deepEqual(await moderate(db, "restore", "2", "operator_correction"), { kind: "safety_conflict", safetyState: "blocked" });
  assert.equal((await resolve(db, CODE)).decision, "disabled");
  assert.equal(Number(await value(db, "select count(*) from public.moderation_actions where action_type = 'restore'")), 0);
});

// ── Public discovery (Orders 61-63, 65, 72, 76, 78) ─────────────────────
const BASE = "https://staging.op4n.me";
let keySeq = 0;

async function createV2(db, code, { discovery = "eligible", title = "T", path = "/docs", display = "/docs" } = {}) {
  keySeq += 1;
  const key = keySeq.toString(16).padStart(64, "0");
  const reservation = await value(db, "select public.begin_creation_idempotency_v1('staging','createGuestCanonicalLink',$1,$2)", [key, "b".repeat(64)]);
  const created = await value(db,
    `select public.create_guest_link_v2('staging','createGuestCanonicalLink',$1,$2,$3,$4,$5,
      'https://example.com/docs?token=SECRET#frag','https://example.com',$6,$7,$8,'HMAC-SHA-256','v1',
      'r1-safe-path-v1',$9,'r1-discovery-v1',$10)`,
    [key, "b".repeat(64), reservation.reservationToken, code, title, path, display, key, discovery, BASE]);
  assert.equal(created.kind, "created");
  return created.response;
}
const list = async (db, limit = 100) => (await value(db, "select public.list_public_links_v1($1, $2)", [BASE, limit])).items;
const lookup = (db, code) => value(db, "select public.public_link_lookup_v1($1, $2)", [code, BASE]);
const CARD_FIELDS = ["aggregateTotalClicks", "canonicalCode", "canonicalOpenUrl", "canonicalShortUrl", "displayTitle", "safeDestinationSummary"];

test("creation v2 stores the safe summary and discovery result and returns six card fields plus publicDiscovery", async () => {
  const db = await database();
  const response = await createV2(db, "Pub0000001", { path: "/docs", display: "/docs?…" });
  assert.deepEqual(Object.keys(response).sort(), [...CARD_FIELDS, "publicDiscovery"].sort());
  assert.equal(response.publicDiscovery, "eligible");
  assert.deepEqual(response.safeDestinationSummary, { origin: "https://example.com", path: "/docs", displayValue: "https://example.com/docs?…" });
  assert.doesNotMatch(JSON.stringify(response), /SECRET|frag|token/);
  const withheld = await createV2(db, "Wit0000001", { discovery: "withheld", path: "/…", display: "/…" });
  assert.equal(withheld.publicDiscovery, "withheld");
  assert.equal(await value(db, "select discovery_policy_version from public.canonical_links cl join public.issued_codes ic on ic.id = cl.issued_code_id where canonical_code = 'Wit0000001'"), "r1-discovery-v1");
  await assert.rejects(db.query("update public.protected_destination_versions set safe_destination_display_path = '/x'"), /immutable/);
  await assert.rejects(createV2(db, "Bad0000001", { display: "/a?b" }));
});

test("the public projection includes only active, approved, public, discoverable links without open S1", async () => {
  const db = await database();
  for (const code of ["Ok00000001", "Dis0000001", "Del0000001", "Pen0000001", "Blk0000001", "S1o0000001", "S2o0000001"]) await createV2(db, code);
  await createV2(db, "Wit0000001", { discovery: "withheld" });
  await createV2(db, "Ovr0000001", { discovery: "withheld" });
  await createV2(db, "Ovw0000001");
  const set = (code, assignment) => db.query(`update public.canonical_links set ${assignment} where issued_code_id = (select id from public.issued_codes where canonical_code = $1)`, [code]);
  await set("Dis0000001", "lifecycle_state = 'disabled', disabled_at = now()");
  await set("Del0000001", "lifecycle_state = 'deleted', deleted_at = now()");
  await set("Pen0000001", "safety_state = 'pending'");
  await set("Blk0000001", "safety_state = 'blocked'");
  const report = (code, reason, n) => value(db, "select public.submit_report_v1('staging',$1,$2,$3,$4,null)", [code, n.repeat(64), n.repeat(64), reason]);
  await report("S1o0000001", "phishing", "1");
  await report("S2o0000001", "spam", "2");
  await value(db, "select public.admin_set_discovery_v1('Ovr0000001','eligible','founder:t','reviewed false positive')");
  await value(db, "select public.admin_set_discovery_v1('Ovw0000001','withheld','founder:t','contains a private document')");

  const codes = (await list(db)).map((card) => card.canonicalCode);
  assert.deepEqual(codes.sort(), ["Ok00000001", "Ovr0000001", "S2o0000001"].sort());
  for (const card of await list(db)) assert.deepEqual(Object.keys(card).sort(), CARD_FIELDS);

  assert.equal((await lookup(db, "Ok00000001")).kind, "card");
  for (const code of ["Dis0000001", "Del0000001", "Pen0000001", "Blk0000001"]) {
    assert.deepEqual(await lookup(db, code), { kind: "unavailable" }, code);
  }
  for (const code of ["Wit0000001", "S1o0000001", "Ovw0000001", "Unknown001", "bad code"]) {
    assert.deepEqual(await lookup(db, code), { kind: "not_found" }, code);
  }
  await assert.rejects(db.query("select public.list_public_links_v1('https://evil.example', 10)"), /base URL/);

  // Removing eligibility takes effect on the next query.
  await set("Ok00000001", "safety_state = 'blocked'");
  assert.ok(!(await list(db)).some((card) => card.canonicalCode === "Ok00000001"));
  const history = (await value(db, "select public.admin_link_record_v1('Ovr0000001')")).history;
  assert.deepEqual(history.map((entry) => entry.actionType), ["discovery_override"]);
  assert.match(history[0].reasonDetail, /^discovery eligible: reviewed/);
  assert.equal((await value(db, "select public.admin_set_discovery_v1('Ovr0000001','eligible','founder:t','again')")).kind, "unchanged");
});

test("Latest Links is newest first, bounded to 100, and counts clicks", async () => {
  const db = await database();
  for (let index = 0; index < 103; index += 1) await createV2(db, `L${String(index).padStart(9, "0")}`, { title: `Link ${index}` });
  // PGlite timestamps can tie; give each link a distinct creation time.
  await db.exec(`alter table public.canonical_links disable trigger canonical_links_identity_immutable;
    update public.canonical_links cl set created_at = now() - ((200 - substr(ic.canonical_code, 2)::int) || ' seconds')::interval
    from public.issued_codes ic where ic.id = cl.issued_code_id;
    alter table public.canonical_links enable trigger canonical_links_identity_immutable;`);
  const items = await list(db, 500);
  assert.equal(items.length, 100);
  assert.equal(items[0].canonicalCode, "L000000102");
  assert.equal(items[99].canonicalCode, "L000000003");
  assert.equal((await list(db, 5)).length, 5);
  await value(db, "select public.record_click_v1($1,'L000000102',1,now())", [EVENT_A]);
  assert.equal((await list(db, 1))[0].aggregateTotalClicks, 1);
});

test("browser roles cannot read base tables or call the public discovery functions", async () => {
  const db = await database();
  await createV2(db, "Ok00000001");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const statement of [
      "select * from public.canonical_links",
      "select * from public.protected_destination_versions",
      "select public.list_public_links_v1('https://staging.op4n.me', 10)",
      "select public.public_link_lookup_v1('Ok00000001', 'https://staging.op4n.me')",
      "select public.admin_set_discovery_v1('Ok00000001','eligible','x','y')",
    ]) {
      await assert.rejects(db.query(statement), /permission denied/, `${role}: ${statement}`);
    }
    await db.exec("reset role");
  }
});

test("Latest Links uses the partial index with 10,000 links", async () => {
  const db = await database();
  await db.exec(`
    insert into public.issued_codes (id, canonical_code)
      select gen_random_uuid(), 'X' || lpad(g::text, 9, '0') from generate_series(1, 10000) g;
    set constraints all deferred;
    with codes as (select id, canonical_code from public.issued_codes where canonical_code like 'X%'),
    links as (
      insert into public.canonical_links (id, issued_code_id, title, lifecycle_state, safety_state, discovery_state, visibility, current_destination_id, created_at)
      select gen_random_uuid(), id, 'Seed', case when random() < 0.1 then 'disabled' else 'active' end, 'approved', 'eligible', 'public', gen_random_uuid(),
        now() - (substr(canonical_code, 2)::int || ' seconds')::interval
      from codes returning id, current_destination_id)
    insert into public.protected_destination_versions (id, link_id, version_number, full_destination_url, destination_fingerprint,
      fingerprint_algorithm, fingerprint_key_version, safe_destination_origin, summary_policy_version)
    select current_destination_id, id, 1, 'https://example.com/', md5(id::text), 'HMAC-SHA-256', 'v1', 'https://example.com', 'r1-safe-path-v1' from links;
    analyze;
  `);
  await db.exec("set enable_seqscan = off");
  const plan = (await db.query(`explain select cl.id from public.canonical_links cl
    where cl.lifecycle_state = 'active' and cl.safety_state = 'approved' and cl.visibility = 'public'
    order by cl.created_at desc limit 100`)).rows.map((row) => Object.values(row)[0]).join("\n");
  assert.match(plan, /canonical_links_public_latest_idx/);
  await db.exec("reset enable_seqscan");
  const durations = [];
  for (let run = 0; run < 20; run += 1) {
    const started = performance.now();
    assert.equal((await list(db)).length, 100);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  console.log(`latest-100 PGlite p95 ${p95.toFixed(1)} ms over 10,000 links`);
  assert.ok(p95 < 300, `p95 ${p95} ms`);
});

test("public-search allows 300 lookups per identity per day and rejects the 301st", async () => {
  const db = await database();
  const windows = JSON.stringify([{ seconds: 86400, limit: 300 }]);
  const consume = () => value(db, "select public.consume_rate_limit_v1('staging','public-search',$1,$2::jsonb)", ["e".repeat(64), windows]);
  for (let attempt = 1; attempt <= 300; attempt += 1) {
    assert.equal((await consume()).decision, "allowed", `lookup ${attempt}`);
  }
  const rejected = await consume();
  assert.equal(rejected.decision, "limited");
  assert.ok(rejected.retryAfter >= 1);
});

test("the synthetic link redirects, is never counted, and is never discoverable", async () => {
  const db = await database();
  const ensure = () => value(db, "select public.ensure_synthetic_link_v1('SYNTHETIC1','https://staging.op4n.com/?monitor=synthetic','https://staging.op4n.com',$1)", ["9".repeat(64)]);
  assert.equal((await ensure()).kind, "created");
  assert.equal((await ensure()).kind, "exists");
  assert.equal((await resolve(db, "SYNTHETIC1")).decision, "redirect");
  assert.equal((await record(db, EVENT_A, "SYNTHETIC1")).kind, "accepted");
  assert.equal(Number(await value(db, "select count(*) from public.click_aggregates")), 0, "no click counted");
  assert.equal(Number(await value(db, "select count(*) from public.click_events")), 0);
  assert.deepEqual(await value(db, "select public.public_link_lookup_v1('SYNTHETIC1','https://staging.op4n.me')"), { kind: "not_found" });
  assert.deepEqual(await value(db, "select public.list_public_links_v1('https://staging.op4n.me', 100)"), { items: [] });
  assert.deepEqual(await value(db, "select public.health_readiness_v1()"), { database: true, schema: true });
  await createLink(db);
  await assert.rejects(value(db, "select public.ensure_synthetic_link_v1($1,'https://staging.op4n.com/','https://staging.op4n.com',$2)", [CODE, "8".repeat(64)]), /already used/);
});
