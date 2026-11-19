begin;

-- R1 rate limiting and operational feature flags.
-- Feature Inventory: Guest creation rate limit; Implement operational feature
-- flags and kill switches.
-- Rate-limit identities are HMACs of the client address with a daily rotating
-- key, computed in the Edge Function; raw IP addresses never reach the database.

create table public.rate_limit_counters (
  environment text not null check (environment in ('local', 'staging', 'production')),
  limit_class text not null check (limit_class ~ '^[a-z][a-z0-9-]{1,63}$'),
  identity_hash text not null check (identity_hash ~ '^[0-9a-f]{64}$' or identity_hash = 'global'),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  window_start timestamptz not null,
  request_count integer not null check (request_count >= 0),
  primary key (environment, limit_class, identity_hash, window_seconds, window_start)
);

create index rate_limit_counters_window_start_idx on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

-- Atomically counts one request in every configured fixed window for one
-- identity. p_windows: [{"seconds": 60, "limit": 5}, ...]. Returns the
-- decision plus the tightest window's limit, remaining, and reset seconds.
create or replace function public.consume_rate_limit_v1(
  p_environment text,
  p_class text,
  p_identity text,
  p_windows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  window_definition jsonb;
  window_length integer;
  window_limit integer;
  current_start timestamptz;
  current_count integer;
  seconds_to_reset integer;
  current_remaining integer;
  now_at timestamptz := clock_timestamp();
  limited boolean := false;
  retry_after integer := 1;
  tightest_limit integer;
  tightest_remaining integer;
  tightest_reset integer;
begin
  if p_environment not in ('local', 'staging', 'production') or
     jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) not between 1 and 8 then
    raise exception 'invalid rate-limit request' using errcode = '22023';
  end if;

  for window_definition in select value from jsonb_array_elements(p_windows) loop
    window_length := (window_definition ->> 'seconds')::integer;
    window_limit := (window_definition ->> 'limit')::integer;
    if window_length is null or window_length not between 1 and 86400 or
       window_limit is null or window_limit < 1 then
      raise exception 'invalid rate-limit window' using errcode = '22023';
    end if;

    current_start := to_timestamp(floor(extract(epoch from now_at) / window_length) * window_length);
    insert into public.rate_limit_counters as counter (
      environment, limit_class, identity_hash, window_seconds, window_start, request_count
    ) values (
      p_environment, p_class, p_identity, window_length, current_start, 1
    )
    on conflict (environment, limit_class, identity_hash, window_seconds, window_start)
    do update set request_count = counter.request_count + 1
    returning request_count into current_count;

    seconds_to_reset := greatest(
      ceil(extract(epoch from (current_start + make_interval(secs => window_length)) - now_at))::integer,
      1
    );
    current_remaining := greatest(window_limit - current_count, 0);
    if current_count > window_limit then
      limited := true;
      retry_after := greatest(retry_after, seconds_to_reset);
    end if;
    if tightest_remaining is null or current_remaining < tightest_remaining then
      tightest_limit := window_limit;
      tightest_remaining := current_remaining;
      tightest_reset := seconds_to_reset;
    end if;
  end loop;

  return jsonb_build_object(
    'decision', case when limited then 'limited' else 'allowed' end,
    'limit', tightest_limit,
    'remaining', tightest_remaining,
    'reset', tightest_reset,
    'retryAfter', retry_after
  );
end;
$$;

create or replace function public.purge_rate_limit_counters_v1()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  removed integer;
begin
  delete from public.rate_limit_counters
  where window_start < clock_timestamp() - interval '25 hours';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Operational feature flags. Changed by the founder via SQL in R1; every
-- change needs a new reason and is written to an append-only audit table.
create table public.feature_flags (
  flag_key text primary key check (
    flag_key in ('guest_creation', 'latest_links', 'public_search', 'public_reports')
  ),
  enabled boolean not null,
  reason text not null check (char_length(reason) between 3 and 500),
  updated_by text not null default current_user,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.feature_flag_audit (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null references public.feature_flags(flag_key) on delete restrict,
  old_enabled boolean,
  new_enabled boolean not null,
  reason text not null,
  actor text not null,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_audit enable row level security;
revoke all on public.feature_flags from anon, authenticated;
revoke all on public.feature_flag_audit from anon, authenticated;

create or replace function public.guard_feature_flag_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'feature flags cannot be deleted' using errcode = '23000';
  end if;
  if tg_op = 'UPDATE' then
    if new.flag_key <> old.flag_key then
      raise exception 'feature flag keys are immutable' using errcode = '23000';
    end if;
    if new.enabled is distinct from old.enabled and new.reason = old.reason then
      raise exception 'a new reason is required to change a feature flag' using errcode = '23514';
    end if;
  end if;
  new.updated_by := current_user;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger feature_flags_guard
before insert or update or delete on public.feature_flags
for each row execute function public.guard_feature_flag_change();

create or replace function public.audit_feature_flag_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  insert into public.feature_flag_audit (flag_key, old_enabled, new_enabled, reason, actor)
  values (
    new.flag_key,
    case when tg_op = 'UPDATE' then old.enabled else null end,
    new.enabled,
    new.reason,
    current_user
  );
  return null;
end;
$$;

create trigger feature_flags_audit
after insert or update on public.feature_flags
for each row execute function public.audit_feature_flag_change();

create or replace function public.guard_feature_flag_audit_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'feature flag audit is append-only' using errcode = '23000';
end;
$$;

create trigger feature_flag_audit_append_only
before update or delete on public.feature_flag_audit
for each row execute function public.guard_feature_flag_audit_append_only();

insert into public.feature_flags (flag_key, enabled, reason) values
  ('guest_creation', true, 'R1 default'),
  ('latest_links', true, 'R1 default'),
  ('public_search', true, 'R1 default'),
  ('public_reports', true, 'R1 default');

create or replace function public.get_feature_flags_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_object_agg(flag_key, enabled), '{}'::jsonb) from public.feature_flags;
$$;

revoke all on function public.consume_rate_limit_v1(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.purge_rate_limit_counters_v1() from public, anon, authenticated;
revoke all on function public.get_feature_flags_v1() from public, anon, authenticated;
grant execute on function public.consume_rate_limit_v1(text, text, text, jsonb) to service_role;
grant execute on function public.purge_rate_limit_counters_v1() to service_role;
grant execute on function public.get_feature_flags_v1() to service_role;

-- Hourly cleanup of expired rate-limit windows (pg_cron, created by the
-- previous migration on hosted projects).
create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid) from cron.job where jobname = 'op4n_purge_rate_limit_counters';
select cron.schedule(
  'op4n_purge_rate_limit_counters',
  '7 * * * *',
  'select public.purge_rate_limit_counters_v1();'
);

commit;
