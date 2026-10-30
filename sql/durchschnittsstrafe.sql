-- Durchschnittsstrafe (average fine) for absentees, calculated in the database.
--
-- Replaces the browser-side applyAverageFine() in schedule.js, which only ran
-- when somebody happened to open the schedule page after an appointment ended.
-- A pg_cron job now checks every 5 minutes for appointments that ended more
-- than 60 minutes ago and were not handled yet.
--
-- Rules (identical to the old client logic, plus the grace period):
--   * only appointments of type 'Training' with an end_time — fines at other
--     appointment types (tournament, event, gameday) never affect other members
--   * fines counted: type 'fine' created between the appointment's start and
--     end + 60 min — but never beyond the start of the next appointment —
--     excluding bounty stakes ('Bountyeinsatz%') and earlier average fines
--     (their note is 'appt:<id>')
--   * per-head amount = total / number of present members/admins (yes votes),
--     rounded to cents
--   * every other member/admin with a linked player gets that amount as a fine
--     'Durchschnitt <title>', note 'appt:<id>', created_by 'system'
--   * handled appointments are flagged in fines_processed_at (same transaction
--     as the inserts), so nothing can be booked twice
--
-- Rollback: sql/durchschnittsstrafe-rollback.sql

-- 1. Marker: has this appointment's average fine been handled?
alter table public.appointments
    add column if not exists fines_processed_at timestamptz;

-- 2. Everything the browser logic already handled (status 'past') stays untouched
update public.appointments
   set fines_processed_at = coalesce(end_time, now())
 where status = 'past'
   and fines_processed_at is null;

-- 3. The job function
create or replace function public.process_average_fines()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    a              record;
    win_start      timestamptz;
    win_end        timestamptz;
    next_start     timestamptz;
    total          numeric;
    present_cnt    integer;
    avg_amt        numeric;
    reason_name    text;
    note_txt       text;
    inserted       integer;
    inserted_total integer := 0;
begin
    for a in
        select *
          from appointments
         where type = 'Training'
           and end_time is not null
           and fines_processed_at is null
           and end_time + interval '60 minutes' <= now()
         order by end_time
           for update skip locked
    loop
        win_start := coalesce(a.start_time, a."date");

        -- 60 min grace period after the end, but never into the next appointment
        select min(coalesce(o.start_time, o."date"))
          into next_start
          from appointments o
         where o.id <> a.id
           and coalesce(o.start_time, o."date") > win_start;

        win_end := greatest(
            a.end_time,
            least(a.end_time + interval '60 minutes', coalesce(next_start, 'infinity'::timestamptz))
        );

        reason_name := 'Durchschnitt ' || a.title;
        note_txt    := 'appt:' || a.id::text;

        -- present = members/admins with a 'yes' vote (guests don't count)
        select count(distinct u.player_id)
          into present_cnt
          from app_users u
          join appointment_votes v
            on v.user_id::text = u.id::text
           and v.appointment_id = a.id
           and v.vote = 'yes'
         where u.role in ('member', 'admin')
           and u.player_id is not null;

        select coalesce(sum(f.amount), 0)
          into total
          from fines_ledger f
         where f.type = 'fine'
           and f.created_at >= win_start
           and f.created_at <= win_end
           and coalesce(f.reason, '') not like 'Bountyeinsatz%'
           and (f.note is null or f.note not like 'appt:%');

        if present_cnt > 0 then
            avg_amt := round(total / present_cnt, 2);

            if avg_amt > 0 then
                insert into fines_ledger (player_id, amount, type, reason, note, created_by)
                select distinct u.player_id, avg_amt, 'fine', reason_name, note_txt, 'system'
                  from app_users u
                 where u.role in ('member', 'admin')
                   and u.player_id is not null
                   and not exists (
                       select 1
                         from appointment_votes v
                        where v.appointment_id = a.id
                          and v.vote = 'yes'
                          and v.user_id::text = u.id::text
                   )
                   and not exists (
                       select 1
                         from fines_ledger x
                        where x.reason = reason_name
                          and x.note = note_txt
                          and x.player_id = u.player_id
                   );

                get diagnostics inserted = row_count;
                inserted_total := inserted_total + inserted;
            end if;
        end if;

        update appointments set fines_processed_at = now() where id = a.id;
    end loop;

    return inserted_total;
end;
$$;

-- 4. Run every 5 minutes
select cron.schedule(
    'durchschnittsstrafe',
    '*/5 * * * *',
    $$select public.process_average_fines();$$
);

-- Check afterwards (last runs of the job, errors show up here):
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'durchschnittsstrafe')
--    order by start_time desc limit 5;
