-- Repair installations where migration 017 was recorded but the old
-- document_type constraint is still present.  This migration is deliberately
-- idempotent so every upgraded NAS accepts cancellation correction documents.
alter table invoices drop constraint if exists invoices_document_type_check;

alter table invoices add constraint invoices_document_type_check
  check (document_type in ('invoice','correction','storno','replacement','cancellation'));
