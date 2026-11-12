-- Props and equipment become two sections, because they belong to different departments.
-- Step 1 of 2: the existing section keeps its settings and is renamed Props; Equipment is added.
-- (A new enum value cannot be used in the same step, so the settings for Equipment are copied in 0018.)
alter type section_key rename value 'props_equipment' to 'props';
alter type section_key add value if not exists 'equipment';
