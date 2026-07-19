alter table customers add column if not exists country text not null default 'Magyarország';
alter table customers add column if not exists postal_code text not null default '';
alter table customers add column if not exists tax_number text not null default '';
alter table customers add column if not exists email text not null default '';
alter table customers add column if not exists updated_at timestamptz not null default now();

create table if not exists invoices (
  id bigserial primary key,
  sale_id bigint not null unique references sales(id) on delete restrict,
  provider text not null default 'szamlazz.hu',
  external_id text not null unique,
  invoice_number text unique,
  status text not null default 'processing' check (status in ('processing','issued','failed')),
  payment_method text not null check (payment_method in ('cash','bank_transfer')),
  fulfillment_date date not null,
  due_date date not null,
  currency text not null check (currency in ('HUF','EUR','USD')),
  exchange_rate numeric(14,4),
  exchange_rate_bank text not null default 'MNB',
  price_factor numeric(14,6) not null default 1 check (price_factor > 0),
  net_total numeric(14,2) not null default 0,
  vat_total numeric(14,2) not null default 0,
  gross_total numeric(14,2) not null default 0,
  pdf_path text not null default '',
  error_code text not null default '',
  error_message text not null default '',
  created_by text not null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists invoice_items (
  id bigserial primary key,
  invoice_id bigint not null references invoices(id) on delete cascade,
  sale_item_id bigint not null references sale_items(id) on delete restrict,
  product_id bigint not null references products(id) on delete restrict,
  sku text not null,
  name text not null,
  unit text not null,
  quantity integer not null,
  net_unit_price numeric(14,2) not null,
  vat_rate numeric(5,2) not null default 27,
  net_total numeric(14,2) not null,
  vat_total numeric(14,2) not null,
  gross_total numeric(14,2) not null,
  unique(invoice_id,sale_item_id)
);

create index if not exists invoices_created_at_idx on invoices(created_at desc);
create index if not exists invoice_items_invoice_id_idx on invoice_items(invoice_id);
