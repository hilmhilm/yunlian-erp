alter table invoices drop constraint if exists invoices_sale_id_key;

alter table invoices
  add column if not exists document_type text not null default 'invoice',
  add column if not exists parent_invoice_id bigint references invoices(id) on delete restrict,
  add column if not exists reason text not null default '',
  add column if not exists buyer_name text not null default '',
  add column if not exists buyer_country text not null default '',
  add column if not exists buyer_postal_code text not null default '',
  add column if not exists buyer_city text not null default '',
  add column if not exists buyer_address text not null default '',
  add column if not exists buyer_tax_number text not null default '',
  add column if not exists buyer_email text not null default '';

do $$ begin
  alter table invoices add constraint invoices_document_type_check
    check (document_type in ('invoice','correction','storno','replacement'));
exception when duplicate_object then null;
end $$;

update invoices i set
  buyer_name=coalesce(c.name,''),
  buyer_country=coalesce(c.country,''),
  buyer_postal_code=coalesce(c.postal_code,''),
  buyer_city=coalesce(c.city,''),
  buyer_address=coalesce(c.address,''),
  buyer_tax_number=coalesce(c.tax_number,''),
  buyer_email=coalesce(c.email,'')
from sales s left join customers c on c.id=s.customer_id
where s.id=i.sale_id and i.buyer_name='';

alter table invoice_items drop constraint if exists invoice_items_invoice_id_sale_item_id_key;

create index if not exists invoices_sale_id_idx on invoices(sale_id,created_at desc);
create index if not exists invoices_parent_invoice_id_idx on invoices(parent_invoice_id);
