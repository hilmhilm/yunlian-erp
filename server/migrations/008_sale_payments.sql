create table if not exists sale_payments (
  id bigserial primary key,
  sale_id bigint not null references sales(id) on delete cascade,
  amount numeric(14,2) not null check(amount > 0),
  method text not null check(method in ('cash','bank_transfer')),
  booked_on date not null default current_date,
  category text not null default 'sales_income',
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists sale_payments_sale_id_idx on sale_payments(sale_id,created_at desc);

insert into sale_payments(sale_id,amount,method,booked_on,category,note,created_by)
select s.id,s.total,'cash',s.created_at::date,'sales_income','迁移前已结算',s.created_by
from sales s
where s.settled=true and s.total>0
  and not exists(select 1 from sale_payments sp where sp.sale_id=s.id);
