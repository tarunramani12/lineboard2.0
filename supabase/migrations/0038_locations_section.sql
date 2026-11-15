-- Locations, step 1 of 2: a new section key. (A new enum value cannot be used in the same step, so the access
-- settings, tables and policies come in 0039. Run this file first, then 0039.)
alter type section_key add value if not exists 'locations';
