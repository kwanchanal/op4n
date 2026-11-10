begin;

create extension if not exists pgcrypto with schema extensions;

create table public.issued_codes (
  id uuid primary key default gen_random_uuid(),
  canonical_code text not null,
  status text not null default 'issued' check (status in ('issued', 'retired')),
  issued_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  constraint issued_codes_canonical_code_key unique (canonical_code),
  constraint issued_codes_code_profile check (
    canonical_code ~ '^[A-Za-z0-9]{10}$'
  ),
  constraint issued_codes_retirement_state check (
    (status = 'issued' and retired_at is null) or
    (status = 'retired' and retired_at is not null)
  )
);

create table public.canonical_links (
  id uuid primary key default gen_random_uuid(),
  issued_code_id uuid not null unique
    references public.issued_codes(id) on delete restrict,
  creator_kind text not null default 'guest' check (creator_kind = 'guest'),
  owner_id uuid,
  title text check (title is null or char_length(title) <= 200),
  lifecycle_state text not null check (lifecycle_state in ('active', 'disabled', 'deleted')),
  safety_state text not null check (safety_state in ('pending', 'approved', 'blocked')),
  discovery_state text not null check (discovery_state in ('eligible', 'withheld')),
  visibility text not null check (visibility = 'public'),
  current_destination_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  deleted_at timestamptz,
  constraint canonical_links_guest_has_no_owner check (
    creator_kind <> 'guest' or owner_id is null
  ),
  constraint canonical_links_id_destination_unique unique (id, current_destination_id)
);

create table public.protected_destination_versions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  version_number integer not null check (version_number = 1),
  full_destination_url text not null check (
    char_length(full_destination_url) between 1 and 2048 and
    full_destination_url ~ '^https?://'
  ),
  destination_fingerprint text not null,
  fingerprint_algorithm text not null check (fingerprint_algorithm = 'HMAC-SHA-256'),
  fingerprint_key_version text not null check (char_length(fingerprint_key_version) between 1 and 64),
  safe_destination_origin text not null check (
    safe_destination_origin ~ '^https?://[^/?#]+$' and
    safe_destination_origin !~ '@'
  ),
  summary_policy_version text not null check (summary_policy_version = 'r1-origin-only-v1'),
  created_at timestamptz not null default clock_timestamp(),
  superseded_at timestamptz,
  constraint protected_destination_link_version_key unique (link_id, version_number),
  constraint protected_destination_link_id_key unique (link_id, id),
  constraint protected_destination_r1_not_superseded check (superseded_at is null)
);

alter table public.canonical_links
  add constraint canonical_links_owned_current_destination_fkey
  foreign key (id, current_destination_id)
  references public.protected_destination_versions(link_id, id)
  on delete restrict
  deferrable initially deferred;

create table public.creation_idempotency (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('local', 'staging', 'production')),
  operation text not null check (operation = 'createGuestCanonicalLink'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  reservation_token text,
  status text not null check (status in ('in_progress', 'succeeded')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  lease_expires_at timestamptz,
  expires_at timestamptz not null,
  constraint creation_idempotency_scope_key unique (environment, operation, key_hash),
  constraint creation_idempotency_retention check (
    expires_at >= created_at + interval '24 hours'
  ),
  constraint creation_idempotency_terminal_shape check (
    (status = 'in_progress' and reservation_token ~ '^[0-9a-f]{64}$' and
      response_status is null and response_body is null and
      completed_at is null and lease_expires_at is not null) or
    (status = 'succeeded' and response_status = 201 and response_body is not null and
      completed_at is not null and lease_expires_at is null and reservation_token is null)
  )
);

create table public.creation_audit_events (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('local', 'staging', 'production')),
  event_type text not null check (event_type = 'guest_link_created'),
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  issued_code_id uuid not null references public.issued_codes(id) on delete restrict,
  destination_version_id uuid not null references public.protected_destination_versions(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.issued_codes enable row level security;
alter table public.canonical_links enable row level security;
alter table public.protected_destination_versions enable row level security;
alter table public.creation_idempotency enable row level security;
alter table public.creation_audit_events enable row level security;

revoke all on public.issued_codes from anon, authenticated;
revoke all on public.canonical_links from anon, authenticated;
revoke all on public.protected_destination_versions from anon, authenticated;
revoke all on public.creation_idempotency from anon, authenticated;
revoke all on public.creation_audit_events from anon, authenticated;

create or replace function public.guard_issued_code_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'issued codes are permanent' using errcode = '23000';
  end if;
  if new.id <> old.id or new.canonical_code <> old.canonical_code or
     new.issued_at <> old.issued_at or
     (old.status = 'retired' and new.status <> 'retired') then
    raise exception 'issued code identity is immutable' using errcode = '23000';
  end if;
  return new;
end;
$$;

create trigger issued_codes_immutable
before update or delete on public.issued_codes
for each row execute function public.guard_issued_code_immutability();

create or replace function public.guard_guest_link_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'canonical links use lifecycle deletion' using errcode = '23000';
  end if;
  if new.id <> old.id or new.issued_code_id <> old.issued_code_id or
     new.creator_kind <> old.creator_kind or new.owner_id is distinct from old.owner_id or
     new.visibility <> old.visibility or
     new.current_destination_id <> old.current_destination_id or
     new.created_at <> old.created_at then
    raise exception 'guest link routing identity is immutable' using errcode = '23000';
  end if;
  return new;
end;
$$;

create trigger canonical_links_identity_immutable
before update or delete on public.canonical_links
for each row execute function public.guard_guest_link_identity();

create or replace function public.guard_destination_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'destination versions cannot be deleted' using errcode = '23000';
  end if;
  if new.id <> old.id or new.link_id <> old.link_id or
     new.version_number <> old.version_number or
     new.full_destination_url <> old.full_destination_url or
     new.safe_destination_origin <> old.safe_destination_origin or
     new.summary_policy_version <> old.summary_policy_version or
     new.created_at <> old.created_at then
    raise exception 'destination routing identity is immutable' using errcode = '23000';
  end if;
  return new;
end;
$$;

create trigger protected_destination_identity_immutable
before update or delete on public.protected_destination_versions
for each row execute function public.guard_destination_identity();

create or replace function public.guard_creation_audit_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'creation audit events are append-only' using errcode = '23000';
end;
$$;

create trigger creation_audit_append_only
before update or delete on public.creation_audit_events
for each row execute function public.guard_creation_audit_append_only();

create or replace function public.begin_creation_idempotency_v1(
  p_environment text,
  p_operation text,
  p_key_hash text,
  p_payload_digest text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  existing public.creation_idempotency%rowtype;
  next_reservation_token text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_environment || ':' || p_operation || ':' || p_key_hash,
    0
  ));

  select * into existing
  from public.creation_idempotency
  where environment = p_environment
    and operation = p_operation
    and key_hash = p_key_hash
  for update;

  if found and existing.expires_at > clock_timestamp() then
    if existing.payload_digest <> p_payload_digest then
      return jsonb_build_object('kind', 'conflict');
    end if;
    if existing.status = 'succeeded' then
      return jsonb_build_object('kind', 'replayed', 'response', existing.response_body);
    end if;
    if existing.lease_expires_at > clock_timestamp() then
      return jsonb_build_object('kind', 'in_progress');
    end if;
  end if;

  if found then
    delete from public.creation_idempotency where id = existing.id;
  end if;

  next_reservation_token := encode(gen_random_bytes(32), 'hex');
  insert into public.creation_idempotency (
    environment, operation, key_hash, payload_digest, reservation_token,
    status, lease_expires_at, expires_at
  ) values (
    p_environment, p_operation, p_key_hash, p_payload_digest, next_reservation_token,
    'in_progress',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp() + interval '24 hours'
  );

  return jsonb_build_object(
    'kind', 'reserved',
    'reservationToken', next_reservation_token
  );
end;
$$;

create or replace function public.release_creation_idempotency_v1(
  p_environment text,
  p_operation text,
  p_key_hash text,
  p_payload_digest text,
  p_reservation_token text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.creation_idempotency
  where environment = p_environment
    and operation = p_operation
    and key_hash = p_key_hash
    and payload_digest = p_payload_digest
    and reservation_token = p_reservation_token
    and status = 'in_progress';
  return jsonb_build_object('kind', 'released');
end;
$$;

create or replace function public.create_guest_link_v1(
  p_environment text,
  p_operation text,
  p_key_hash text,
  p_payload_digest text,
  p_reservation_token text,
  p_candidate_code text,
  p_title text,
  p_full_destination_url text,
  p_safe_origin text,
  p_destination_fingerprint text,
  p_fingerprint_algorithm text,
  p_fingerprint_key_version text,
  p_summary_policy_version text,
  p_canonical_base_url text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  existing public.creation_idempotency%rowtype;
  issued_id uuid := gen_random_uuid();
  link_id uuid := gen_random_uuid();
  destination_id uuid := gen_random_uuid();
  audit_id uuid := gen_random_uuid();
  public_response jsonb;
begin
  if p_environment not in ('local', 'staging', 'production') or
     p_operation <> 'createGuestCanonicalLink' then
    raise exception 'invalid creation scope' using errcode = '22023';
  end if;

  select * into existing
  from public.creation_idempotency
  where environment = p_environment
    and operation = p_operation
    and key_hash = p_key_hash
  for update;

  if not found or existing.status <> 'in_progress' or
     existing.payload_digest <> p_payload_digest or
     existing.reservation_token <> p_reservation_token or
     existing.expires_at <= clock_timestamp() then
    raise exception 'missing or invalid idempotency reservation' using errcode = '22023';
  end if;

  insert into public.issued_codes (id, canonical_code)
  values (issued_id, p_candidate_code);

  set constraints canonical_links_owned_current_destination_fkey deferred;

  insert into public.canonical_links (
    id, issued_code_id, creator_kind, owner_id, title,
    lifecycle_state, safety_state, discovery_state, visibility,
    current_destination_id
  ) values (
    link_id, issued_id, 'guest', null, p_title,
    'active', 'approved', 'eligible', 'public',
    destination_id
  );

  insert into public.protected_destination_versions (
    id, link_id, version_number, full_destination_url,
    destination_fingerprint, fingerprint_algorithm, fingerprint_key_version,
    safe_destination_origin, summary_policy_version
  ) values (
    destination_id, link_id, 1, p_full_destination_url,
    p_destination_fingerprint, p_fingerprint_algorithm, p_fingerprint_key_version,
    p_safe_origin, p_summary_policy_version
  );

  insert into public.creation_audit_events (
    id, environment, event_type, link_id, issued_code_id, destination_version_id
  ) values (
    audit_id, p_environment, 'guest_link_created', link_id, issued_id, destination_id
  );

  public_response := jsonb_build_object(
    'canonicalCode', p_candidate_code,
    'displayTitle', coalesce(p_title, 'Untitled link'),
    'canonicalShortUrl', p_canonical_base_url || '/' || p_candidate_code,
    'canonicalOpenUrl', p_canonical_base_url || '/' || p_candidate_code,
    'safeDestinationSummary', jsonb_build_object(
      'origin', p_safe_origin,
      'displayValue', p_safe_origin
    ),
    'aggregateTotalClicks', 0
  );

  update public.creation_idempotency
  set status = 'succeeded',
      response_status = 201,
      response_body = public_response,
      completed_at = clock_timestamp(),
      lease_expires_at = null,
      reservation_token = null
  where environment = p_environment
    and operation = p_operation
    and key_hash = p_key_hash;

  return jsonb_build_object('kind', 'created', 'response', public_response);
end;
$$;

revoke all on function public.create_guest_link_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.begin_creation_idempotency_v1(
  text, text, text, text
) from public, anon, authenticated;
revoke all on function public.release_creation_idempotency_v1(
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_guest_link_v1(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.begin_creation_idempotency_v1(
  text, text, text, text
) to service_role;
grant execute on function public.release_creation_idempotency_v1(
  text, text, text, text, text
) to service_role;

commit;
