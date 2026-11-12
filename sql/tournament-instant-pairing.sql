-- Swiss tournaments with instant pairing ("Sofort"): a new match as soon as two
-- players with the same number of losses are free, instead of waiting for the
-- slowest match of a round.
--
-- tournaments.pairing           'instant' (new default in the app) or 'rounds'
--                               (the existing behaviour — all existing tournaments
--                               keep 'rounds')
-- tournament_participants.in_match
--                               the match a player is currently reserved for. A
--                               conditional UPDATE reserves two players in one go,
--                               so two devices can never put someone in two matches.
-- tournament_matches.finished_at
--                               when a result was recorded; the player who has waited
--                               longest is paired first.
--
-- Run this BEFORE creating the first "Sofort" tournament. Rollback:
--   alter table public.tournaments            drop column if exists pairing;
--   alter table public.tournament_participants drop column if exists in_match;
--   alter table public.tournament_matches      drop column if exists finished_at;

alter table public.tournaments
    add column if not exists pairing text not null default 'rounds'
    check (pairing in ('rounds', 'instant'));

alter table public.tournament_participants
    add column if not exists in_match uuid;

alter table public.tournament_matches
    add column if not exists finished_at timestamptz;
