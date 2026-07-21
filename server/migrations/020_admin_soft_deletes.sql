alter table products add column if not exists deleted_at timestamptz;
alter table products add column if not exists deleted_by text;
alter table product_categories add column if not exists deleted_at timestamptz;
alter table product_categories add column if not exists deleted_by text;
alter table customers add column if not exists deleted_at timestamptz;
alter table customers add column if not exists deleted_by text;
alter table purchases add column if not exists deleted_at timestamptz;
alter table purchases add column if not exists deleted_by text;
alter table sales add column if not exists deleted_at timestamptz;
alter table sales add column if not exists deleted_by text;
alter table invoices add column if not exists deleted_at timestamptz;
alter table invoices add column if not exists deleted_by text;

alter table products drop constraint if exists products_sku_key;
drop index if exists products_sku_active_uidx;
create unique index products_sku_active_uidx on products(sku) where deleted_at is null;

alter table purchases drop constraint if exists purchases_order_no_key;
drop index if exists purchases_order_no_active_uidx;
create unique index purchases_order_no_active_uidx on purchases(order_no) where deleted_at is null;

alter table sales drop constraint if exists sales_order_no_key;
drop index if exists sales_order_no_active_uidx;
create unique index sales_order_no_active_uidx on sales(order_no) where deleted_at is null;

drop index if exists product_categories_name_uidx;
drop index if exists product_categories_name_active_uidx;
create unique index product_categories_name_active_uidx on product_categories(lower(name)) where deleted_at is null;

create index if not exists products_not_deleted_idx on products(id) where deleted_at is null;
create index if not exists product_categories_not_deleted_idx on product_categories(id) where deleted_at is null;
create index if not exists customers_not_deleted_idx on customers(id) where deleted_at is null;
create index if not exists purchases_not_deleted_idx on purchases(id) where deleted_at is null;
create index if not exists sales_not_deleted_idx on sales(id) where deleted_at is null;
create index if not exists invoices_not_deleted_idx on invoices(id) where deleted_at is null;
