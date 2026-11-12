-- Step 2 of 2: every team starts with the same Equipment access it already had for Props.
-- New projects get a row for every section automatically (create_project loops over all section keys).
insert into team_section_access (team_id, section, level)
select team_id, 'equipment'::section_key, level from team_section_access where section = 'props'
on conflict do nothing;
