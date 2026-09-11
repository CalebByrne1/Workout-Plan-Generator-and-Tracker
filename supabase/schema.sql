-- ==========================================================================
-- Iron Ledger — the sync table.
--
-- Paste this whole file into Supabase: SQL Editor → New query → Run.
-- Safe to run more than once.
--
-- One row per account, holding the app's entire save as JSON. The app is
-- the only thing that reads or writes it (see js/sync.js).
--
-- Security, in two layers:
--   · The signed-in role is granted this table and nothing else. Anonymous
--     visitors get nothing at all. (This project has "Automatically expose
--     new tables" switched OFF, so without the grant below the app couldn't
--     reach the table.)
--   · Row-level security: every rule below says "only your own row". The
--     publishable key in the app is public by design — this is what makes
--     that safe.
-- ==========================================================================

create table if not exists public.ledgers (
  user_id    uuid        primary key default auth.uid()
                         references auth.users (id) on delete cascade,
  data       jsonb       not null,
  rev        bigint      not null default 1,
  device     text,
  updated_at timestamptz not null default now()
);

comment on table public.ledgers is
  'Iron Ledger: one row per account, holding the whole save as JSON.';

-- Switched on automatically for new tables in this project, but said out
-- loud so the file is correct anywhere it's run.
alter table public.ledgers enable row level security;

revoke all on table public.ledgers from anon;
grant select, insert, update, delete on table public.ledgers to authenticated;

drop policy if exists "read own ledger"   on public.ledgers;
drop policy if exists "create own ledger" on public.ledgers;
drop policy if exists "update own ledger" on public.ledgers;
drop policy if exists "delete own ledger" on public.ledgers;

create policy "read own ledger" on public.ledgers
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "create own ledger" on public.ledgers
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "update own ledger" on public.ledgers
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "delete own ledger" on public.ledgers
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The server, not the device, numbers every write and stamps its time.
-- A device can't skip a rev or claim a time its clock made up, and the rev
-- is what lets the app notice when two devices wrote at once: a write only
-- lands if the row is still at the rev the device last saw.
create or replace function public.ledgers_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    new.rev := old.rev + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Nobody should be able to call the trigger function directly.
revoke all on function public.ledgers_stamp() from public, anon, authenticated;

drop trigger if exists ledgers_stamp on public.ledgers;
create trigger ledgers_stamp
  before insert or update on public.ledgers
  for each row execute function public.ledgers_stamp();
