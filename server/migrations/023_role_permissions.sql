create table if not exists role_permissions (
  role text not null check (role in ('purchasing','warehouse','sales','finance')),
  permission_key text not null,
  allowed boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (role,permission_key)
);

insert into role_permissions(role,permission_key) values
('purchasing','page.dashboard'),('purchasing','page.products'),('purchasing','page.purchases'),('purchasing','page.inventory'),('purchasing','page.categories'),('purchasing','page.settings'),
('purchasing','products.manage'),('purchasing','products.images'),('purchasing','products.export'),('purchasing','categories.manage'),('purchasing','categories.export'),('purchasing','purchases.create'),
('warehouse','page.dashboard'),('warehouse','page.products'),('warehouse','page.purchases'),('warehouse','page.inventory'),('warehouse','page.categories'),('warehouse','page.pickingLists'),('warehouse','page.settings'),
('warehouse','products.manage'),('warehouse','products.images'),('warehouse','products.export'),('warehouse','categories.manage'),('warehouse','categories.export'),('warehouse','purchases.create'),('warehouse','picking.print'),
('sales','page.dashboard'),('sales','page.products'),('sales','page.inventory'),('sales','page.categories'),('sales','page.customers'),('sales','page.sales'),('sales','page.scanSales'),('sales','page.collectorSales'),('sales','page.invoiceList'),('sales','page.issueInvoice'),('sales','page.settings'),
('sales','products.images'),('sales','products.export'),('sales','categories.export'),('sales','customers.manage'),('sales','sales.create'),('sales','sales.edit'),('sales','sales.status'),('sales','sales.settle'),('sales','sales.print'),('sales','invoices.issue'),('sales','invoices.download'),
('finance','page.dashboard'),('finance','page.products'),('finance','page.purchases'),('finance','page.inventory'),('finance','page.categories'),('finance','page.customers'),('finance','page.sales'),('finance','page.flowDetails'),('finance','page.invoiceList'),('finance','page.issueInvoice'),('finance','page.reports'),('finance','page.settings'),
('finance','products.export'),('finance','categories.export'),('finance','sales.settle'),('finance','sales.print'),('finance','invoices.issue'),('finance','invoices.manage'),('finance','invoices.download'),('finance','finance.create'),('finance','reports.export')
on conflict(role,permission_key) do nothing;
