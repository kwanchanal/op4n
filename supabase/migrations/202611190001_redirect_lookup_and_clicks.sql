begin;

-- R1 redirect lookup, click events, and click aggregates.
-- Feature Inventory: Short code lookup, canonical link tombstones, Click event
-- recording, Define analytics data minimization and retention.
-- Click events hold link identity, destination version, event identity, and
-- timestamps only: no IP, user-agent, referrer, device, or location.

create table public.click_aggregates (
  link_id uuid primary key references public.canonical_links(id) on delete restrict,
  total_clicks bigint not null default 0 check (total_clicks >= 0),
  aggregate_version bigint not null default 0 check (aggregate_version >= 0),
  last_event_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.click_events (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  destination_version_id uuid not null
    references public.protected_destination_versions(id) on delete restrict,
  ingestion_key uuid not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  counted_aggregate_version bigint not null check (counted_aggregate_version >= 1),
  constraint click_events_ingestion_key_key unique (ingestion_key)
);

create index click_events_recorded_at_idx on public.click_events (recorded_at);

alter table public.click_aggregates enable row level security;
alter table public.click_events enable row level security;
revoke all on public.click_aggregates from anon, authenticated;
revoke all on public.click_events from anon, authenticated;

-- Aggregates never decrease; events are immutable until restricted retention.
create or replace function public.guard_click_aggregate_monotonic()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'click aggregates are permanent' using errcode = '23000';
  end if;
  if new.total_clicks < old.total_clicks or new.aggregate_version < old.aggregate_version or
     new.link_id <> old.link_id then
    raise exception 'click aggregates are monotonic' using errcode = '23000';
  end if;
  return new;
end;
$$;

create trigger click_aggregates_monotonic
before update or delete on public.click_aggregates
for each row execute function public.guard_click_aggregate_monotonic();

create or replace function public.guard_click_event_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'click events are immutable' using errcode = '23000';
  end if;
  if current_setting('op4n.click_retention', true) is distinct from 'on' then
    raise exception 'click events are deleted only by retention' using errcode = '23000';
  end if;
  return old;
end;
$$;

create trigger click_events_immutable
before update or delete on public.click_events
for each row execute function public.guard_click_event_immutability();

-- One exact, case-sensitive lookup. Only an issued code whose link is active,
-- safety-approved, and has its current destination returns `redirect`.
-- Any other known code is `disabled`; an unissued or malformed code is `unknown`.
create or replace function public.resolve_canonical_redirect_v1(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  code_row public.issued_codes%rowtype;
  link_row public.canonical_links%rowtype;
  destination_row public.protected_destination_versions%rowtype;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{6,32}$' then
    return jsonb_build_object('decision', 'unknown');
  end if;

  select * into code_row from public.issued_codes where canonical_code = p_code;
  if not found then
    return jsonb_build_object('decision', 'unknown', 'canonicalCode', p_code);
  end if;

  select * into link_row from public.canonical_links where issued_code_id = code_row.id;
  if not found then
    return jsonb_build_object('decision', 'disabled', 'canonicalCode', p_code);
  end if;

  select * into destination_row
  from public.protected_destination_versions
  where id = link_row.current_destination_id
    and link_id = link_row.id
    and superseded_at is null;

  if code_row.status <> 'issued' or
     link_row.lifecycle_state <> 'active' or
     link_row.safety_state <> 'approved' or
     destination_row.id is null or
     destination_row.full_destination_url !~ '^https?://' then
    return jsonb_build_object('decision', 'disabled', 'canonicalCode', p_code);
  end if;

  return jsonb_build_object(
    'decision', 'redirect',
    'canonicalCode', p_code,
    'fullDestinationUrl', destination_row.full_destination_url,
    'destinationVersion', destination_row.version_number,
    'destinationFingerprint', destination_row.destination_fingerprint,
    'cacheControl', 'no-store',
    'redirectStatus', 302
  );
end;
$$;

-- Records one deduplicated click and increments the aggregate in one
-- transaction. A replayed eventId with the same payload is accepted without
-- counting again; a changed payload is a conflict.
create or replace function public.record_click_v1(
  p_event_id uuid,
  p_code text,
  p_destination_version integer,
  p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing public.click_events%rowtype;
  code_row public.issued_codes%rowtype;
  link_row public.canonical_links%rowtype;
  destination_row public.protected_destination_versions%rowtype;
  next_version bigint;
  recorded timestamptz;
begin
  if p_event_id is null or p_code is null or p_code !~ '^[A-Za-z0-9]{6,32}$' or
     p_destination_version is distinct from 1 or p_occurred_at is null then
    return jsonb_build_object('kind', 'invalid');
  end if;
  if p_occurred_at > clock_timestamp() + interval '5 minutes' or
     p_occurred_at < clock_timestamp() - interval '1 hour' then
    return jsonb_build_object('kind', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  select * into code_row from public.issued_codes where canonical_code = p_code;
  if not found then
    return jsonb_build_object('kind', 'invalid');
  end if;
  select * into link_row from public.canonical_links where issued_code_id = code_row.id;
  if not found then
    return jsonb_build_object('kind', 'invalid');
  end if;
  select * into destination_row from public.protected_destination_versions
  where link_id = link_row.id and version_number = p_destination_version;
  if not found then
    return jsonb_build_object('kind', 'invalid');
  end if;

  select * into existing from public.click_events where ingestion_key = p_event_id;
  if found then
    if existing.link_id = link_row.id and existing.destination_version_id = destination_row.id then
      return jsonb_build_object('kind', 'replayed', 'recordedAt', existing.recorded_at);
    end if;
    return jsonb_build_object('kind', 'conflict');
  end if;

  insert into public.click_aggregates (link_id, total_clicks, aggregate_version, last_event_at)
  values (link_row.id, 1, 1, p_occurred_at)
  on conflict (link_id) do update
    set total_clicks = public.click_aggregates.total_clicks + 1,
        aggregate_version = public.click_aggregates.aggregate_version + 1,
        last_event_at = greatest(public.click_aggregates.last_event_at, excluded.last_event_at),
        updated_at = clock_timestamp()
  returning aggregate_version into next_version;

  insert into public.click_events (
    link_id, destination_version_id, ingestion_key, occurred_at, counted_aggregate_version
  ) values (
    link_row.id, destination_row.id, p_event_id, p_occurred_at, next_version
  ) returning recorded_at into recorded;

  return jsonb_build_object('kind', 'accepted', 'recordedAt', recorded);
end;
$$;

-- Restricted retention: deletes only events older than 30 days whose count is
-- already included in the link aggregate. total_clicks never decreases.
create or replace function public.purge_expired_click_events_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removed integer;
begin
  perform set_config('op4n.click_retention', 'on', true);
  delete from public.click_events event
  using public.click_aggregates aggregate
  where aggregate.link_id = event.link_id
    and event.recorded_at < clock_timestamp() - interval '30 days'
    and event.counted_aggregate_version <= aggregate.aggregate_version;
  get diagnostics removed = row_count;
  perform set_config('op4n.click_retention', 'off', true);
  return removed;
end;
$$;

revoke all on function public.resolve_canonical_redirect_v1(text) from public, anon, authenticated;
revoke all on function public.record_click_v1(uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.purge_expired_click_events_v1() from public, anon, authenticated;
grant execute on function public.resolve_canonical_redirect_v1(text) to service_role;
grant execute on function public.record_click_v1(uuid, text, integer, timestamptz) to service_role;
grant execute on function public.purge_expired_click_events_v1() to service_role;

-- Daily retention job (pg_cron is available on Supabase projects).
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'op4n_purge_expired_click_events';
select cron.schedule(
  'op4n_purge_expired_click_events',
  '17 3 * * *',
  'select public.purge_expired_click_events_v1();'
);

commit;
