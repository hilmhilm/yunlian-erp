create table if not exists audit_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id bigint references app_users(id) on delete set null,
  username text not null,
  user_role text not null,
  module text not null,
  action text not null,
  entity_type text not null default '',
  entity_id text not null default '',
  http_method text not null,
  request_path text not null,
  status_code integer not null,
  success boolean not null,
  details jsonb not null default '{}'::jsonb,
  ip_address text not null default ''
);

create index if not exists audit_logs_created_at_idx on audit_logs(created_at desc);
create index if not exists audit_logs_username_idx on audit_logs(username,created_at desc);
create index if not exists audit_logs_module_idx on audit_logs(module,created_at desc);
