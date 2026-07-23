insert into role_permissions(role, permission_key, allowed)
values ('warehouse', 'inventory.locations', true)
on conflict(role, permission_key)
do update set allowed = true;
