alter table customers add column if not exists vehicle_plate text not null default '';

create index if not exists customers_vehicle_plate_lower_idx on customers(lower(vehicle_plate)) where deleted_at is null and vehicle_plate <> '';
