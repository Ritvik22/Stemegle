-- First-party product analytics for Stemegle.
--
-- Raw analytics tables are intentionally not readable from the browser. Events
-- enter through the same-origin analytics service and its service-role-only RPC;
-- dashboard data leaves through an authenticated, admin-guarded RPC.

create table if not exists public.analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_visitors (
  visitor_id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_landing_path text not null default '/',
  last_path text not null default '/',
  first_referrer_url text,
  first_referrer_host text,
  first_source text not null default 'Direct',
  first_medium text,
  first_campaign text,
  first_country_code text,
  first_region text,
  first_city text,
  first_timezone text,
  first_device_type text,
  first_browser text,
  first_os text,
  last_event text not null default 'session_started',
  pageview_count integer not null default 0 check (pageview_count >= 0),
  session_count integer not null default 0 check (session_count >= 0)
);

create table if not exists public.analytics_sessions (
  session_id uuid primary key,
  visitor_id uuid not null references public.analytics_visitors(visitor_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  landing_path text not null default '/',
  exit_path text not null default '/',
  referrer_url text,
  referrer_host text,
  acquisition_source text not null default 'Direct',
  acquisition_medium text,
  acquisition_campaign text,
  utm_term text,
  utm_content text,
  country_code text,
  region text,
  city text,
  timezone text,
  device_type text,
  browser text,
  operating_system text,
  pageview_count integer not null default 0 check (pageview_count >= 0)
);

create table if not exists public.analytics_signup_tokens (
  token uuid primary key,
  visitor_id uuid not null references public.analytics_visitors(visitor_id) on delete cascade,
  session_id uuid not null references public.analytics_sessions(session_id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_user_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visitor_id uuid not null references public.analytics_visitors(visitor_id) on delete cascade,
  session_id uuid references public.analytics_sessions(session_id) on delete set null,
  attribution_kind text not null check (attribution_kind in ('signup', 'authenticated_return')),
  attributed_at timestamptz not null default now(),
  landing_path text,
  referrer_url text,
  referrer_host text,
  acquisition_source text not null default 'Unknown (pre-tracking)',
  acquisition_medium text,
  acquisition_campaign text,
  country_code text,
  region text,
  city text,
  timezone text,
  device_type text,
  browser text,
  operating_system text
);

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  session_id uuid not null references public.analytics_sessions(session_id) on delete cascade,
  visitor_id uuid not null references public.analytics_visitors(visitor_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  path text not null default '/',
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists analytics_visitors_user_idx
  on public.analytics_visitors (user_id) where user_id is not null;
create index if not exists analytics_visitors_seen_idx
  on public.analytics_visitors (last_seen_at desc);
create index if not exists analytics_sessions_visitor_idx
  on public.analytics_sessions (visitor_id, started_at desc);
create index if not exists analytics_sessions_user_idx
  on public.analytics_sessions (user_id, started_at desc) where user_id is not null;
create index if not exists analytics_sessions_started_idx
  on public.analytics_sessions (started_at desc);
create index if not exists analytics_events_occurred_idx
  on public.analytics_events (occurred_at desc);
create index if not exists analytics_events_name_occurred_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_visitor_idx
  on public.analytics_events (visitor_id, occurred_at desc);
create index if not exists analytics_events_user_idx
  on public.analytics_events (user_id, occurred_at desc) where user_id is not null;
create index if not exists analytics_signup_tokens_expiry_idx
  on public.analytics_signup_tokens (expires_at);
create index if not exists analytics_user_attribution_visitor_idx
  on public.analytics_user_attribution (visitor_id);

alter table public.analytics_admins enable row level security;
alter table public.analytics_visitors enable row level security;
alter table public.analytics_sessions enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_signup_tokens enable row level security;
alter table public.analytics_user_attribution enable row level security;

revoke all on table public.analytics_admins from public, anon, authenticated;
revoke all on table public.analytics_visitors from public, anon, authenticated;
revoke all on table public.analytics_sessions from public, anon, authenticated;
revoke all on table public.analytics_events from public, anon, authenticated;
revoke all on table public.analytics_signup_tokens from public, anon, authenticated;
revoke all on table public.analytics_user_attribution from public, anon, authenticated;
revoke all on sequence public.analytics_events_id_seq from public, anon, authenticated;

create or replace function public.analytics_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.analytics_admins as admin
      where admin.user_id = auth.uid()
    )
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
  );
$$;

revoke all on function public.analytics_is_admin() from public;
grant execute on function public.analytics_is_admin() to authenticated;

create or replace function public.analytics_ingest_ready()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select true $$;

revoke all on function public.analytics_ingest_ready() from public;
grant execute on function public.analytics_ingest_ready() to service_role;

-- Called only by the private analytics service. p_user_id is accepted only from
-- that service after it verifies the browser's Supabase access token.
drop function if exists public.ingest_analytics_event(uuid, uuid, uuid, text, text, text, jsonb, jsonb);
drop function if exists public.identify_analytics_visitor(uuid, uuid);

create or replace function public.ingest_analytics_event(
  p_event_id uuid,
  p_visitor_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_event_name text,
  p_path text,
  p_referrer_url text,
  p_context jsonb,
  p_properties jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  clean_path text := left(coalesce(nullif(p_path, ''), '/'), 240);
  clean_referrer text := nullif(left(coalesce(p_referrer_url, ''), 1000), '');
  context_data jsonb := coalesce(p_context, '{}'::jsonb);
  property_data jsonb := coalesce(p_properties, '{}'::jsonb);
  linked_user_id uuid := p_user_id;
  inserted_event_count integer := 0;
  inserted_session_count integer := 0;
begin
  if p_event_id is null or p_visitor_id is null or p_session_id is null then
    raise exception 'Analytics identifiers are required' using errcode = '22023';
  end if;

  if p_event_name not in (
    'session_started', 'session_heartbeat', 'page_view', 'signup_started', 'signup_succeeded',
    'login_succeeded', 'queue_started', 'queue_connected', 'opponent_found',
    'queue_abandoned', 'bot_selected', 'game_started',
    'game_question_answered', 'game_completed', 'game_abandoned',
    'opponent_disconnected', 'party_created', 'party_join_requested',
    'party_joined', 'party_left', 'party_game_started', 'result_viewed'
  ) then
    raise exception 'Unsupported analytics event' using errcode = '22023';
  end if;

  if octet_length(property_data::text) > 8192 or octet_length(context_data::text) > 8192 then
    raise exception 'Analytics payload is too large' using errcode = '22023';
  end if;

  if exists (select 1 from public.analytics_events where event_id = p_event_id) then
    return;
  end if;

  insert into public.analytics_visitors (
    visitor_id,
    user_id,
    first_landing_path,
    last_path,
    first_referrer_url,
    first_referrer_host,
    first_source,
    first_medium,
    first_campaign,
    first_country_code,
    first_region,
    first_city,
    first_timezone,
    first_device_type,
    first_browser,
    first_os,
    last_event
  ) values (
    p_visitor_id,
    linked_user_id,
    clean_path,
    clean_path,
    clean_referrer,
    nullif(left(context_data ->> 'referrer_host', 255), ''),
    coalesce(nullif(left(context_data ->> 'source', 120), ''), 'Direct'),
    nullif(left(context_data ->> 'medium', 120), ''),
    nullif(left(context_data ->> 'campaign', 240), ''),
    nullif(left(context_data ->> 'country_code', 8), ''),
    nullif(left(context_data ->> 'region', 160), ''),
    nullif(left(context_data ->> 'city', 160), ''),
    nullif(left(context_data ->> 'timezone', 120), ''),
    nullif(left(context_data ->> 'device_type', 40), ''),
    nullif(left(context_data ->> 'browser', 80), ''),
    nullif(left(context_data ->> 'operating_system', 80), ''),
    p_event_name
  )
  on conflict (visitor_id) do update set
    user_id = coalesce(public.analytics_visitors.user_id, excluded.user_id),
    last_seen_at = now(),
    last_path = excluded.last_path,
    last_event = excluded.last_event;

  insert into public.analytics_sessions (
    session_id,
    visitor_id,
    user_id,
    landing_path,
    exit_path,
    referrer_url,
    referrer_host,
    acquisition_source,
    acquisition_medium,
    acquisition_campaign,
    utm_term,
    utm_content,
    country_code,
    region,
    city,
    timezone,
    device_type,
    browser,
    operating_system
  ) values (
    p_session_id,
    p_visitor_id,
    linked_user_id,
    clean_path,
    clean_path,
    clean_referrer,
    nullif(left(context_data ->> 'referrer_host', 255), ''),
    coalesce(nullif(left(context_data ->> 'source', 120), ''), 'Direct'),
    nullif(left(context_data ->> 'medium', 120), ''),
    nullif(left(context_data ->> 'campaign', 240), ''),
    nullif(left(context_data ->> 'term', 240), ''),
    nullif(left(context_data ->> 'content', 240), ''),
    nullif(left(context_data ->> 'country_code', 8), ''),
    nullif(left(context_data ->> 'region', 160), ''),
    nullif(left(context_data ->> 'city', 160), ''),
    nullif(left(context_data ->> 'timezone', 120), ''),
    nullif(left(context_data ->> 'device_type', 40), ''),
    nullif(left(context_data ->> 'browser', 80), ''),
    nullif(left(context_data ->> 'operating_system', 80), '')
  )
  on conflict (session_id) do nothing;
  get diagnostics inserted_session_count = row_count;

  update public.analytics_sessions as session
  set
    user_id = coalesce(linked_user_id, session.user_id),
    last_seen_at = now(),
    exit_path = clean_path
  where session.session_id = p_session_id
    and session.visitor_id = p_visitor_id;

  if not found then
    raise exception 'Session does not belong to visitor' using errcode = '22023';
  end if;

  if linked_user_id is not null then
    insert into public.analytics_user_attribution (
      user_id,
      visitor_id,
      session_id,
      attribution_kind,
      attributed_at,
      landing_path,
      referrer_url,
      referrer_host,
      acquisition_source,
      acquisition_medium,
      acquisition_campaign,
      country_code,
      region,
      city,
      timezone,
      device_type,
      browser,
      operating_system
    )
    select
      linked_user_id,
      session.visitor_id,
      session.session_id,
      'authenticated_return',
      session.started_at,
      session.landing_path,
      session.referrer_url,
      session.referrer_host,
      session.acquisition_source,
      session.acquisition_medium,
      session.acquisition_campaign,
      session.country_code,
      session.region,
      session.city,
      session.timezone,
      session.device_type,
      session.browser,
      session.operating_system
    from public.analytics_sessions as session
    where session.session_id = p_session_id
    on conflict (user_id) do nothing;
  end if;

  insert into public.analytics_events (
    event_id,
    session_id,
    visitor_id,
    user_id,
    event_name,
    path,
    properties
  ) values (
    p_event_id,
    p_session_id,
    p_visitor_id,
    linked_user_id,
    p_event_name,
    clean_path,
    property_data
  )
  on conflict (event_id) do nothing;
  get diagnostics inserted_event_count = row_count;

  if inserted_event_count = 0 then
    return;
  end if;

  update public.analytics_visitors as visitor
  set
    last_seen_at = now(),
    last_path = clean_path,
    last_event = p_event_name,
    pageview_count = visitor.pageview_count + case when p_event_name = 'page_view' then 1 else 0 end,
    session_count = visitor.session_count + case when inserted_session_count = 1 then 1 else 0 end
  where visitor.visitor_id = p_visitor_id;

  if p_event_name = 'page_view' then
    update public.analytics_sessions as session
    set pageview_count = session.pageview_count + 1
    where session.session_id = p_session_id;
  end if;
end;
$$;

revoke all on function public.ingest_analytics_event(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb) from public;
grant execute on function public.ingest_analytics_event(uuid, uuid, uuid, uuid, text, text, text, jsonb, jsonb) to service_role;

create or replace function public.issue_analytics_signup_token(
  p_token uuid,
  p_visitor_id uuid,
  p_session_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_token is null or p_visitor_id is null or p_session_id is null then
    raise exception 'Signup attribution identifiers are required' using errcode = '22023';
  end if;

  delete from public.analytics_signup_tokens where expires_at <= now();

  insert into public.analytics_signup_tokens (token, visitor_id, session_id)
  select p_token, session.visitor_id, session.session_id
  from public.analytics_sessions as session
  where session.session_id = p_session_id
    and session.visitor_id = p_visitor_id
  on conflict (token) do nothing;

  if not found then
    raise exception 'Analytics session is not ready for signup' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.issue_analytics_signup_token(uuid, uuid, uuid) from public;
grant execute on function public.issue_analytics_signup_token(uuid, uuid, uuid) to service_role;

-- Preserve anonymous acquisition for users who must confirm their email before
-- they receive an authenticated browser session.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_name text;
  analytics_token uuid;
  analytics_visitor_id uuid;
  analytics_session_id uuid;
  valid_analytics_token boolean := false;
begin
  requested_name := trim(coalesce(
    new.raw_user_meta_data ->> 'battle_name',
    split_part(new.email, '@', 1),
    'Player'
  ));

  if char_length(requested_name) < 2 then
    requested_name := 'Player-' || left(new.id::text, 6);
  end if;

  insert into public.profiles (id, battle_name)
  values (new.id, left(requested_name, 30))
  on conflict (id) do update set battle_name = excluded.battle_name;

  begin
    analytics_token := nullif(new.raw_user_meta_data ->> 'analytics_signup_token', '')::uuid;
  exception when invalid_text_representation then
    analytics_token := null;
  end;

  if TG_OP = 'INSERT' and analytics_token is not null then
    delete from public.analytics_signup_tokens
    where token = analytics_token
      and expires_at > now()
    returning visitor_id, session_id
    into analytics_visitor_id, analytics_session_id;
    valid_analytics_token := found;
  end if;

  if valid_analytics_token then
    update public.analytics_visitors
    set user_id = coalesce(user_id, new.id)
    where visitor_id = analytics_visitor_id
      and (user_id is null or user_id = new.id);

    update public.analytics_sessions
    set user_id = new.id
    where session_id = analytics_session_id
      and visitor_id = analytics_visitor_id;

    update public.analytics_events
    set user_id = new.id
    where session_id = analytics_session_id
      and visitor_id = analytics_visitor_id;

    insert into public.analytics_user_attribution (
      user_id,
      visitor_id,
      session_id,
      attribution_kind,
      attributed_at,
      landing_path,
      referrer_url,
      referrer_host,
      acquisition_source,
      acquisition_medium,
      acquisition_campaign,
      country_code,
      region,
      city,
      timezone,
      device_type,
      browser,
      operating_system
    )
    select
      new.id,
      session.visitor_id,
      session.session_id,
      'signup',
      new.created_at,
      session.landing_path,
      session.referrer_url,
      session.referrer_host,
      session.acquisition_source,
      session.acquisition_medium,
      session.acquisition_campaign,
      session.country_code,
      session.region,
      session.city,
      session.timezone,
      session.device_type,
      session.browser,
      session.operating_system
    from public.analytics_sessions as session
    where session.session_id = analytics_session_id
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.purge_expired_analytics(p_retention_days integer default 400)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_days integer := greatest(30, least(coalesce(p_retention_days, 400), 730));
  cutoff timestamptz := now() - make_interval(days => safe_days);
  token_count integer := 0;
  event_count integer := 0;
  session_count integer := 0;
  visitor_count integer := 0;
begin
  delete from public.analytics_signup_tokens where expires_at <= now();
  get diagnostics token_count = row_count;

  delete from public.analytics_events where occurred_at < cutoff;
  get diagnostics event_count = row_count;

  delete from public.analytics_sessions where last_seen_at < cutoff;
  get diagnostics session_count = row_count;

  delete from public.analytics_visitors as visitor
  where visitor.last_seen_at < cutoff
    and not exists (
      select 1 from public.analytics_sessions as session
      where session.visitor_id = visitor.visitor_id
    );
  get diagnostics visitor_count = row_count;

  return jsonb_build_object(
    'tokens', token_count,
    'events', event_count,
    'sessions', session_count,
    'visitors', visitor_count,
    'retention_days', safe_days
  );
end;
$$;

revoke all on function public.purge_expired_analytics(integer) from public;
grant execute on function public.purge_expired_analytics(integer) to service_role;

create or replace function public.analytics_admin_dashboard(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  safe_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  range_start timestamptz;
  payload jsonb;
begin
  if not public.analytics_is_admin() then
    raise exception 'Analytics admin access required' using errcode = '42501';
  end if;

  range_start := date_trunc('day', now()) - make_interval(days => safe_days - 1);

  with
  window_events as (
    select *
    from public.analytics_events
    where occurred_at >= range_start
  ),
  window_sessions as (
    select *
    from public.analytics_sessions
    where started_at >= range_start
  ),
  signup_cohort as (
    select
      users.id as user_id,
      users.created_at,
      attribution.visitor_id,
      coalesce(attribution.acquisition_source, 'Unknown (pre-tracking)') as source
    from auth.users as users
    left join public.analytics_user_attribution as attribution on attribution.user_id = users.id
    where users.created_at >= range_start
  ),
  tracked_signup_cohort as (
    select * from signup_cohort where visitor_id is not null
  ),
  event_user_stats as (
    select
      event.user_id,
      count(*) filter (where event.event_name in ('queue_started', 'party_joined')) as queues,
      count(*) filter (where event.event_name = 'game_started') as game_starts,
      count(*) filter (where event.event_name = 'game_completed') as game_completions,
      count(*) filter (where event.event_name = 'game_abandoned') as game_abandonments,
      count(*) filter (where event.event_name = 'game_completed' and event.properties ->> 'mode' = 'bot') as bot_completions,
      count(*) filter (where event.event_name = 'game_completed' and event.properties ->> 'mode' = 'human') as human_completions,
      count(*) filter (where event.event_name = 'game_completed' and event.properties ->> 'mode' in ('party_team', 'party_tournament')) as party_completions,
      max(event.occurred_at) as last_event_at
    from public.analytics_events as event
    where event.user_id is not null
    group by event.user_id
  ),
  session_user_stats as (
    select
      session.user_id,
      count(*) as sessions,
      sum(session.pageview_count) as pageviews
    from public.analytics_sessions as session
    where session.user_id is not null
    group by session.user_id
  ),
  first_touch as (
    select
      attribution.user_id,
      attribution.attributed_at as first_seen_at,
      attribution.landing_path as first_landing_path,
      attribution.referrer_url as first_referrer_url,
      attribution.referrer_host as first_referrer_host,
      attribution.acquisition_source as first_source,
      attribution.acquisition_medium as first_medium,
      attribution.acquisition_campaign as first_campaign,
      attribution.country_code as first_country_code,
      attribution.region as first_region,
      attribution.city as first_city,
      attribution.timezone as first_timezone,
      attribution.device_type as first_device_type,
      attribution.browser as first_browser,
      attribution.operating_system as first_os
    from public.analytics_user_attribution as attribution
  ),
  latest_touch as (
    select distinct on (event.user_id)
      event.user_id,
      event.occurred_at as last_seen_at,
      event.path as last_path,
      event.event_name as last_event
    from public.analytics_events as event
    where event.user_id is not null
    order by event.user_id, event.occurred_at desc
  ),
  user_rows as (
    select
      users.id as user_id,
      users.email,
      profile.battle_name,
      users.created_at,
      users.email_confirmed_at,
      users.last_sign_in_at,
      first_touch.first_seen_at,
      latest_touch.last_seen_at,
      coalesce(first_touch.first_source, 'Unknown (pre-tracking)') as referral_source,
      first_touch.first_referrer_url as referrer_url,
      first_touch.first_referrer_host as referrer_host,
      first_touch.first_medium as referral_medium,
      first_touch.first_campaign as campaign,
      first_touch.first_landing_path as landing_path,
      first_touch.first_country_code as country_code,
      first_touch.first_region as region,
      first_touch.first_city as city,
      first_touch.first_timezone as timezone,
      first_touch.first_device_type as device_type,
      first_touch.first_browser as browser,
      first_touch.first_os as operating_system,
      latest_touch.last_path,
      latest_touch.last_event,
      coalesce(session_user_stats.pageviews, 0) as pageviews,
      coalesce(session_user_stats.sessions, 0) as sessions,
      coalesce(event_user_stats.queues, 0) as queues,
      coalesce(event_user_stats.game_starts, 0) as game_starts,
      coalesce(event_user_stats.game_completions, 0) as game_completions,
      coalesce(event_user_stats.game_abandonments, 0) as game_abandonments,
      coalesce(event_user_stats.bot_completions, 0) as bot_completions,
      coalesce(event_user_stats.human_completions, 0) as human_completions,
      coalesce(event_user_stats.party_completions, 0) as party_completions,
      coalesce(profile.total_score, 0) as total_score,
      coalesce(profile.wins, 0) as wins,
      coalesce(profile.losses, 0) as losses,
      coalesce(profile.matches_played, 0) as ranked_matches,
      case
        when coalesce(event_user_stats.game_completions, 0) > 0 then 'completed'
        when coalesce(event_user_stats.game_abandonments, 0) > 0 then 'abandoned'
        when coalesce(event_user_stats.game_starts, 0) > 0 then 'started'
        when coalesce(event_user_stats.queues, 0) > 0 then 'queued'
        else 'signed_up'
      end as highest_stage
    from auth.users as users
    left join public.profiles as profile on profile.id = users.id
    left join first_touch on first_touch.user_id = users.id
    left join latest_touch on latest_touch.user_id = users.id
    left join session_user_stats on session_user_stats.user_id = users.id
    left join event_user_stats on event_user_stats.user_id = users.id
    order by users.created_at desc
    limit 2000
  )
  select jsonb_build_object(
    'generated_at', now(),
    'range_days', safe_days,
    'overview', jsonb_build_object(
      'pageviews', (select count(*) from window_events where event_name = 'page_view'),
      'visitors', (select count(distinct visitor_id) from window_events),
      'sessions', (select count(*) from window_sessions),
      'signups', (select count(*) from signup_cohort),
      'total_users', (select count(*) from auth.users),
      'unconverted_visitors', (
        select count(*) from public.analytics_visitors as visitor
        where visitor.first_seen_at >= range_start
          and not exists (
            select 1 from public.analytics_user_attribution as attribution
            where attribution.visitor_id = visitor.visitor_id
          )
      ),
      'active_visitors', (
        select count(distinct visitor_id) from public.analytics_events
        where occurred_at >= now() - interval '5 minutes'
      ),
      'game_starts', (
        select count(distinct coalesce(properties ->> 'game_id', event_id::text))
        from window_events where event_name = 'game_started'
      ),
      'game_completions', (
        select count(distinct coalesce(properties ->> 'game_id', event_id::text))
        from window_events where event_name = 'game_completed'
      ),
      'game_abandonments', (
        select count(distinct coalesce(properties ->> 'game_id', event_id::text))
        from window_events where event_name = 'game_abandoned'
      )
    ),
    'funnel', jsonb_build_object(
      'visited', (select count(distinct visitor_id) from window_events),
      'signed_up', (select count(*) from tracked_signup_cohort),
      'queued', (
        select count(distinct visitor_id) from window_events
        where event_name in ('queue_started', 'party_joined')
      ),
      'started', (
        select count(distinct visitor_id) from window_events
        where event_name = 'game_started'
      ),
      'completed', (
        select count(distinct visitor_id) from window_events
        where event_name = 'game_completed'
      )
    ),
    'timeseries', coalesce((
      select jsonb_agg(to_jsonb(series_row) order by series_row.day)
      from (
        select
          day_series.day::date as day,
          count(event.id) filter (where event.event_name = 'page_view') as pageviews,
          count(distinct event.visitor_id) as visitors,
          count(event.id) filter (where event.event_name = 'game_started') as game_starts,
          count(event.id) filter (where event.event_name = 'game_completed') as game_completions
        from generate_series(
          date_trunc('day', range_start),
          date_trunc('day', now()),
          interval '1 day'
        ) as day_series(day)
        left join public.analytics_events as event
          on event.occurred_at >= day_series.day
          and event.occurred_at < day_series.day + interval '1 day'
        group by day_series.day
      ) as series_row
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(source_row) order by source_row.visitors desc, source_row.source)
      from (
        select
          source_parts.source,
          sum(source_parts.visitors) as visitors,
          sum(source_parts.signups) as signups,
          sum(source_parts.game_players) as game_players,
          sum(source_parts.completers) as completers
        from (
          select
            session.acquisition_source as source,
            count(distinct session.visitor_id) as visitors,
            0::bigint as signups,
            count(distinct event.visitor_id) filter (where event.event_name = 'game_started') as game_players,
            count(distinct event.visitor_id) filter (where event.event_name = 'game_completed') as completers
          from window_sessions as session
          left join window_events as event on event.session_id = session.session_id
          group by session.acquisition_source
          union all
          select
            signup.source,
            0::bigint as visitors,
            count(*)::bigint as signups,
            0::bigint as game_players,
            0::bigint as completers
          from tracked_signup_cohort as signup
          group by signup.source
        ) as source_parts
        group by source_parts.source
        order by visitors desc
        limit 12
      ) as source_row
    ), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(to_jsonb(page_row) order by page_row.views desc, page_row.path)
      from (
        select
          event.path,
          count(*) as views,
          count(distinct event.visitor_id) as visitors
        from window_events as event
        where event.event_name = 'page_view'
        group by event.path
        order by views desc
        limit 12
      ) as page_row
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(to_jsonb(device_row) order by device_row.visitors desc, device_row.label)
      from (
        select coalesce(session.device_type, 'Unknown') as label, count(distinct session.visitor_id) as visitors
        from window_sessions as session
        group by coalesce(session.device_type, 'Unknown')
      ) as device_row
    ), '[]'::jsonb),
    'browsers', coalesce((
      select jsonb_agg(to_jsonb(browser_row) order by browser_row.visitors desc, browser_row.label)
      from (
        select coalesce(session.browser, 'Unknown') as label, count(distinct session.visitor_id) as visitors
        from window_sessions as session
        group by coalesce(session.browser, 'Unknown')
        order by visitors desc
        limit 8
      ) as browser_row
    ), '[]'::jsonb),
    'operating_systems', coalesce((
      select jsonb_agg(to_jsonb(os_row) order by os_row.visitors desc, os_row.label)
      from (
        select coalesce(session.operating_system, 'Unknown') as label, count(distinct session.visitor_id) as visitors
        from window_sessions as session
        group by coalesce(session.operating_system, 'Unknown')
        order by visitors desc
        limit 8
      ) as os_row
    ), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(to_jsonb(country_row) order by country_row.visitors desc, country_row.label)
      from (
        select coalesce(session.country_code, 'Unknown') as label, count(distinct session.visitor_id) as visitors
        from window_sessions as session
        group by coalesce(session.country_code, 'Unknown')
        order by visitors desc
        limit 12
      ) as country_row
    ), '[]'::jsonb),
    'game_modes', coalesce((
      select jsonb_agg(to_jsonb(mode_row) order by mode_row.completions desc, mode_row.mode)
      from (
        select
          coalesce(event.properties ->> 'mode', 'unknown') as mode,
          count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text)) filter (where event.event_name = 'game_started') as starts,
          count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text)) filter (where event.event_name = 'game_completed') as completions,
          count(distinct coalesce(event.properties ->> 'game_id', event.event_id::text)) filter (where event.event_name = 'game_abandoned') as abandonments
        from window_events as event
        where event.event_name in ('game_started', 'game_completed', 'game_abandoned')
        group by coalesce(event.properties ->> 'mode', 'unknown')
      ) as mode_row
    ), '[]'::jsonb),
    'users_total', (select count(*) from auth.users),
    'users_limited', (select count(*) > 2000 from auth.users),
    'users', coalesce((select jsonb_agg(to_jsonb(user_row) order by user_row.created_at desc) from user_rows as user_row), '[]'::jsonb)
  ) into payload;

  return payload;
end;
$$;

revoke all on function public.analytics_admin_dashboard(integer) from public;
grant execute on function public.analytics_admin_dashboard(integer) to authenticated;
