create table if not exists system_settings (
  id boolean primary key default true check (id),
  company_name text not null default '云链 ERP',
  tax_number text not null default '',
  registration_number text not null default '',
  company_address text not null default '',
  company_phone text not null default '',
  company_email text not null default '',
  company_website text not null default '',
  eur_huf_rate numeric(14,4) not null default 357.351,
  usd_huf_rate numeric(14,4) not null default 313.465,
  default_currency text not null default 'HUF' check (default_currency in ('HUF','EUR','USD')),
  allow_overselling boolean not null default true,
  low_stock_threshold integer not null default 20 check (low_stock_threshold >= 0),
  default_warehouse text not null default '主仓库',
  sales_order_prefix text not null default 'Vs',
  purchase_order_prefix text not null default 'Vin',
  updated_at timestamptz not null default now()
);

insert into system_settings(id) values(true) on conflict(id) do nothing;
