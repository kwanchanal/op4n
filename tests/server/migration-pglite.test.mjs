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
  const second = await migration("202611190001_redirect_lookup_and_clicks.sql");
  assert.match(second, /cron\.schedule\(\s*'op4n_purge_expired_click_events'/);
  await db.exec(second.replace(/-- Daily retention job[\s\S]*?(?=commit;)/, ""));
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
