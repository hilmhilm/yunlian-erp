create table if not exists app_users (
  id bigserial primary key,
  username text not null,
  password_hash text not null,
  display_name text not null default '',
  role text not null default 'sales' check (role in ('admin','purchasing','warehouse','sales','finance')),
  enabled boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_users_username_lower_idx on app_users(lower(username));
