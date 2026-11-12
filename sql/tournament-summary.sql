-- Link a saved game (game_history) to the tournament match it was played in.
--
-- Used by the tournament overview page (tournament-summary.html) to show the
-- average / legs / finish of every match exactly. Tournaments played before this
-- column existed are matched by time window and player names instead.
--
-- Deliberately NO foreign key: deleting a tournament must not delete the games
-- that were played (their statistics stay; they can be deleted one by one).
--
-- Run this BEFORE the next tournament is played. Rollback:
--   drop index if exists public.game_history_tournament_match_idx;
--   alter table public.game_history drop column if exists tournament_match_id;

alter table public.game_history
    add column if not exists tournament_match_id uuid;

create index if not exists game_history_tournament_match_idx
    on public.game_history (tournament_match_id);
