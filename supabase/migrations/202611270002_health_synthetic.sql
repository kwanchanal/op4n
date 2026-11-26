begin;

-- Health checks and the synthetic monitoring link (Feature Inventory Order 81).
-- A synthetic link redirects like any other link so external monitors test
-- the real path (DNS -> Worker -> lookup -> Postgres), but it is never counted
-- as a click and never appears in Latest Links or search.

alter table public.canonical_links add column synthetic boolean not null default false;

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
  -- Synthetic monitoring links (Order 81) are never counted.
  if link_row.synthetic then
    return jsonb_build_object('kind', 'accepted', 'recordedAt', clock_timestamp());
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

-- Creates the environment's synthetic link once. Idempotent.
create or replace function public.ensure_synthetic_link_v1(
  p_code text,
  p_destination text,
  p_origin text,
  p_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_issued uuid := gen_random_uuid();
  v_link uuid := gen_random_uuid();
  v_destination uuid := gen_random_uuid();
begin
  if p_code !~ '^[A-Za-z0-9]{10}$' or p_destination !~ '^https://' or p_origin !~ '^https://[^/?#]+$' then
    raise exception 'invalid synthetic link' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('synthetic:' || p_code, 0));
  if exists (
    select 1 from public.issued_codes ic join public.canonical_links cl on cl.issued_code_id = ic.id
    where ic.canonical_code = p_code and cl.synthetic
  ) then
    return jsonb_build_object('kind', 'exists');
  end if;
  if exists (select 1 from public.issued_codes where canonical_code = p_code) then
    raise exception 'synthetic code is already used by a real link' using errcode = '23505';
  end if;

  insert into public.issued_codes (id, canonical_code) values (v_issued, p_code);
  set constraints canonical_links_owned_current_destination_fkey deferred;
  insert into public.canonical_links (
    id, issued_code_id, creator_kind, title, lifecycle_state, safety_state, discovery_state,
    discovery_policy_version, discovery_override, visibility, current_destination_id, synthetic
  ) values (
    v_link, v_issued, 'guest', 'Synthetic monitor', 'active', 'approved', 'withheld',
    'synthetic', 'withheld', 'public', v_destination, true
  );
  insert into public.protected_destination_versions (
    id, link_id, version_number, full_destination_url, destination_fingerprint, fingerprint_algorithm,
    fingerprint_key_version, safe_destination_origin, summary_policy_version
  ) values (
    v_destination, v_link, 1, p_destination, p_fingerprint, 'HMAC-SHA-256', 'synthetic', p_origin, 'r1-safe-path-v1'
  );
  return jsonb_build_object('kind', 'created');
end;
$$;

-- Readiness probe: proves the database answers and the expected schema is in place.
create or replace function public.health_readiness_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'database', true,
    'schema',
      to_regprocedure('public.list_public_links_v1(text,integer)') is not null and
      to_regprocedure('public.ensure_synthetic_link_v1(text,text,text,text)') is not null and
      exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'canonical_links' and column_name = 'synthetic')
  );
$$;

revoke all on function public.ensure_synthetic_link_v1(text, text, text, text) from public, anon, authenticated;
revoke all on function public.health_readiness_v1() from public, anon, authenticated;
grant execute on function public.ensure_synthetic_link_v1(text, text, text, text) to service_role;
grant execute on function public.health_readiness_v1() to service_role;

commit;
