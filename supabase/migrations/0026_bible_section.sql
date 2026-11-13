-- Project bible, step 1 of 2: a new section key. (A new enum value cannot be used in the same step, so the access
-- settings, tables and policies come in 0027. Run this file first, then 0027.)
alter type section_key add value if not exists 'bible';
