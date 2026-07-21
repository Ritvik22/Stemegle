create table question_pack_images (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size integer not null check (byte_size between 1 and 1048576),
  image_data bytea not null,
  created_at timestamptz not null default now()
);

create table question_packs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references app_users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table question_pack_questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references question_packs(id) on delete cascade,
  position smallint not null check (position between 0 and 49),
  prompt text not null check (char_length(prompt) between 1 and 300),
  choices jsonb not null check (
    jsonb_typeof(choices) = 'array'
    and jsonb_array_length(choices) = 4
  ),
  answer_index smallint not null check (answer_index between 0 and 3),
  image_id uuid references question_pack_images(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (pack_id, position)
);

create index question_packs_owner_updated_idx
  on question_packs (owner_user_id, updated_at desc);
create index question_pack_questions_pack_position_idx
  on question_pack_questions (pack_id, position);
create index question_pack_images_owner_created_idx
  on question_pack_images (owner_user_id, created_at desc);
