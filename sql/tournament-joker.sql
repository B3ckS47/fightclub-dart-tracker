-- Joker team (doubles tournament with an odd number of players).
--
-- The team "Max & 🎲" gets a random partner for every match. The drawn partner is
-- stored on the match so the match list can show it ("Max & Anna 🎲") and the
-- next draw can prefer players who helped out least so far.
--
-- The app works without this column (the partner is simply not remembered), so it
-- can be applied before or after the code is deployed.
--
-- Rollback: alter table public.tournament_matches drop column if exists joker_partner;

alter table public.tournament_matches
    add column if not exists joker_partner text;
