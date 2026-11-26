begin;

-- Founder notifications for new reports and automatic safety blocks.
-- Feature Inventory: "Notify the founder of new reports and safety blocks".
-- The report transaction writes an outbox row; the notifier Worker claims
-- pending rows every 5 minutes, sends one digest email, and completes the
-- batch. Rows hold only the link, the kind, and the reason category: never the
-- destination, report free text, or reporter data.

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in ('local', 'staging', 'production')),
  kind text not null check (kind in ('report', 'safety_block')),
  link_id uuid not null references public.canonical_links(id) on delete restrict,
  reason_code text check (
    reason_code is null or
    reason_code in ('phishing', 'malware', 'child_safety', 'illegal', 'impersonation', 'abuse', 'spam', 'other')
  ),
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  batch_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  constraint notification_outbox_sending_has_lease check ((state = 'sending') = (lease_until is not null and batch_id is not null)),
  constraint notification_outbox_sent_has_time check ((state = 'sent') = (sent_at is not null))
);

create index notification_outbox_claimable_idx
  on public.notification_outbox (environment, available_at)
  where state in ('pending', 'sending');
create index notification_outbox_batch_idx on public.notification_outbox (batch_id) where batch_id is not null;

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- Re-created from 202611230001 with one change: an accepted (not replayed)
-- report also enqueues a founder notification in the same transaction.
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

  insert into public.notification_outbox (environment, kind, link_id, reason_code)
  values (p_environment, 'report', link_row.id, p_reason);

  return jsonb_build_object('kind', 'accepted', 'receiptId', receipt);
end;
$$;

-- For the re-screening job (Malicious URL screening) when it blocks a link.
create or replace function public.enqueue_safety_block_notification_v1(p_environment text, p_link_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.notification_outbox (environment, kind, link_id)
  values (p_environment, 'safety_block', p_link_id);
$$;

-- Claims due rows (pending and available, or sending with an expired lease)
-- under a new batch id. Returns the digest grouped by link, kind, and reason.
create or replace function public.claim_notifications_v1(
  p_environment text,
  p_limit integer default 200,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_batch uuid := gen_random_uuid();
  claimed integer;
  entries jsonb;
begin
  if p_environment not in ('local', 'staging', 'production') or
     p_limit not between 1 and 500 or p_lease_seconds not between 30 and 900 then
    raise exception 'invalid claim parameters' using errcode = '22023';
  end if;

  with due as (
    select id from public.notification_outbox
    where environment = p_environment
      and ((state = 'pending' and available_at <= clock_timestamp())
        or (state = 'sending' and lease_until < clock_timestamp()))
    order by created_at
    limit p_limit
    for update skip locked
  )
  update public.notification_outbox o
  set state = 'sending', batch_id = new_batch,
      lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
  from due where o.id = due.id;
  get diagnostics claimed = row_count;

  if claimed = 0 then
    return jsonb_build_object('batchId', null, 'entries', '[]'::jsonb, 'events', 0);
  end if;

  select coalesce(jsonb_agg(entry order by entry->>'priority', entry->>'firstAt'), '[]'::jsonb) into entries
  from (
    select jsonb_build_object(
      'canonicalCode', ic.canonical_code,
      'kind', o.kind,
      'reasonCategory', o.reason_code,
      'priority', case when o.kind = 'safety_block' then 'S1' else public.report_severity(o.reason_code) end,
      'count', count(*),
      'firstAt', min(o.created_at),
      'lastAt', max(o.created_at)
    ) as entry
    from public.notification_outbox o
    join public.canonical_links cl on cl.id = o.link_id
    join public.issued_codes ic on ic.id = cl.issued_code_id
    where o.batch_id = new_batch
    group by ic.canonical_code, o.kind, o.reason_code
  ) grouped;

  return jsonb_build_object('batchId', new_batch, 'entries', entries, 'events', claimed);
end;
$$;

-- Completes a claimed batch. 'sent' marks rows sent. 'failed' schedules a
-- retry with backoff (5, 20 minutes) and marks rows failed after 3 attempts;
-- the response reports exhausted rows so the notifier raises an alert.
create or replace function public.complete_notifications_v1(p_batch_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  updated integer;
  exhausted integer := 0;
begin
  if p_outcome not in ('sent', 'failed') then
    raise exception 'invalid outcome' using errcode = '22023';
  end if;

  if p_outcome = 'sent' then
    update public.notification_outbox
    set state = 'sent', sent_at = clock_timestamp(), lease_until = null
    where batch_id = p_batch_id and state = 'sending';
    get diagnostics updated = row_count;
  else
    update public.notification_outbox
    set attempts = attempts + 1,
        state = case when attempts + 1 >= 3 then 'failed' else 'pending' end,
        available_at = clock_timestamp() + make_interval(mins => 5 * (attempts + 1) * (attempts + 1)),
        lease_until = null,
        batch_id = case when attempts + 1 >= 3 then batch_id else null end
    where batch_id = p_batch_id and state = 'sending';
    get diagnostics updated = row_count;
    select count(*) into exhausted from public.notification_outbox
    where batch_id = p_batch_id and state = 'failed';
  end if;

  return jsonb_build_object('updated', updated, 'exhausted', exhausted);
end;
$$;

revoke all on function public.enqueue_safety_block_notification_v1(text, uuid) from public, anon, authenticated;
revoke all on function public.claim_notifications_v1(text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_notifications_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_safety_block_notification_v1(text, uuid) to service_role;
grant execute on function public.claim_notifications_v1(text, integer, integer) to service_role;
grant execute on function public.complete_notifications_v1(uuid, text) to service_role;

-- Sent rows are kept 30 days for delivery evidence; failed rows stay until
-- the founder reviews them.
create or replace function public.purge_sent_notifications_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removed integer;
begin
  delete from public.notification_outbox
  where state = 'sent' and sent_at < clock_timestamp() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_sent_notifications_v1() from public, anon, authenticated;
grant execute on function public.purge_sent_notifications_v1() to service_role;

-- Daily cleanup (pg_cron).
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'op4n_purge_sent_notifications';
select cron.schedule(
  'op4n_purge_sent_notifications',
  '17 3 * * *',
  'select public.purge_sent_notifications_v1();'
);

commit;
