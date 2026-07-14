alter table sales add column if not exists stock_deducted boolean not null default true;
alter table sales add column if not exists delivered boolean not null default false;
alter table sales add column if not exists settled boolean not null default false;
