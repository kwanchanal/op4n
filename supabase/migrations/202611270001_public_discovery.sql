begin;

-- Public discovery (Feature Inventory Orders 61-63, 65, 72, 76, 78):
--   * safe destination summary r1-safe-path-v1 stored per destination version;
--   * discovery screening result + rule version stored per link at creation,
--     with an audited Admin override;
--   * one eligibility rule shared by Latest Links, the public card, and exact
--     lookup; each returns only the six PublicLinkCard fields.
-- All functions are service_role only; the Edge Function is the only caller.

-- ── Safe summary (Order 65) ─────────────────────────────────────────────
alter table public.protected_destination_versions
  drop constraint protected_destination_versions_summary_policy_version_check;
alter table public.protected_destination_versions
  add constraint protected_destination_versions_summary_policy_version_check
  check (summary_policy_version in ('r1-origin-only-v1', 'r1-safe-path-v1'));

alter table public.protected_destination_versions
  add column safe_destination_path text check (
    safe_destination_path is null or (
      char_length(safe_destination_path) <= 256 and
      safe_destination_path ~ '^/[^?#%@]*$'
    )
  ),
  add column safe_destination_display_path text not null default '' check (
    char_length(safe_destination_display_path) <= 256 and
    safe_destination_display_path ~ '^(/[^?#%@]*)?(\?…)?$'
  );

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
     new.safe_destination_path is distinct from old.safe_destination_path or
     new.safe_destination_display_path <> old.safe_destination_display_path or
     new.summary_policy_version <> old.summary_policy_version or
     new.created_at <> old.created_at then
    raise exception 'destination routing identity is immutable' using errcode = '23000';
  end if;
  return new;
end;
$$;

-- ── Discovery screening (Order 61) ──────────────────────────────────────
-- discovery_state is now only the screening result recorded at creation.
-- Disable/restore no longer touch it; lifecycle_state already removes a
-- disabled link from discovery. Existing rows predate screening.
alter table public.canonical_links
  add column discovery_policy_version text not null default 'r1-unscreened'
    check (char_length(discovery_policy_version) between 1 and 64),
  add column discovery_override text check (discovery_override in ('eligible', 'withheld'));

update public.canonical_links set discovery_state = 'eligible' where discovery_state = 'withheld';

alter table public.moderation_actions drop constraint moderation_actions_action_type_check;
alter table public.moderation_actions add constraint moderation_actions_action_type_check check (
  action_type in ('disable', 'restore', 'triage', 'resolve', 'note', 'reveal_destination', 'discovery_override')
);

-- Latest Links reads newest eligible rows through this partial index.
create index canonical_links_public_latest_idx
  on public.canonical_links (created_at desc)
  where lifecycle_state = 'active' and safety_state = 'approved' and visibility = 'public';

-- ── Shared eligibility and card shape (Orders 62, 65) ───────────────────
create or replace function public.assert_public_base_url(p_base_url text)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_base_url is null or p_base_url not in ('https://op4n.me', 'https://staging.op4n.me') then
    raise exception 'invalid canonical base URL' using errcode = '22023';
  end if;
end;
$$;

-- Eligible = active, approved, public, discovery eligible (override first),
-- code still issued, and no open S1 moderation case.
create or replace function public.link_is_publicly_discoverable(p_link_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.canonical_links cl
    join public.issued_codes ic on ic.id = cl.issued_code_id
    where cl.id = p_link_id
      and ic.status = 'issued'
      and cl.lifecycle_state = 'active'
      and cl.safety_state = 'approved'
      and cl.visibility = 'public'
      and coalesce(cl.discovery_override, cl.discovery_state) = 'eligible'
      and not exists (
        select 1 from public.moderation_cases mc
        where mc.link_id = cl.id and mc.case_state <> 'closed' and mc.priority = 'S1'
      )
  );
$$;

-- The only public card shape: exactly six fields.
create or replace function public.public_card_json_v1(p_link_id uuid, p_base_url text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'canonicalCode', ic.canonical_code,
    'displayTitle', coalesce(nullif(btrim(cl.title), ''), 'Untitled link'),
    'canonicalShortUrl', p_base_url || '/' || ic.canonical_code,
    'canonicalOpenUrl', p_base_url || '/' || ic.canonical_code,
    'safeDestinationSummary', jsonb_strip_nulls(jsonb_build_object(
      'origin', d.safe_destination_origin,
      'path', d.safe_destination_path,
      'displayValue', d.safe_destination_origin || d.safe_destination_display_path
    )),
    'aggregateTotalClicks', coalesce(ca.total_clicks, 0)
  )
  from public.canonical_links cl
  join public.issued_codes ic on ic.id = cl.issued_code_id
  join public.protected_destination_versions d on d.id = cl.current_destination_id
  left join public.click_aggregates ca on ca.link_id = cl.id
  where cl.id = p_link_id;
$$;

-- ── Latest 100 (Order 63) ───────────────────────────────────────────────
create or replace function public.list_public_links_v1(p_base_url text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_items jsonb;
begin
  perform public.assert_public_base_url(p_base_url);
  select coalesce(jsonb_agg(public.public_card_json_v1(page.id, p_base_url) order by page.created_at desc, page.id desc), '[]'::jsonb)
  into v_items
  from (
    select cl.id, cl.created_at
    from public.canonical_links cl
    join public.issued_codes ic on ic.id = cl.issued_code_id
    where cl.lifecycle_state = 'active'
      and cl.safety_state = 'approved'
      and cl.visibility = 'public'
      and coalesce(cl.discovery_override, cl.discovery_state) = 'eligible'
      and ic.status = 'issued'
      and not exists (
        select 1 from public.moderation_cases mc
        where mc.link_id = cl.id and mc.case_state <> 'closed' and mc.priority = 'S1'
      )
    order by cl.created_at desc, cl.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 100))
  ) page;
  return jsonb_build_object('items', v_items);
end;
$$;

-- ── Card route and exact lookup (Orders 62, 72, 76, 78) ─────────────────
-- kind = card | not_found | unavailable.
--   not_found:   unknown code, or an active link that is not discoverable
--                (withheld, open S1, non-public). Identical to unknown.
--   unavailable: a known code that is disabled, deleted, blocked, pending,
--                or retired. Carries no card fields.
create or replace function public.public_link_lookup_v1(p_code text, p_base_url text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_code public.issued_codes%rowtype;
  v_link public.canonical_links%rowtype;
begin
  perform public.assert_public_base_url(p_base_url);
  if p_code is null or p_code !~ '^[A-Za-z0-9]{6,32}$' then
    return jsonb_build_object('kind', 'not_found');
  end if;
  select * into v_code from public.issued_codes where canonical_code = p_code;
  if not found then
    return jsonb_build_object('kind', 'not_found');
  end if;
  select * into v_link from public.canonical_links where issued_code_id = v_code.id;
  if not found or v_code.status <> 'issued' or v_link.lifecycle_state <> 'active' or v_link.safety_state <> 'approved' then
    return jsonb_build_object('kind', 'unavailable');
  end if;
  if not public.link_is_publicly_discoverable(v_link.id) then
    return jsonb_build_object('kind', 'not_found');
  end if;
  return jsonb_build_object('kind', 'card', 'card', public.public_card_json_v1(v_link.id, p_base_url));
end;
$$;

-- ── Creation v2: stores the safe summary and the discovery result ──────
create or replace function public.create_guest_link_v2(
  p_environment text,
  p_operation text,
  p_key_hash text,
  p_payload_digest text,
  p_reservation_token text,
  p_candidate_code text,
  p_title text,
  p_full_destination_url text,
  p_safe_origin text,
  p_safe_path text,
  p_safe_display_path text,
  p_destination_fingerprint text,
  p_fingerprint_algorithm text,
  p_fingerprint_key_version text,
  p_summary_policy_version text,
  p_discovery_state text,
  p_discovery_policy_version text,
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
  if p_discovery_state not in ('eligible', 'withheld') then
    raise exception 'invalid discovery state' using errcode = '22023';
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
    lifecycle_state, safety_state, discovery_state, discovery_policy_version, visibility,
    current_destination_id
  ) values (
    link_id, issued_id, 'guest', null, p_title,
    'active', 'approved', p_discovery_state, p_discovery_policy_version, 'public',
    destination_id
  );

  insert into public.protected_destination_versions (
    id, link_id, version_number, full_destination_url,
    destination_fingerprint, fingerprint_algorithm, fingerprint_key_version,
    safe_destination_origin, safe_destination_path, safe_destination_display_path,
    summary_policy_version
  ) values (
    destination_id, link_id, 1, p_full_destination_url,
    p_destination_fingerprint, p_fingerprint_algorithm, p_fingerprint_key_version,
    p_safe_origin, p_safe_path, coalesce(p_safe_display_path, ''),
    p_summary_policy_version
  );

  insert into public.creation_audit_events (
    id, environment, event_type, link_id, issued_code_id, destination_version_id
  ) values (
    audit_id, p_environment, 'guest_link_created', link_id, issued_id, destination_id
  );

  public_response := public.public_card_json_v1(link_id, p_canonical_base_url) ||
    jsonb_build_object('publicDiscovery', p_discovery_state);

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

-- ── Admin: discovery override (Order 61 AC5) and record fields ─────────
-- decision = eligible | withheld | policy (clear the override).
create or replace function public.admin_set_discovery_v1(p_code text, p_decision text, p_actor text, p_detail text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link public.canonical_links%rowtype;
  v_override text := case when p_decision = 'policy' then null else p_decision end;
  v_case_id uuid;
begin
  if p_decision not in ('eligible', 'withheld', 'policy') then
    raise exception 'invalid discovery decision' using errcode = '22023';
  end if;
  select cl.* into v_link from public.canonical_links cl
  where cl.id = public.admin_link_id_for_code(p_code)
  for update;
  if not found or v_link.lifecycle_state = 'deleted' then
    return jsonb_build_object('kind', 'unknown');
  end if;
  if v_link.discovery_override is not distinct from v_override then
    return jsonb_build_object('kind', 'unchanged', 'discoveryOverride', v_override);
  end if;
  update public.canonical_links set discovery_override = v_override, updated_at = clock_timestamp()
  where id = v_link.id;
  select mc.id into v_case_id from public.moderation_cases mc where mc.link_id = v_link.id and mc.case_state <> 'closed';
  insert into public.moderation_actions (case_id, link_id, actor_principal_id, action_type, reason_code, reason_detail)
  values (v_case_id, v_link.id, p_actor, 'discovery_override', 'operator_correction',
    left('discovery ' || p_decision || coalesce(': ' || nullif(btrim(p_detail), ''), ''), 1000));
  return jsonb_build_object('kind', 'changed', 'discoveryOverride', v_override);
end;
$$;

create or replace function public.admin_link_record_v1(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'canonicalCode', ic.canonical_code,
    'title', cl.title,
    'safeDestinationOrigin', d.safe_destination_origin,
    'safeDestinationDisplay', d.safe_destination_origin || d.safe_destination_display_path,
    'destinationVersion', d.version_number,
    'lifecycleState', cl.lifecycle_state,
    'safetyState', cl.safety_state,
    'discoveryState', cl.discovery_state,
    'discoveryPolicyVersion', cl.discovery_policy_version,
    'discoveryOverride', cl.discovery_override,
    'publiclyDiscoverable', public.link_is_publicly_discoverable(cl.id),
    'visibility', cl.visibility,
    'createdAt', cl.created_at,
    'disabledAt', cl.disabled_at,
    'aggregateTotalClicks', coalesce((select ca.total_clicks from public.click_aggregates ca where ca.link_id = cl.id), 0),
    'reportCount', (select count(*) from public.reports r where r.link_id = cl.id),
    'reportsByReason', coalesce((
      select jsonb_object_agg(reason_code, n) from (
        select reason_code, count(*) as n from public.reports r where r.link_id = cl.id group by reason_code
      ) grouped), '{}'::jsonb),
    'openCase', (
      select jsonb_build_object('caseId', mc.id, 'caseState', mc.case_state, 'priority', mc.priority, 'openedAt', mc.opened_at)
      from public.moderation_cases mc where mc.link_id = cl.id and mc.case_state <> 'closed'),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'actionType', ma.action_type, 'reasonCode', ma.reason_code, 'reasonDetail', ma.reason_detail,
        'occurredAt', ma.occurred_at) order by ma.occurred_at desc)
      from public.moderation_actions ma where ma.link_id = cl.id), '[]'::jsonb)
  )
  from public.issued_codes ic
  join public.canonical_links cl on cl.issued_code_id = ic.id
  join public.protected_destination_versions d on d.id = cl.current_destination_id
  where ic.canonical_code = p_code;
$$;

-- Disable/restore no longer change discovery_state (see above).
create or replace function public.admin_moderate_link_v1(
  p_code text,
  p_action text,
  p_actor text,
  p_reason text,
  p_detail text,
  p_key_hash text,
  p_payload_digest text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing public.admin_mutation_idempotency%rowtype;
  link_row public.canonical_links%rowtype;
  v_case_id uuid;
  result jsonb;
begin
  if p_action not in ('disable', 'restore') then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  if p_reason is null then
    raise exception 'a reason code is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-mutation:' || p_key_hash, 0));
  select * into existing from public.admin_mutation_idempotency where key_hash = p_key_hash;
  if found then
    if existing.payload_digest = p_payload_digest then
      return existing.result || jsonb_build_object('kind', 'replayed');
    end if;
    return jsonb_build_object('kind', 'conflict');
  end if;

  select cl.* into link_row
  from public.canonical_links cl
  where cl.id = public.admin_link_id_for_code(p_code)
  for update;
  if not found or link_row.lifecycle_state = 'deleted' then
    return jsonb_build_object('kind', 'unknown');
  end if;

  if p_action = 'restore' and link_row.safety_state <> 'approved' then
    return jsonb_build_object('kind', 'safety_conflict', 'safetyState', link_row.safety_state);
  end if;

  if (p_action = 'disable' and link_row.lifecycle_state = 'disabled') or
     (p_action = 'restore' and link_row.lifecycle_state = 'active') then
    result := jsonb_build_object('kind', 'unchanged', 'canonicalCode', p_code, 'lifecycleState', link_row.lifecycle_state);
  else
    if p_action = 'disable' then
      update public.canonical_links
      set lifecycle_state = 'disabled', disabled_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = link_row.id;
    else
      update public.canonical_links
      set lifecycle_state = 'active', disabled_at = null, updated_at = clock_timestamp()
      where id = link_row.id;
    end if;
    select mc.id into v_case_id from public.moderation_cases mc where mc.link_id = link_row.id and mc.case_state <> 'closed';
    insert into public.moderation_actions (case_id, link_id, actor_principal_id, action_type, reason_code, reason_detail)
    values (v_case_id, link_row.id, p_actor, p_action, p_reason, nullif(btrim(p_detail), ''));
    result := jsonb_build_object('kind', 'changed', 'canonicalCode', p_code,
      'lifecycleState', case when p_action = 'disable' then 'disabled' else 'active' end);
  end if;

  insert into public.admin_mutation_idempotency (key_hash, payload_digest, result)
  values (p_key_hash, p_payload_digest, result);
  return result;
end;
$$;

revoke all on function public.assert_public_base_url(text) from public, anon, authenticated;
revoke all on function public.link_is_publicly_discoverable(uuid) from public, anon, authenticated;
revoke all on function public.public_card_json_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.list_public_links_v1(text, integer) from public, anon, authenticated;
revoke all on function public.public_link_lookup_v1(text, text) from public, anon, authenticated;
revoke all on function public.create_guest_link_v2(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_set_discovery_v1(text, text, text, text) from public, anon, authenticated;
grant execute on function public.assert_public_base_url(text) to service_role;
grant execute on function public.link_is_publicly_discoverable(uuid) to service_role;
grant execute on function public.public_card_json_v1(uuid, text) to service_role;
grant execute on function public.list_public_links_v1(text, integer) to service_role;
grant execute on function public.public_link_lookup_v1(text, text) to service_role;
grant execute on function public.create_guest_link_v2(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.admin_set_discovery_v1(text, text, text, text) to service_role;

commit;
