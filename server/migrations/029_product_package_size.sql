alter table products add column if not exists package_size integer not null default 1;

alter table products drop constraint if exists products_package_size_positive;
alter table products add constraint products_package_size_positive check (package_size > 0);
