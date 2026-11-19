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
  ]) {
    const sql = await migration(name);
    assert.match(sql, new RegExp(`cron\\.schedule\\(\\s*'${job}'`));
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
