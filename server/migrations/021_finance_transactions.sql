create table if not exists finance_transactions (
  id bigserial primary key,
  occurred_on date not null default current_date,
  direction text not null check(direction in ('income','expense')),
  category text not null,
  payment_method text not null check(payment_method in ('cash','bank_transfer')),
  currency text not null check(currency in ('HUF','EUR','USD')),
  amount numeric(14,2) not null check(amount > 0),
  note text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists finance_transactions_occurred_on_idx
  on finance_transactions(occurred_on desc,id desc);
