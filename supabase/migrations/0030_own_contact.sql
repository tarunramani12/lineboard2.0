-- A person on the Cast and crew list can always read their own phone and email (the row linked to their account).
-- Everyone else's contact details stay visible only to the owner, admins and the AD team, and only those who could
-- change a contact before can still change it. This adds a read rule; nothing else changes.
create policy cccontacts_read_own on cast_crew_contacts for select to authenticated
  using (exists (select 1 from cast_crew_rows r where r.id = cast_crew_contacts.row_id and r.account_id = auth.uid()));
