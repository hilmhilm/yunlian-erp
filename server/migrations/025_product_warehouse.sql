alter table products
  add column if not exists storage_warehouse text not null default '';

update products
set storage_warehouse = coalesce(
  (select default_warehouse from system_settings where id = true),
  '主仓库'
)
where btrim(storage_warehouse) = '';
