begin;

-- Founder Admin moderation (Feature Inventory Orders 57-60): link lookup,
-- reported-link queue, audited destination reveal, case triage/resolve, and
-- idempotent disable/restore. Every function is service_role only; the Edge
-- Function calls them after the Admin gate (aal2 founder JWT). The actor is
-- the verified founder subject.

create table public.admin_mutation_idempotency (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.admin_mutation_idempotency enable row level security;
revoke all on public.admin_mutation_idempotency from anon, authenticated;

create or replace function public.admin_link_id_for_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select cl.id
  from public.issued_codes ic
  join public.canonical_links cl on cl.issued_code_id = ic.id
  where ic.canonical_code = p_code;
$$;

-- Finds a link by exact canonical code or exact destination fingerprint.
create or replace function public.admin_find_link_v1(p_code text, p_fingerprint text)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select ic.canonical_code
  from public.canonical_links cl
  join public.issued_codes ic on ic.id = cl.issued_code_id
  left join public.protected_destination_versions d on d.id = cl.current_destination_id
  where (p_code is not null and ic.canonical_code = p_code)
     or (p_fingerprint is not null and d.destination_fingerprint = p_fingerprint)
  order by cl.created_at
  limit 1;
$$;

-- Founder view of one link. Excludes the full destination: revealing it is a
-- separate audited action (admin_reveal_destination_v1).
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
    'destinationVersion', d.version_number,
    'lifecycleState', cl.lifecycle_state,
    'safetyState', cl.safety_state,
    'discoveryState', cl.discovery_state,
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

create or replace function public.admin_reveal_destination_v1(p_code text, p_actor text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_link_id uuid := public.admin_link_id_for_code(p_code);
  v_destination text;
  v_case_id uuid;
begin
  if v_link_id is null then
    return jsonb_build_object('kind', 'unknown');
  end if;
  select d.full_destination_url into v_destination
  from public.canonical_links cl
  join public.protected_destination_versions d on d.id = cl.current_destination_id
  where cl.id = v_link_id;
  select mc.id into v_case_id from public.moderation_cases mc where mc.link_id = v_link_id and mc.case_state <> 'closed';
  insert into public.moderation_actions (case_id, link_id, actor_principal_id, action_type)
  values (v_case_id, v_link_id, p_actor, 'reveal_destination');
  return jsonb_build_object('kind', 'revealed', 'fullDestinationUrl', v_destination);
end;
$$;

-- Queue: open and triaged cases, most severe first, then oldest.
create or replace function public.admin_list_cases_v1(p_limit integer, p_offset integer)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.moderation_cases where case_state <> 'closed'),
    'items', coalesce(jsonb_agg(item order by item->>'priority', item->>'openedAt'), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'caseId', mc.id,
      'caseState', mc.case_state,
      'priority', mc.priority,
      'openedAt', mc.opened_at,
      'canonicalCode', ic.canonical_code,
      'title', cl.title,
      'safeDestinationOrigin', d.safe_destination_origin,
      'lifecycleState', cl.lifecycle_state,
      'reportCount', (select count(*) from public.reports r where r.case_id = mc.id),
      'reportsByReason', (
        select jsonb_object_agg(reason_code, n) from (
          select reason_code, count(*) as n from public.reports r where r.case_id = mc.id group by reason_code
        ) grouped),
      'firstReportAt', (select min(created_at) from public.reports r where r.case_id = mc.id),
      'lastReportAt', (select max(created_at) from public.reports r where r.case_id = mc.id)
    ) as item
    from public.moderation_cases mc
    join public.canonical_links cl on cl.id = mc.link_id
    join public.issued_codes ic on ic.id = cl.issued_code_id
    join public.protected_destination_versions d on d.id = cl.current_destination_id
    where mc.case_state <> 'closed'
    order by mc.priority, mc.opened_at
    limit greatest(1, least(p_limit, 50)) offset greatest(0, p_offset)
  ) page;
$$;

-- triage: case and its new reports become triaged. resolve: case closes and
-- its reports resolve. Both append an audited action with the founder note.
create or replace function public.admin_transition_case_v1(p_case_id uuid, p_action text, p_actor text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_case public.moderation_cases%rowtype;
begin
  if p_action not in ('triage', 'resolve') then
    raise exception 'invalid case action' using errcode = '22023';
  end if;
  if p_note is null or char_length(btrim(p_note)) = 0 or char_length(p_note) > 1000 then
    raise exception 'a note is required' using errcode = '22023';
  end if;
  select * into current_case from public.moderation_cases where id = p_case_id for update;
  if not found or current_case.case_state = 'closed' then
    return jsonb_build_object('kind', 'unknown');
  end if;

  if p_action = 'triage' then
    update public.moderation_cases set case_state = 'triaged' where id = p_case_id;
    update public.reports set workflow_state = 'triaged' where case_id = p_case_id and workflow_state = 'new';
  else
    update public.moderation_cases set case_state = 'closed', closed_at = clock_timestamp() where id = p_case_id;
    update public.reports set workflow_state = 'resolved', resolved_at = clock_timestamp()
    where case_id = p_case_id and workflow_state <> 'resolved';
  end if;

  insert into public.moderation_actions (case_id, link_id, actor_principal_id, action_type, reason_detail)
  values (p_case_id, current_case.link_id, p_actor, p_action, btrim(p_note));
  return jsonb_build_object('kind', 'ok', 'caseState', case when p_action = 'triage' then 'triaged' else 'closed' end);
end;
$$;

-- Disable or restore one link in one transaction with its audit row.
-- Returns kind: changed | unchanged | replayed | conflict | unknown | safety_conflict.
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
      set lifecycle_state = 'disabled', disabled_at = clock_timestamp(), discovery_state = 'withheld', updated_at = clock_timestamp()
      where id = link_row.id;
    else
      update public.canonical_links
      set lifecycle_state = 'active', disabled_at = null, discovery_state = 'eligible', updated_at = clock_timestamp()
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

revoke all on function public.admin_link_id_for_code(text) from public, anon, authenticated;
revoke all on function public.admin_find_link_v1(text, text) from public, anon, authenticated;
revoke all on function public.admin_link_record_v1(text) from public, anon, authenticated;
revoke all on function public.admin_reveal_destination_v1(text, text) from public, anon, authenticated;
revoke all on function public.admin_list_cases_v1(integer, integer) from public, anon, authenticated;
revoke all on function public.admin_transition_case_v1(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_moderate_link_v1(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_link_id_for_code(text) to service_role;
grant execute on function public.admin_find_link_v1(text, text) to service_role;
grant execute on function public.admin_link_record_v1(text) to service_role;
grant execute on function public.admin_reveal_destination_v1(text, text) to service_role;
grant execute on function public.admin_list_cases_v1(integer, integer) to service_role;
grant execute on function public.admin_transition_case_v1(uuid, text, text, text) to service_role;
grant execute on function public.admin_moderate_link_v1(text, text, text, text, text, text, text) to service_role;

commit;
