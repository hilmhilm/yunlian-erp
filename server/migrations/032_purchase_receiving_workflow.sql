update purchases set status='未入库' where status='待审核';
alter table purchases alter column status set default '未入库';
alter table purchases add column if not exists updated_at timestamptz not null default now();
