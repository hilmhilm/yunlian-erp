alter table products
  add column if not exists storage_location text not null default '';
