create table if not exists products (
  id bigserial primary key, sku text not null unique, barcode text default '', name text not null, name2 text not null default '',
  category text default '', supplier text default '', unit text default '个', box_size integer not null default 1, package_size integer not null default 1,
  cost numeric(14,2) not null default 0, price numeric(14,2) not null default 0, stock integer not null default 0, imported_purchase_quantity integer not null default 0, image_url text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists product_categories (id bigserial primary key, parent_id bigint references product_categories(id) on delete restrict, name text not null, name2 text not null default '', image_url text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(parent_id is null or parent_id<>id));
create unique index if not exists product_categories_name_uidx on product_categories(lower(name));
create index if not exists product_categories_parent_id_idx on product_categories(parent_id);
create index if not exists products_search_idx on products using gin (to_tsvector('simple',sku||' '||barcode||' '||name));
create table if not exists system_settings (
  id boolean primary key default true check (id), company_name text not null default '云链 ERP', tax_number text not null default '', registration_number text not null default '', company_address text not null default '', company_phone text not null default '', company_email text not null default '', company_website text not null default '', eur_huf_rate numeric(14,4) not null default 357.351, usd_huf_rate numeric(14,4) not null default 313.465, default_currency text not null default 'HUF' check (default_currency in ('HUF','EUR','USD')), allow_overselling boolean not null default true, low_stock_threshold integer not null default 20 check (low_stock_threshold >= 0), default_warehouse text not null default '主仓库', sales_order_prefix text not null default 'Vs', purchase_order_prefix text not null default 'Vin', updated_at timestamptz not null default now()
);
insert into system_settings(id) values(true) on conflict(id) do nothing;
create table if not exists supported_locales (
  locale text primary key, display_name text not null, enabled boolean not null default true, is_default boolean not null default false
);
insert into supported_locales(locale,display_name,is_default) values
('zh-CN','简体中文',true),('en','English',false),('hu','Magyar',false)
on conflict(locale) do nothing;
create table if not exists product_translations (
  product_id bigint not null references products(id) on delete cascade,
  locale text not null references supported_locales(locale),
  name text not null, description text default '',
  primary key(product_id,locale)
);
create table if not exists customer_groups (
  id bigserial primary key, name text not null, discount_percent numeric(5,2) not null default 0,
  notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text
);
create table if not exists customers (
  id bigserial primary key, name text not null, phone text default '', vehicle_plate text not null default '', city text default '', address text default '',
  customer_group text default '零售', customer_group_id bigint references customer_groups(id) on delete set null, notes text not null default '', created_at timestamptz not null default now()
);
create table if not exists purchases (
  id bigserial primary key, order_no text not null unique, supplier text not null, warehouse text not null default '主仓库',
  total numeric(14,2) not null default 0, status text not null default '未入库', received_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists purchase_items (id bigserial primary key, purchase_id bigint references purchases(id) on delete cascade, product_id bigint references products(id), quantity integer not null check(quantity>0), cost numeric(14,2) not null default 0);
create table if not exists sales (
  id bigserial primary key, order_no text not null unique, customer_id bigint references customers(id), total numeric(14,2) not null default 0,
  status text not null default '已完成', customer_discount_percent numeric(5,2) not null default 0, manual_discount_percent numeric(5,2) not null default 0,
  pricing_mode text not null default 'standard', created_by text not null, created_at timestamptz not null default now()
);
create table if not exists sale_items (id bigserial primary key, sale_id bigint references sales(id) on delete cascade, product_id bigint references products(id), quantity integer not null check(quantity>0), original_price numeric(14,2) not null default 0, discount_percent numeric(9,4) not null default 0, price numeric(14,2) not null default 0);
create table if not exists inventory_movements (id bigserial primary key, product_id bigint references products(id), warehouse text not null default '主仓库', quantity integer not null, movement_type text not null, reference_no text, created_by text, created_at timestamptz not null default now());

insert into products(sku,barcode,name,category,supplier,box_size,cost,price,stock) values
('280699','8435798704656','我的世界钱包','书包 / 钱包','Kitty',96,2.18,850,480),
('481644','8435798707565','三层我的世界大书包','书包','Kitty',12,12.20,4500,480),
('480644','8435798707534','三层我的世界大书包 绿底方块','书包','Kitty',12,12.20,4500,468),
('217659','8435798704694','双层笔袋 Hello Kitty','文具','K2046',24,3.08,1200,480),
('224659','8435798706704','双层笔袋 库洛米','文具','K2046',24,3.08,1200,1080)
on conflict(sku) do nothing;
insert into customers(name,phone,city,address,customer_group) values
('Szathmáry-Péter Noémi','','Keszthely','8360 Keszthely, Kossuth Lajos utca 13','零售'),
('Rehuir Alga Kft. 3号店','06305708525','Budapest','1141 Budapest, Cinkotai út 66.','批发 A'),
('Clothes 4ever kft','0670-2766668','Budapest','1143 Budapest, Zászlós utca 29-31.','批发 B');
