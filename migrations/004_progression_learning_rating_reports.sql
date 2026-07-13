alter table player_profiles
  add column if not exists competitive_rating integer not null default 1200,
  add column if not exists peak_rating integer not null default 1200,
  add column if not exists rating_games integer not null default 0,
  add column if not exists rating_wins integer not null default 0,
  add column if not exists current_season text not null default 'season-1';

alter table player_profiles
  add constraint player_profiles_competitive_rating_range
    check (competitive_rating between 100 and 4000),
  add constraint player_profiles_peak_rating_range
    check (peak_rating between 100 and 4000),
  add constraint player_profiles_rating_games_nonnegative
    check (rating_games >= 0),
  add constraint player_profiles_rating_wins_valid
    check (rating_wins between 0 and rating_games),
  add constraint player_profiles_current_season_valid
    check (char_length(current_season) between 1 and 40
      and current_season ~ '^[A-Za-z0-9._-]+$');

alter table match_results
  add column if not exists rating_before integer,
  add column if not exists rating_after integer,
  add column if not exists rating_change integer;

alter table match_results
  add constraint match_results_rating_before_range
    check (rating_before is null or rating_before between 100 and 4000),
  add constraint match_results_rating_after_range
    check (rating_after is null or rating_after between 100 and 4000),
  add constraint match_results_rating_snapshot_complete
    check (
      (rating_before is null and rating_after is null and rating_change is null)
      or (rating_before is not null and rating_after is not null
        and rating_change = rating_after - rating_before)
    );

create index if not exists player_profiles_competitive_rating_idx
  on player_profiles (competitive_rating desc, rating_games desc, updated_at asc);

create index if not exists match_results_user_created_idx
  on match_results (user_id, created_at desc);

create table if not exists learning_attempts (
  attempt_id uuid primary key,
  user_id uuid not null references app_users(id) on delete cascade,
  question_key text not null check (
    char_length(question_key) between 1 and 120
    and question_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  category text not null check (
    category in ('Mathematics', 'Physics', 'Chemistry', 'Biology', 'Space', 'Computing', 'Engineering')
  ),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  correct boolean not null,
  response_ms integer not null check (response_ms between 0 and 120000),
  created_at timestamptz not null default now()
);

create index if not exists learning_attempts_user_created_idx
  on learning_attempts (user_id, created_at desc);

create table if not exists learning_mastery (
  user_id uuid not null references app_users(id) on delete cascade,
  category text not null check (
    category in ('Mathematics', 'Physics', 'Chemistry', 'Biology', 'Space', 'Computing', 'Engineering')
  ),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  attempts integer not null default 0 check (attempts >= 0),
  correct_answers integer not null default 0 check (correct_answers between 0 and attempts),
  current_streak integer not null default 0 check (current_streak >= 0),
  best_streak integer not null default 0 check (best_streak >= current_streak),
  mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  last_attempt_at timestamptz,
  primary key (user_id, category, difficulty)
);

create index if not exists learning_mastery_user_score_idx
  on learning_mastery (user_id, mastery_score desc);

create table if not exists chat_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references app_users(id) on delete cascade,
  message_id text not null check (
    char_length(message_id) between 1 and 120
    and message_id ~ '^[A-Za-z0-9._~:-]+$'
  ),
  target_player_id text not null check (
    char_length(target_player_id) between 1 and 200
    and target_player_id ~ '^[A-Za-z0-9._~:-]+$'
  ),
  target_user_id uuid references app_users(id) on delete set null,
  target_name text not null check (
    char_length(target_name) between 1 and 64
    and target_name !~ '[[:cntrl:]]'
  ),
  channel text not null check (
    char_length(channel) between 1 and 160
    and channel ~ '^[A-Za-z0-9._~:-]+$'
  ),
  reason text not null check (reason in (
    'harassment', 'hate_speech', 'sexual_content', 'spam', 'cheating',
    'personal_information', 'other'
  )),
  excerpt text check (
    excerpt is null or (char_length(excerpt) between 1 and 280 and excerpt !~ '[[:cntrl:]]')
  ),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references app_users(id) on delete set null,
  unique (reporter_user_id, message_id)
);

create index if not exists chat_reports_status_created_idx
  on chat_reports (status, created_at desc);

create index if not exists chat_reports_target_user_idx
  on chat_reports (target_user_id, created_at desc)
  where target_user_id is not null;
