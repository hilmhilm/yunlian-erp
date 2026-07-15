alter table products
  add column if not exists price_eur numeric(14,2) not null default 0,
  add column if not exists price_usd numeric(14,2) not null default 0;

alter table sales
  add column if not exists currency text not null default 'HUF';

alter table sales drop constraint if exists sales_currency_check;
alter table sales add constraint sales_currency_check check(currency in ('HUF','EUR','USD'));
