-- Bot (practice) matches count toward the global "matches completed" total,
-- but must NOT award ranked score / wins / streak — otherwise players could
-- farm the leaderboard against an easy AI. This function only records the match
-- row (which the global counter reads); it deliberately never touches profiles.

create or replace function public.record_bot_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_match_id is null or char_length(p_match_id) not between 10 and 200 then
    raise exception 'Invalid bot match';
  end if;

  insert into public.matches (id)
  values (p_match_id)
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.record_bot_match(text) from public;
grant execute on function public.record_bot_match(text) to anon, authenticated;
