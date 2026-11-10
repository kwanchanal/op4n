import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/202611090001_create_guest_link_slice.sql",
  import.meta.url,
);
const sql = await readFile(migrationUrl, "utf8");

test("migration is one forward transaction with minimum creation records", () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  for (const table of [
    "issued_codes",
    "canonical_links",
    "protected_destination_versions",
    "creation_idempotency",
    "creation_audit_events",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`));
  }
  assert.doesNotMatch(sql, /create table public\.(click|report|moderation|account|alias)/i);
});

test("migration declares code, ownership, destination, and idempotency invariants", () => {
  for (const invariant of [
    "issued_codes_canonical_code_key",
    "canonical_links_guest_has_no_owner",
    "protected_destination_link_version_key",
    "protected_destination_link_id_key",
    "canonical_links_owned_current_destination_fkey",
    "creation_idempotency_scope_key",
    "creation_idempotency_retention",
  ]) {
    assert.match(sql, new RegExp(invariant));
  }
  assert.match(sql, /version_number = 1/);
  assert.match(sql, /expires_at >= created_at \+ interval '24 hours'/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /interval '5 minutes'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /reservation_token text/);
  assert.match(sql, /encode\(gen_random_bytes\(32\), 'hex'\)/);
  assert.match(sql, /'reservationToken', next_reservation_token/);
  assert.match(sql, /existing\.reservation_token <> p_reservation_token/);
  assert.match(sql, /and reservation_token = p_reservation_token/);
  assert.match(sql, /begin_creation_idempotency_v1/);
  assert.match(sql, /release_creation_idempotency_v1/);
  assert.match(sql, /issued_codes_immutable/);
  assert.match(sql, /canonical_links_identity_immutable/);
  assert.match(sql, /protected_destination_identity_immutable/);
  assert.match(sql, /creation_audit_append_only/);
});

test("protected records enable RLS and deny browser roles", () => {
  for (const table of [
    "issued_codes",
    "canonical_links",
    "protected_destination_versions",
    "creation_idempotency",
    "creation_audit_events",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  }
  assert.doesNotMatch(sql, /grant\s+(select|insert|update|delete).*to\s+(anon|authenticated)/i);
});

test("transactional RPC returns only the six-field public projection", () => {
  for (const field of [
    "canonicalCode",
    "displayTitle",
    "canonicalShortUrl",
    "canonicalOpenUrl",
    "safeDestinationSummary",
    "aggregateTotalClicks",
  ]) {
    assert.match(sql, new RegExp(`'${field}'`));
  }
  const responseSection = sql.slice(sql.indexOf("public_response := jsonb_build_object"));
  assert.doesNotMatch(responseSection, /'fullDestinationUrl'|'destinationFingerprint'|'linkId'/);
});
