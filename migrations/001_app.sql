create extension if not exists pgcrypto;

create table if not exists player_profiles (
  user_id uuid primary key references app_users(id) on delete cascade,
  total_score bigint not null default 0 check (total_score >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  matches_played integer not null default 0 check (matches_played >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists legacy_profiles (
  legacy_id uuid primary key,
  battle_name text not null check (char_length(battle_name) between 2 and 30),
  total_score bigint not null default 0 check (total_score >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  matches_played integer not null default 0 check (matches_played >= 0),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists matches (
  id text primary key check (char_length(id) between 10 and 200),
  mode text not null default 'human' check (mode in ('human', 'bot', 'legacy')),
  completed_at timestamptz not null default now()
);

create table if not exists match_results (
  match_id text not null references matches(id) on delete cascade,
  user_id uuid not null references player_profiles(user_id) on delete cascade,
  score integer not null check (score between 0 and 6000),
  opponent_score integer not null check (opponent_score between 0 and 6000),
  won boolean not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists player_profiles_leaderboard_idx
  on player_profiles (total_score desc, wins desc, matches_played desc, created_at asc);

create or replace function create_player_profile()
returns trigger
language plpgsql
as $$
begin
  insert into player_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists app_user_profile_created on app_users;
create trigger app_user_profile_created
after insert on app_users
for each row execute function create_player_profile();

insert into player_profiles (user_id)
select id from app_users
on conflict (user_id) do nothing;

create or replace view leaderboard_rankings as
with ranked as (
  select
    users.id::text as id,
    users.name as battle_name,
    profile.total_score,
    profile.wins,
    profile.losses,
    profile.matches_played,
    profile.streak,
    profile.created_at,
    false as legacy
  from player_profiles as profile
  join app_users as users on users.id = profile.user_id
  union all
  select
    legacy.legacy_id::text,
    legacy.battle_name,
    legacy.total_score,
    legacy.wins,
    legacy.losses,
    legacy.matches_played,
    legacy.streak,
    legacy.created_at,
    true
  from legacy_profiles as legacy
)
select
  row_number() over (
    order by total_score desc, wins desc, matches_played desc, created_at asc, id asc
  ) as rank_position,
  id,
  battle_name,
  total_score,
  wins,
  losses,
  matches_played,
  streak,
  legacy
from ranked;

create table if not exists analytics_visitors (
  visitor_id uuid primary key,
  user_id uuid references app_users(id) on delete set null,
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

create table if not exists analytics_sessions (
  session_id uuid primary key,
  visitor_id uuid not null references analytics_visitors(visitor_id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
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

create table if not exists analytics_user_attribution (
  user_id uuid primary key references app_users(id) on delete cascade,
  visitor_id uuid not null references analytics_visitors(visitor_id) on delete cascade,
  session_id uuid references analytics_sessions(session_id) on delete set null,
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

create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,
  session_id uuid not null references analytics_sessions(session_id) on delete cascade,
  visitor_id uuid not null references analytics_visitors(visitor_id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  event_name text not null,
  path text not null default '/',
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists analytics_visitors_user_idx
  on analytics_visitors (user_id) where user_id is not null;
create index if not exists analytics_visitors_seen_idx
  on analytics_visitors (last_seen_at desc);
create index if not exists analytics_sessions_visitor_idx
  on analytics_sessions (visitor_id, started_at desc);
create index if not exists analytics_sessions_user_idx
  on analytics_sessions (user_id, started_at desc) where user_id is not null;
create index if not exists analytics_sessions_started_idx
  on analytics_sessions (started_at desc);
create index if not exists analytics_events_occurred_idx
  on analytics_events (occurred_at desc);
create index if not exists analytics_events_name_occurred_idx
  on analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_visitor_idx
  on analytics_events (visitor_id, occurred_at desc);
create index if not exists analytics_events_user_idx
  on analytics_events (user_id, occurred_at desc) where user_id is not null;
create index if not exists analytics_user_attribution_visitor_idx
  on analytics_user_attribution (visitor_id);
