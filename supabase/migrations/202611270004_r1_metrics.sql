begin;

-- R1 product and safety metrics (Feature Inventory Order 92). Server-side
-- only, computed from existing tables: no client tracking, no destinations,
-- no personal identifiers. Request-level rates (4xx/5xx/429/422) come from the
-- structured logs; see docs/operations/r1-metrics.md.
create or replace function public.r1_metrics_v1(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with window_links as (
    select cl.id, cl.created_at, cl.discovery_state, cl.lifecycle_state
    from public.canonical_links cl
    where cl.created_at >= p_from and cl.created_at < p_to and not cl.synthetic
  ),
  first_actions as (
    select r.id as report_id, r.created_at,
      (select min(ma.occurred_at) from public.moderation_actions ma
        where ma.case_id = r.case_id and ma.action_type in ('triage', 'resolve', 'disable')
          and ma.occurred_at >= r.created_at) as first_action_at
    from public.reports r
    where r.created_at >= p_from and r.created_at < p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'linksCreated', (select count(*) from window_links),
    'linksWithheldFromDiscovery', (select count(*) from window_links where discovery_state = 'withheld'),
    'clicksRecorded', (select count(*) from public.click_events ce where ce.recorded_at >= p_from and ce.recorded_at < p_to),
    'reports', (select count(*) from first_actions),
    'reportsPer1000Links', case when (select count(*) from window_links) = 0 then null
      else round(1000.0 * (select count(*) from first_actions) / (select count(*) from window_links), 2) end,
    'linksDisabled', (select count(distinct ma.link_id) from public.moderation_actions ma
      where ma.action_type = 'disable' and ma.occurred_at >= p_from and ma.occurred_at < p_to),
    'linksDisabledForSafety', (select count(distinct ma.link_id) from public.moderation_actions ma
      where ma.action_type = 'disable' and ma.reason_code in ('safety_block', 'abuse_report')
        and ma.occurred_at >= p_from and ma.occurred_at < p_to),
    'medianHoursToFirstModerationAction', (
      select round((extract(epoch from percentile_cont(0.5) within group (order by first_action_at - created_at)) / 3600)::numeric, 2)
      from first_actions where first_action_at is not null),
    'reportsWithoutAction', (select count(*) from first_actions where first_action_at is null)
  );
$$;

revoke all on function public.r1_metrics_v1(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.r1_metrics_v1(timestamptz, timestamptz) to service_role;

commit;
