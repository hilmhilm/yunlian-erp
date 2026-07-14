alter table sale_items drop constraint if exists sale_items_quantity_check;
alter table sale_items add constraint sale_items_quantity_nonzero check(quantity <> 0);
