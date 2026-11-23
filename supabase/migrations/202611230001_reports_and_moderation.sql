begin;

-- R1 public reports and moderation records.
-- Feature Inventory: Link report submission; Define moderation response policy
-- and audit evidence (docs/operations/r1-moderation-policy.md).
-- No reporter IP, device, or account is stored.

create table public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  case_state text not null default 'open' check (case_state in ('open', 'triaged', 'closed')),
  priority text not null check (priority in ('S1', 'S2', 'S3')),
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  constraint moderation_cases_link_case_key unique (id, link_id),
  constraint moderation_cases_closed_state check ((case_state = 'closed') = (closed_at is not null))
);

-- At most one open or triaged case per link.
create unique index moderation_cases_one_active_per_link
  on public.moderation_cases (link_id) where case_state <> 'closed';

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null default gen_random_uuid() unique,
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  case_id uuid not null,
  environment text not null check (environment in ('local', 'staging', 'production')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  reason_code text not null check (
    reason_code in ('phishing', 'malware', 'child_safety', 'illegal', 'impersonation', 'abuse', 'spam', 'other')
  ),
  report_detail text check (report_detail is null or char_length(report_detail) <= 1000),
  workflow_state text not null default 'new' check (workflow_state in ('new', 'triaged', 'resolved')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  constraint reports_idempotency_key unique (environment, key_hash),
  constraint reports_case_same_link foreign key (case_id, link_id)
    references public.moderation_cases (id, link_id) on delete restrict
);

create index reports_link_created_idx on public.reports (link_id, created_at desc);

create table public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid,
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  actor_principal_id text not null check (char_length(actor_principal_id) between 1 and 128),
  action_type text not null check (
    action_type in ('disable', 'restore', 'triage', 'resolve', 'note', 'reveal_destination')
  ),
  reason_code text check (
    reason_code is null or
    reason_code in ('abuse_report', 'safety_block', 'policy_violation', 'operator_correction')
  ),
  reason_detail text check (reason_detail is null or char_length(reason_detail) <= 1000),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint moderation_actions_case_same_link foreign key (case_id, link_id)
    references public.moderation_cases (id, link_id) on delete restrict,
  constraint moderation_actions_state_change_reason check (
    action_type not in ('disable', 'restore') or reason_code is not null
  )
);

alter table public.moderation_cases enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
revoke all on public.moderation_cases from anon, authenticated;
revoke all on public.reports from anon, authenticated;
revoke all on public.moderation_actions from anon, authenticated;

create or replace function public.guard_moderation_action_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'moderation actions are append-only' using errcode = '23000';
end;
$$;

create trigger moderation_actions_append_only
before update or delete on public.moderation_actions
for each row execute function public.guard_moderation_action_append_only();

create or replace function public.report_severity(p_reason text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_reason in ('phishing', 'malware', 'child_safety') then 'S1'
    when p_reason in ('illegal', 'impersonation', 'abuse') then 'S2'
    else 'S3'
  end;
$$;

-- Persists one public report. Returns:
--   {kind: 'accepted' | 'replayed', receiptId}  for an eligible link
--   {kind: 'unavailable'}                       for an unknown or inactive code
--   {kind: 'conflict'}                          for a reused key with a different payload
-- A report never changes redirect state. An open S1 case withholds discovery
-- through the public projection, not by mutating the link.
create or replace function public.submit_report_v1(
  p_environment text,
  p_code text,
  p_key_hash text,
  p_payload_digest text,
  p_reason text,
  p_detail text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  code_row public.issued_codes%rowtype;
  link_row public.canonical_links%rowtype;
  existing public.reports%rowtype;
  active_case public.moderation_cases%rowtype;
  severity text := public.report_severity(p_reason);
  receipt uuid;
begin
  if p_environment not in ('local', 'staging', 'production') or
     p_code is null or p_code !~ '^[A-Za-z0-9]{6,32}$' then
    return jsonb_build_object('kind', 'unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_environment || ':' || p_key_hash, 0));

  select * into existing from public.reports
  where environment = p_environment and key_hash = p_key_hash;
  if found then
    if existing.payload_digest = p_payload_digest then
      return jsonb_build_object('kind', 'replayed', 'receiptId', existing.receipt_id);
    end if;
    return jsonb_build_object('kind', 'conflict');
  end if;

  select * into code_row from public.issued_codes where canonical_code = p_code and status = 'issued';
  if not found then
    return jsonb_build_object('kind', 'unavailable');
  end if;
  select * into link_row from public.canonical_links
  where issued_code_id = code_row.id and lifecycle_state = 'active';
  if not found then
    return jsonb_build_object('kind', 'unavailable');
  end if;

  select * into active_case from public.moderation_cases
  where link_id = link_row.id and case_state <> 'closed'
  for update;
  if not found then
    insert into public.moderation_cases (link_id, priority)
    values (link_row.id, severity)
    returning * into active_case;
  elsif severity < active_case.priority then
    -- 'S1' < 'S2' < 'S3': raise the case to the most severe report.
    update public.moderation_cases set priority = severity, case_state = 'open'
    where id = active_case.id
    returning * into active_case;
  end if;

  insert into public.reports (
    link_id, case_id, environment, key_hash, payload_digest, reason_code, report_detail
  ) values (
    link_row.id, active_case.id, p_environment, p_key_hash, p_payload_digest, p_reason,
    nullif(btrim(p_detail), '')
  ) returning receipt_id into receipt;

  return jsonb_build_object('kind', 'accepted', 'receiptId', receipt);
end;
$$;

revoke all on function public.report_severity(text) from public, anon, authenticated;
revoke all on function public.submit_report_v1(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_severity(text) to service_role;
grant execute on function public.submit_report_v1(text, text, text, text, text, text) to service_role;

commit;
