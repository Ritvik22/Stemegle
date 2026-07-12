alter table app_users
  add column contact_email text,
  add constraint app_users_contact_email_valid check (
    contact_email is null
    or (
      char_length(contact_email) between 3 and 320
      and contact_email = lower(contact_email)
      and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create index app_users_contact_email_lower_idx
  on app_users (lower(contact_email))
  where contact_email is not null;
