create index if not exists sales_report_date_currency_idx
  on sales(created_at,currency) where deleted_at is null;

create index if not exists sale_items_report_product_idx
  on sale_items(product_id,sale_id);

create index if not exists sale_payments_report_date_method_idx
  on sale_payments(booked_on,method,sale_id);

create index if not exists sale_returns_report_date_idx
  on sale_returns(created_at,sale_id);

create index if not exists customers_report_created_idx
  on customers(created_at) where deleted_at is null;
