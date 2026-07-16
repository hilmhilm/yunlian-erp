alter table products add column if not exists name2 text not null default '';
create index if not exists sale_items_product_id_idx on sale_items(product_id);
