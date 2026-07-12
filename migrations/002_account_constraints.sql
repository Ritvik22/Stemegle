alter table app_users
  add constraint app_users_name_length
    check (char_length(name) between 2 and 30),
  add constraint app_users_name_no_controls
    check (name !~ '[[:cntrl:]]'),
  add constraint app_users_email_length
    check (char_length(email) between 3 and 320),
  add constraint app_users_role_allowed
    check (role in ('user', 'admin'));

create unique index app_users_email_lower_uidx on app_users (lower(email));
create index auth_sessions_expires_at_idx on auth_sessions (expires_at);

alter table match_results
  add column participant_id text
    check (participant_id is null or char_length(participant_id) between 8 and 200);
create unique index match_results_participant_uidx
  on match_results (match_id, participant_id)
  where participant_id is not null;

alter table analytics_user_attribution
  drop constraint analytics_user_attribution_visitor_id_fkey,
  add constraint analytics_user_attribution_visitor_id_fkey
    foreign key (visitor_id) references analytics_visitors(visitor_id) on delete restrict;
