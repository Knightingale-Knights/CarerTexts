-- Run once in the Supabase SQL editor, BEFORE deploying the worker that sends per carer.
-- A text is now remembered per (shift, kind, carer), so a carer added to a shift later still gets their text.
update carer_text_log set carer_id = '' where carer_id is null;
alter table carer_text_log alter column carer_id set not null;
alter table carer_text_log drop constraint if exists carer_text_log_shift_id_kind_key;
alter table carer_text_log add constraint carer_text_log_shift_kind_carer_key unique (shift_id, kind, carer_id);
