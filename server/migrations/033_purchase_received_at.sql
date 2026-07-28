alter table purchases add column if not exists received_at timestamptz;

update purchases
set received_at=created_at
where status='已入库' and received_at is null;

create index if not exists purchases_received_at_idx
  on purchases(received_at)
  where deleted_at is null and status='已入库';
