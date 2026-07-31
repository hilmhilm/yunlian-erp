alter table sales
  add column if not exists manual_discount_percent numeric(5,2) not null default 0,
  add column if not exists pricing_mode text not null default 'standard';

alter table sales drop constraint if exists sales_manual_discount_percent_check;
alter table sales add constraint sales_manual_discount_percent_check
  check(manual_discount_percent >= 0 and manual_discount_percent <= 100);

alter table sales drop constraint if exists sales_pricing_mode_check;
alter table sales add constraint sales_pricing_mode_check
  check(pricing_mode in ('standard','last_customer'));

create index if not exists sales_customer_currency_history_idx
  on sales(customer_id,currency,created_at desc,id desc)
  where deleted_at is null and customer_id is not null;
