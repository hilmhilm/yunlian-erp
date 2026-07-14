create table if not exists sale_returns (
  id bigserial primary key,
  return_no text not null unique,
  sale_id bigint not null references sales(id),
  total numeric(14,2) not null default 0,
  reason text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists sale_return_items (
  id bigserial primary key,
  return_id bigint not null references sale_returns(id) on delete cascade,
  sale_item_id bigint not null references sale_items(id),
  product_id bigint not null references products(id),
  quantity integer not null check(quantity > 0),
  price numeric(14,2) not null default 0
);

create index if not exists sale_returns_sale_id_idx on sale_returns(sale_id);
create index if not exists sale_return_items_sale_item_id_idx on sale_return_items(sale_item_id);
