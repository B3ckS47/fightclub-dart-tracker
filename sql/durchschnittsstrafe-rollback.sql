-- Undo sql/durchschnittsstrafe.sql
-- (Fines already booked by the job stay in fines_ledger.)
--
-- NOTE: the browser-side calculation was removed from schedule.js together
-- with the job. After this rollback, restore schedule.js from git
-- (commit before "Schedule: average fine moves into the database") as well.

select cron.unschedule('durchschnittsstrafe');

drop function if exists public.process_average_fines();

alter table public.appointments drop column if exists fines_processed_at;
