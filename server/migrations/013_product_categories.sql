create table if not exists product_categories (
  id bigserial primary key,
  parent_id bigint references product_categories(id) on delete restrict,
  name text not null,
  name2 text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create unique index if not exists product_categories_name_uidx on product_categories(lower(name));
create index if not exists product_categories_parent_id_idx on product_categories(parent_id);

insert into product_categories(name)
select distinct btrim(category)
from products
where nullif(btrim(category),'') is not null
on conflict do nothing;
