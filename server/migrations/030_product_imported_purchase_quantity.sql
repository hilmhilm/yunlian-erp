alter table products add column if not exists imported_purchase_quantity integer not null default 0;

alter table products drop constraint if exists products_imported_purchase_quantity_nonnegative;
alter table products add constraint products_imported_purchase_quantity_nonnegative check (imported_purchase_quantity >= 0);
