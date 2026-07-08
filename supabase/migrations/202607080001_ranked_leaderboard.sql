create or replace view public.leaderboard_rankings
with (security_invoker = true)
as
select
  row_number() over (
    order by
      profile.total_score desc,
      profile.wins desc,
      profile.matches_played desc,
      profile.created_at asc,
      profile.id asc
  ) as rank_position,
  profile.id,
  profile.battle_name,
  profile.total_score,
  profile.wins,
  profile.losses,
  profile.matches_played,
  profile.streak
from public.profiles as profile;

grant select on public.leaderboard_rankings to anon, authenticated;
