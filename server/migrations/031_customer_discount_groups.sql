create table if not exists customer_groups (
  id bigserial primary key,
  name text not null,
  discount_percent numeric(5,2) not null default 0 check(discount_percent >= 0 and discount_percent <= 100),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text
);

create unique index if not exists customer_groups_name_active_unique
  on customer_groups(lower(btrim(name))) where deleted_at is null;

alter table customers add column if not exists customer_group_id bigint references customer_groups(id) on delete set null;
alter table customers add column if not exists notes text not null default '';
alter table sales add column if not exists customer_discount_percent numeric(5,2) not null default 0;

insert into customer_groups(name)
select distinct btrim(customer_group)
from customers
where nullif(btrim(customer_group),'') is not null
on conflict do nothing;

update customers c
set customer_group_id=g.id
from customer_groups g
where c.customer_group_id is null
  and g.deleted_at is null
  and lower(btrim(g.name))=lower(btrim(c.customer_group));

create index if not exists customers_customer_group_id_idx on customers(customer_group_id) where deleted_at is null;
