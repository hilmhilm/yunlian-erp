alter table sales
  add column if not exists notes text not null default '';
