-- A person on the Cast and crew list can always read their own row (the one linked to their account), even when their
-- team has no access to the section. Together with 0030 this lets them see their own call times, role and contact
-- details. Everyone else's rows follow the section access as before.
create policy ccrows_read_own on cast_crew_rows for select to authenticated using (account_id = auth.uid());
