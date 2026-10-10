-- Run once in the Supabase SQL editor (project zfirdbbyiagmrfsmcqrx).
create table if not exists carer_text_log (
  id bigserial primary key,
  shift_id text not null,
  kind text not null,            -- checkin | checkout | notes_1 | notes_2 | notes_3
  status text not null default 'claimed',  -- claimed | sent | skipped | no_phone | dry_run
  carer_id text not null default '',
  phone text,
  twilio_sid text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (shift_id, kind, carer_id)
);

alter table carer_text_log enable row level security;
