begin;

-- Operational alerts through the founder notification outbox
-- (Feature Inventory Orders 82 and 83). A daily check estimates free-quota
-- use and finds stale S1 reports; alerts reach support@op4n.com in the same
-- digest email as moderation events. Alerts carry counts and percentages
-- only: never a destination, code, or personal data.

alter table public.notification_outbox alter column link_id drop not null;
alter table public.notification_outbox drop constraint notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('report', 'safety_block', 'ops_alert'));
alter table public.notification_outbox
  add column alert_code text check (alert_code in ('quota_warning', 'quota_critical', 'stale_s1_report')),
  add column alert_detail text check (alert_detail is null or char_length(alert_detail) <= 200);
alter table public.notification_outbox add constraint notification_outbox_alert_shape
  check ((kind = 'ops_alert') = (link_id is null and alert_code is not null));

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
      'alertCode', o.alert_code,
      'alertDetail', o.alert_detail,
      'priority', case
        when o.kind = 'safety_block' then 'S1'
        when o.kind = 'ops_alert' then case when o.alert_code = 'quota_warning' then 'S2' else 'S1' end
        else public.report_severity(o.reason_code) end,
      'count', count(*),
      'firstAt', min(o.created_at),
      'lastAt', max(o.created_at)
    ) as entry
    from public.notification_outbox o
    left join public.canonical_links cl on cl.id = o.link_id
    left join public.issued_codes ic on ic.id = cl.issued_code_id
    where o.batch_id = new_batch
    group by ic.canonical_code, o.kind, o.reason_code, o.alert_code, o.alert_detail
  ) grouped;

  return jsonb_build_object('batchId', new_batch, 'entries', entries, 'events', claimed);
end;
$$;

-- One alert per code per environment per ~day.
create or replace function public.enqueue_ops_alert_v1(p_environment text, p_code text, p_detail text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.notification_outbox
    where environment = p_environment and kind = 'ops_alert' and alert_code = p_code
      and created_at > clock_timestamp() - interval '20 hours'
  ) then
    return false;
  end if;
  insert into public.notification_outbox (environment, kind, link_id, alert_code, alert_detail)
  values (p_environment, 'ops_alert', null, p_code, left(p_detail, 200));
  return true;
end;
$$;

-- Daily check. Edge Function invocations are estimated from recorded events:
-- 2 per redirect (lookup + click), 1 per creation and per report, plus the
-- fixed background load (notifier every 5 minutes, synthetic monitor every
-- 5 minutes with 2 calls). Public reads are not recorded, so the estimate is a
-- lower bound; the Supabase usage page is the source of truth.
create or replace function public.ops_daily_checks_v1(
  p_environment text,
  p_invocation_quota integer default 500000,
  p_database_quota_bytes bigint default 524288000
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_redirects bigint := (select count(*) from public.click_events where recorded_at > clock_timestamp() - interval '1 day');
  v_creates bigint := (select count(*) from public.creation_audit_events where occurred_at > clock_timestamp() - interval '1 day');
  v_reports bigint := (select count(*) from public.reports where created_at > clock_timestamp() - interval '1 day');
  v_daily bigint;
  v_monthly bigint;
  v_invocation_pct integer;
  v_db_bytes bigint := pg_database_size(current_database());
  v_db_pct integer;
  v_pct integer;
  v_stale bigint := (select count(*) from public.moderation_cases
                     where case_state <> 'closed' and priority = 'S1' and opened_at < clock_timestamp() - interval '24 hours');
  v_detail text;
  v_alerts text[] := '{}';
begin
  if p_environment not in ('local', 'staging', 'production') then
    raise exception 'invalid environment' using errcode = '22023';
  end if;
  v_daily := 2 * v_redirects + v_creates + v_reports + 288 + 2 * 288;
  v_monthly := v_daily * 30;
  v_invocation_pct := (v_monthly * 100 / greatest(p_invocation_quota, 1))::integer;
  v_db_pct := (v_db_bytes * 100 / greatest(p_database_quota_bytes, 1))::integer;
  v_pct := greatest(v_invocation_pct, v_db_pct);
  v_detail := format('Edge Function invocations ~%s/month (%s%% of %s); database %s MB (%s%% of %s MB)',
    v_monthly, v_invocation_pct, p_invocation_quota, v_db_bytes / 1048576, v_db_pct, p_database_quota_bytes / 1048576);

  if v_pct >= 90 and public.enqueue_ops_alert_v1(p_environment, 'quota_critical', 'CRITICAL ' || v_detail) then
    v_alerts := array_append(v_alerts, 'quota_critical');
  elsif v_pct >= 70 and v_pct < 90 and public.enqueue_ops_alert_v1(p_environment, 'quota_warning', 'WARNING ' || v_detail) then
    v_alerts := array_append(v_alerts, 'quota_warning');
  end if;
  if v_stale > 0 and public.enqueue_ops_alert_v1(p_environment, 'stale_s1_report',
       format('%s open S1 case(s) older than 24 hours. Triage in Admin.', v_stale)) then
    v_alerts := array_append(v_alerts, 'stale_s1_report');
  end if;

  return jsonb_build_object(
    'redirects24h', v_redirects, 'creates24h', v_creates, 'reports24h', v_reports,
    'estimatedMonthlyInvocations', v_monthly, 'invocationPercent', v_invocation_pct,
    'databaseBytes', v_db_bytes, 'databasePercent', v_db_pct, 'staleS1Cases', v_stale,
    'alertsQueued', to_jsonb(v_alerts));
end;
$$;

revoke all on function public.enqueue_ops_alert_v1(text, text, text) from public, anon, authenticated;
revoke all on function public.ops_daily_checks_v1(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.ops_daily_checks_v1(text, integer, bigint) to service_role;

commit;
