alter table invoices drop constraint if exists invoices_document_type_check;

alter table invoices add constraint invoices_document_type_check
  check (document_type in ('invoice','correction','storno','replacement','cancellation'));
