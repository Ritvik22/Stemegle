alter table matches drop constraint if exists matches_mode_check;
alter table matches add constraint matches_mode_check
  check (mode in ('human', 'bot', 'legacy', 'codegle'));
