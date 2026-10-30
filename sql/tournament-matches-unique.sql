-- One tournament slot = one match: no double-generated rounds.
--
-- When the last two matches of a Swiss/Bounty round finish at the same moment,
-- both devices could create the next round (happened once so far: "Einzel -
-- Training - 29.07", a second "Runde 3 / Loser #1"). game-logic.js already
-- checks before creating a round; this unique slot makes the database refuse
-- the second, truly simultaneous insert (error 23505, which the code treats as
-- "someone else was faster").
--
-- Rollback: drop index if exists public.tournament_matches_unique_slot;

-- 1. Look at the duplicates first (expected: one pair in "Einzel - Training - 29.07")
select m.id, t.name as turnier, m.round, m.bracket, m.match_number, m.status
  from tournament_matches m
  join tournaments t on t.id = m.tournament_id
 where (m.tournament_id, m.round, m.bracket, m.match_number) in (
        select tournament_id, round, bracket, match_number
          from tournament_matches
         group by tournament_id, round, bracket, match_number
        having count(*) > 1)
 order by t.name, m.round, m.bracket, m.match_number, m.status;

-- 2. Remove the unplayed twin where a finished match already holds the slot
delete from tournament_matches a
 using tournament_matches b
 where a.tournament_id = b.tournament_id
   and a.round         = b.round
   and a.bracket       = b.bracket
   and a.match_number  = b.match_number
   and a.id <> b.id
   and a.status <> 'done'
   and b.status  = 'done';

-- 3. The unique slot (fails if step 2 left duplicates — then step 1 shows them)
create unique index if not exists tournament_matches_unique_slot
    on public.tournament_matches (tournament_id, round, bracket, match_number);
