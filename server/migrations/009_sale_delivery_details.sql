alter table sales add column if not exists delivery_phone text not null default '';
alter table sales add column if not exists vehicle_plate text not null default '';
alter table sales add column if not exists delivery_address text not null default '';
alter table sales add column if not exists delivery_date date not null default current_date;

update sales set delivery_date=created_at::date
where delivery_phone='' and vehicle_plate='' and delivery_address='';
