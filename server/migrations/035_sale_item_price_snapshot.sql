alter table sale_items
  add column if not exists original_price numeric(14,2),
  add column if not exists discount_percent numeric(9,4);

update sale_items
set original_price=price
where original_price is null;

update sale_items
set discount_percent=0
where discount_percent is null;

alter table sale_items
  alter column original_price set default 0,
  alter column original_price set not null,
  alter column discount_percent set default 0,
  alter column discount_percent set not null;
