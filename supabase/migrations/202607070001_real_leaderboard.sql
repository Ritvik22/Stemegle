create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
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

create table if not exists public.matches (
  id text primary key check (char_length(id) between 10 and 200),
  completed_at timestamptz not null default now()
);

create table if not exists public.match_results (
  match_id text not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null check (score between 0 and 100000),
  opponent_score integer not null check (opponent_score between 0 and 100000),
  won boolean not null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists profiles_leaderboard_idx
  on public.profiles (total_score desc, wins desc, updated_at asc);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_name text;
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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, battle_name)
select
  users.id,
  left(
    case
      when char_length(trim(coalesce(users.raw_user_meta_data ->> 'battle_name', split_part(users.email, '@', 1), ''))) >= 2
        then trim(coalesce(users.raw_user_meta_data ->> 'battle_name', split_part(users.email, '@', 1)))
      else 'Player-' || left(users.id::text, 6)
    end,
    30
  )
from auth.users as users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_results enable row level security;

drop policy if exists "Public leaderboard is readable" on public.profiles;
create policy "Public leaderboard is readable"
on public.profiles for select
to anon, authenticated
using (true);

drop policy if exists "Match count is readable" on public.matches;
create policy "Match count is readable"
on public.matches for select
to anon, authenticated
using (true);

create or replace function public.record_match_result(
  p_match_id text,
  p_score integer,
  p_opponent_score integer
)
returns table (
  score_gained integer,
  current_streak integer,
  total_score bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  inserted_rows integer := 0;
  did_win boolean := p_score >= p_opponent_score;
begin
  if p_match_id is null
    or char_length(p_match_id) not between 10 and 200
    or p_score not between 0 and 100000
    or p_opponent_score not between 0 and 100000 then
    raise exception 'Invalid match result';
  end if;

  insert into public.matches (id)
  values (p_match_id)
  on conflict (id) do nothing;

  if current_user_id is null then
    return;
  end if;

  insert into public.match_results (match_id, user_id, score, opponent_score, won)
  values (p_match_id, current_user_id, p_score, p_opponent_score, did_win)
  on conflict (match_id, user_id) do nothing;
  get diagnostics inserted_rows = row_count;

  if inserted_rows = 1 then
    update public.profiles as profile
    set
      total_score = profile.total_score + p_score,
      wins = profile.wins + case when did_win then 1 else 0 end,
      losses = profile.losses + case when did_win then 0 else 1 end,
      matches_played = profile.matches_played + 1,
      streak = case when did_win then profile.streak + 1 else 0 end,
      best_streak = greatest(profile.best_streak, case when did_win then profile.streak + 1 else 0 end)
    where profile.id = current_user_id;
  end if;

  return query
  select
    case when inserted_rows = 1 then p_score else 0 end,
    profile.streak,
    profile.total_score
  from public.profiles as profile
  where profile.id = current_user_id;
end;
$$;

revoke all on function public.record_match_result(text, integer, integer) from public;
grant execute on function public.record_match_result(text, integer, integer) to anon, authenticated;
grant select on public.profiles, public.matches to anon, authenticated;

alter table public.profiles replica identity full;
alter table public.matches replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end;
$$;
