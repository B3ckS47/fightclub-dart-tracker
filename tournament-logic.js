// ── TOURNAMENT LOGIC ──
// Everything that happens to a tournament when a match is played on game.html:
// URL parameters of a tournament match, saving its result, advancing the bracket
// (knockout / Swiss / Bounty Hunter) and keeping the result safe if the app is
// closed before the result popup is confirmed.
// Loaded before game-logic.js, which starts such a game (startGameFromTournament)
// and calls saveTournamentResult() / the pending-result helpers.

// ── TOURNAMENT MATCH PARAMETERS ──
const _urlParams    = new URLSearchParams(window.location.search);
const _tournMatchId = _urlParams.get('tournament_match_id');
const _tournId      = _urlParams.get('tournament_id');
const _tournP1Id    = _urlParams.get('tournament_p1_id');
const _tournP2Id    = _urlParams.get('tournament_p2_id');
const _skipSetup    = _urlParams.get('skip_setup') === '1';
const _isOfficial   = _urlParams.get('is_official') !== '0';

// ── TOURNAMENT RESULT ──
// ctx identifies the match being finished: { matchId, tournId, p1Id, p2Id, p1Name }.
// For a live game it comes from the URL; for a result that was recovered after the
// app was closed at the result popup it comes from localStorage (see below).
function tournamentCtxFromUrl() {
    return { matchId: _tournMatchId, tournId: _tournId, p1Id: _tournP1Id, p2Id: _tournP2Id, p1Name: _urlParams.get('p1') };
}

// Resolves true when the result is recorded (or already was), false if saving failed.
async function saveTournamentResult(winnerName, ctx = tournamentCtxFromUrl()) {
    if (!ctx.matchId || !ctx.p1Id || !ctx.p2Id) return true;
    try {
        const winnerId = winnerName === ctx.p1Name ? ctx.p1Id : ctx.p2Id;
        const loserId  = winnerName === ctx.p1Name ? ctx.p2Id : ctx.p1Id;

        // Claim the result: only the first writer gets the row back. A double tap or a
        // second device stops here instead of advancing the tournament twice.
        const { data: claimed, error: claimError } = await supa.from('tournament_matches')
            .update({ winner_id: winnerId, loser_id: loserId, status: 'done' })
            .eq('id', ctx.matchId)
            .neq('status', 'done')
            .select('id');
        if (claimError) throw claimError;
        if (!claimed || claimed.length === 0) return true; // already recorded by someone else

        // Fetch tournament mode + this match details
        const [{ data: tourn }, { data: thisMatch }] = await Promise.all([
            supa.from('tournaments').select('mode, name').eq('id', ctx.tournId).single(),
            supa.from('tournament_matches')
                .select('bracket, round, match_number, next_match_id')
                .eq('id', ctx.matchId).single()
        ]);
        if (!tourn || !thisMatch) return true;

        if (tourn.mode === 'ko') {
            await advanceKO(winnerId, loserId, thisMatch, ctx);
        } else if (tourn.mode === 'swiss') {
            await advanceSwiss(winnerId, loserId, thisMatch, ctx);
        } else if (tourn.mode === 'bounty') {
            await advanceBounty(winnerId, loserId, tourn, ctx);
        }
        return true;
    } catch(e) {
        console.error('[Tournament] Error:', e);
        return false;
    }
}

// ── PENDING RESULT: survives closing the app at the result popup ──
// The match stats are saved the moment the last dart goes in, but the tournament
// result only when the popup is confirmed. Without a note of it, closing the app in
// between left the match open in the bracket (and it got played — and counted — again).
const PENDING_TOURN_KEY = 'fc47_pending_tourn_result';

function rememberPendingTournamentResult(winnerName) {
    if (!_tournMatchId) return;
    try { localStorage.setItem(PENDING_TOURN_KEY, JSON.stringify({ ctx: tournamentCtxFromUrl(), winnerName })); }
    catch (e) { /* storage blocked — falls back to the old behaviour */ }
}

function forgetPendingTournamentResult() {
    try { localStorage.removeItem(PENDING_TOURN_KEY); } catch (e) { /* ignore */ }
}

async function recoverPendingTournamentResult() {
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(PENDING_TOURN_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (!pending || !pending.ctx || !pending.winnerName) return;

    if (!(await saveTournamentResult(pending.winnerName, pending.ctx))) return; // try again next time
    forgetPendingTournamentResult();
    showToast('Turnier-Ergebnis nachgetragen.');
    // This page was opened for that very match again — it is done, back to the bracket
    if (pending.ctx.matchId === _tournMatchId) {
        setTimeout(() => { window.location.href = `tournament-view.html?id=${pending.ctx.tournId}`; }, 1500);
    }
}

// ── ROUND GENERATION: only once ──
// Two matches finishing at the same moment both see "round complete" and both would
// create the next round. roundExists() catches the sequential case; the unique slot
// from sql/tournament-matches-unique.sql makes the second insert fail for the
// truly simultaneous one — insertRoundOnce() treats that as "someone else was faster".
async function roundExists(tournId, round, bracket) {
    const { count } = await supa.from('tournament_matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournId).eq('round', round).eq('bracket', bracket);
    return (count || 0) > 0;
}

async function insertRoundOnce(rows) {
    const { error } = await supa.from('tournament_matches').insert(rows);
    if (error) {
        if (error.code !== '23505') console.error('[Tournament] Round insert error:', error.message);
        return false;
    }
    return true;
}

async function advanceKO(winnerId, loserId, thisMatch, ctx) {
    const { tournId } = ctx;

    // The bracket stores the link to the next match; older brackets without it fall
    // back to the position in the next round (explicitly ordered — row order is not
    // guaranteed otherwise).
    let nextMatchId = thisMatch.next_match_id || null;
    if (!nextMatchId) {
        const { data: nextMatches } = await supa
            .from('tournament_matches')
            .select('id')
            .eq('tournament_id', tournId)
            .eq('round', thisMatch.round + 1)
            .order('match_number');
        const next = (nextMatches || [])[Math.floor((thisMatch.match_number - 1) / 2)];
        nextMatchId = next ? next.id : null;
    }

    // No next match = this was the final: the tournament is over
    if (!nextMatchId) {
        await supa.from('tournaments').update({
            status:       'finished',
            winner_id:    winnerId,
            runner_up_id: loserId,
            finished_at:  new Date().toISOString()
        }).eq('id', tournId);
        return;
    }

    // Fixed slot by position (odd match → p1, even → p2 — the same rule the bracket
    // creation uses for byes), so two feeder matches finishing together can't
    // overwrite each other's slot.
    const field = thisMatch.match_number % 2 === 1 ? 'p1_id' : 'p2_id';
    await supa.from('tournament_matches').update({ [field]: winnerId }).eq('id', nextMatchId);
}

async function advanceSwiss(winnerId, loserId, thisMatch, ctx) {
    const { tournId, matchId } = ctx;
    try {
        // Final match — close tournament directly
        if (thisMatch.bracket === 'final') {
            await supa.from('tournaments').update({
                status:       'finished',
                winner_id:    winnerId,
                runner_up_id: loserId,
                finished_at:  new Date().toISOString()
            }).eq('id', tournId);
            return;
        }

        // 1. Fetch current participant records
        const { data: allParts } = await supa
            .from('tournament_participants')
            .select('id, name, wins, losses, bye_count, seed')
            .eq('tournament_id', tournId);
        if (!allParts) return;

        const winnerPart = allParts.find(p => p.id === winnerId);
        const loserPart  = allParts.find(p => p.id === loserId);
        if (!winnerPart || !loserPart) return;

        // 2. Update records
        await Promise.all([
            supa.from('tournament_participants')
                .update({ wins: (winnerPart.wins || 0) + 1 })
                .eq('id', winnerId),
            supa.from('tournament_participants')
                .update({ losses: (loserPart.losses || 0) + 1 })
                .eq('id', loserId)
        ]);

        // 3. Fetch updated records + all matches
        const [{ data: parts }, { data: allMatches }] = await Promise.all([
            supa.from('tournament_participants')
                .select('id, name, wins, losses, bye_count, seed')
                .eq('tournament_id', tournId),
            supa.from('tournament_matches')
                .select('id, round, bracket, p1_id, p2_id, status, winner_id, loser_id')
                .eq('tournament_id', tournId)
        ]);
        if (!parts || !allMatches) return;

        // 4. Check if all matches in current round are done
        const round = thisMatch.round;
        const thisRound = allMatches.filter(m => m.round === round);
        const allDone = thisRound.every(m => m.status === 'done' || m.id === matchId);
        if (!allDone) return;

        // 5. Build pools from the match results — not from the wins/losses counters on
        // the participants: those are written a moment AFTER a match is marked done, so a
        // match finishing at the same time could still show stale counters here.
        const lossesOf    = id => allMatches.filter(m => m.status === 'done' && m.loser_id === id).length;
        const winnersPool = parts.filter(p => lossesOf(p.id) === 0);
        const losersPool  = parts.filter(p => lossesOf(p.id) === 1);
        const finalMs     = allMatches.filter(m => m.bracket === 'final');
        const nextRound   = round + 1;

        // 6. Final condition: 1 player in each pool
        if (winnersPool.length === 1 && losersPool.length === 1 && finalMs.length === 0) {
            if (await roundExists(tournId, nextRound, 'final')) return;
            await insertRoundOnce([{
                tournament_id: tournId,
                round:         nextRound,
                match_number:  1,
                bracket:       'final',
                p1_id:         winnersPool[0].id,
                p2_id:         losersPool[0].id,
                status:        'pending'
            }]);
            return;
        }

        // 7. Generate next round matches for each pool
        async function generatePoolMatches(pool, bracketLabel) {
            if (pool.length <= 1) return; // empty, or a champion waiting for the other pool
            if (await roundExists(tournId, nextRound, bracketLabel)) return;

            const sorted = [...pool].sort((a, b) => (a.seed || 0) - (b.seed || 0));
            const hasBye = sorted.length % 2 !== 0;
            let byePlayer = null;
            const rows = [];

            if (hasBye) {
                // Player with lowest bye_count gets the bye (random if tied)
                const minByes = Math.min(...sorted.map(p => p.bye_count || 0));
                const eligible = sorted.filter(p => (p.bye_count || 0) === minByes);
                byePlayer = eligible[Math.floor(Math.random() * eligible.length)];

                rows.push({
                    tournament_id: tournId,
                    round:         nextRound,
                    match_number:  Math.ceil(sorted.length / 2),
                    bracket:       bracketLabel,
                    p1_id:         byePlayer.id,
                    p2_id:         null,
                    winner_id:     byePlayer.id,
                    loser_id:      null,
                    status:        'done'
                });
            }

            const toMatch = sorted.filter(p => !byePlayer || p.id !== byePlayer.id);
            for (let i = 0; i < toMatch.length / 2; i++) {
                rows.push({
                    tournament_id: tournId,
                    round:         nextRound,
                    match_number:  i + 1,
                    bracket:       bracketLabel,
                    p1_id:         toMatch[i * 2].id,
                    p2_id:         toMatch[i * 2 + 1].id,
                    status:        'pending'
                });
            }

            // One statement for the whole round (bye included): either all of it is
            // created or, if a concurrent run was faster, none of it.
            if (!(await insertRoundOnce(rows))) return;

            // Only the run that created the round credits the bye
            if (byePlayer) {
                await supa.from('tournament_participants')
                    .update({ bye_count: (byePlayer.bye_count || 0) + 1, wins: (byePlayer.wins || 0) + 1 })
                    .eq('id', byePlayer.id);
            }
        }

        await generatePoolMatches(winnersPool, 'winners');
        await generatePoolMatches(losersPool,  'losers');

    } catch(e) { console.error('[Swiss] Error:', e); }
}


// ── BOUNTY HUNTER MODE ──
async function advanceBounty(winnerId, loserId, tourn, ctx) {
    const { tournId, matchId } = ctx;
    try {
        const tournName = tourn.name || 'Bounty Turnier';

        // 1. Fetch all participants including player_id
        const { data: parts } = await supa
            .from('tournament_participants')
            .select('id, name, lives, bounty, player_id')
            .eq('tournament_id', tournId);
        if (!parts) return;

        const winner = parts.find(p => p.id === winnerId);
        const loser  = parts.find(p => p.id === loserId);
        if (!winner || !loser) return;

        const loserNewLives  = (loser.lives || 1) - 1;
        const loserBounty    = Math.round((parseFloat(loser.bounty) || 0) * 100) / 100;
        const winnerBounty   = Math.round((parseFloat(winner.bounty) || 0) * 100) / 100;

        // Check if this is the final match (only 2 players still alive before this result)
        const aliveBeforeResult = parts.filter(p => (p.lives || 0) > 0);
        const isFinal = aliveBeforeResult.length === 2;

        if (loserNewLives > 0) {
            // Loser still has lives — just deduct one, no bounty transfer
            await supa.from('tournament_participants')
                .update({ lives: loserNewLives })
                .eq('id', loserId);

        } else if (isFinal) {
            // FINAL MATCH: winner takes everything — own bounty + loser bounty
            const totalPayout = Math.round((winnerBounty + loserBounty) * 100) / 100;

            await Promise.all([
                supa.from('tournament_participants')
                    .update({ lives: 0, bounty: 0 })
                    .eq('id', loserId),
                supa.from('tournament_participants')
                    .update({ bounty: 0 })
                    .eq('id', winnerId)
            ]);

            if (winner.player_id && totalPayout > 0) {
                await supa.from('fines_ledger').insert([{
                    player_id:  winner.player_id,
                    amount:     -totalPayout,
                    type:       'payment',
                    reason:     'Bounty Hunter Sieg: ' + tournName,
                    note:       'tournament:' + tournName,
                    created_by: 'system'
                }]);
            }

            await supa.from('tournaments').update({
                status:      'finished',
                winner_id:   winner.id,
                finished_at: new Date().toISOString()
            }).eq('id', tournId);
            return;

        } else {
            // REGULAR ELIMINATION: split loser bounty 50/50
            const halfToWinner = Math.round(loserBounty / 2 * 100) / 100;
            const halfToBounty = loserBounty - halfToWinner;
            const winnerNewBounty = Math.round((winnerBounty + halfToBounty) * 100) / 100;

            await Promise.all([
                supa.from('tournament_participants')
                    .update({ lives: 0, bounty: 0 })
                    .eq('id', loserId),
                supa.from('tournament_participants')
                    .update({ bounty: winnerNewBounty })
                    .eq('id', winnerId)
            ]);

            // Winner gets 50% as direct Fines payment
            if (winner.player_id && halfToWinner > 0) {
                await supa.from('fines_ledger').insert([{
                    player_id:  winner.player_id,
                    amount:     -halfToWinner,
                    type:       'payment',
                    reason:     'Bountygewinn: ' + loser.name,
                    note:       'tournament:' + tournName,
                    created_by: 'system'
                }]);
            }
        }

        // 2. Fetch updated participants — who is still alive?
        const { data: updatedParts } = await supa
            .from('tournament_participants')
            .select('id, lives, bounty, player_id, name')
            .eq('tournament_id', tournId);
        if (!updatedParts) return;

        const alive = updatedParts.filter(p => (p.lives || 0) > 0);

        // 3. If only 1 alive and we didn't catch isFinal above (edge case), finalize
        if (alive.length === 1) {
            await supa.from('tournaments').update({
                status:      'finished',
                winner_id:   alive[0].id,
                finished_at: new Date().toISOString()
            }).eq('id', tournId);
            return;
        }

        // 4. Check all current round matches done
        const { data: allMatches } = await supa
            .from('tournament_matches')
            .select('id, round, status')
            .eq('tournament_id', tournId)
            .order('round', { ascending: false });
        if (!allMatches) return;

        const currentRound  = allMatches[0].round;
        const thisRoundDone = allMatches
            .filter(m => m.round === currentRound)
            .every(m => m.status === 'done' || m.id === matchId);

        if (!thisRoundDone) return;

        // 5. Generate next round with alive players — shuffled randomly
        const nextRound = currentRound + 1;
        if (await roundExists(tournId, nextRound, 'winners')) return;
        const aliveIds  = alive.map(p => p.id);
        const shuffled  = aliveIds.sort(() => Math.random() - 0.5);
        const pairs     = Math.floor(shuffled.length / 2);
        const hasBye    = shuffled.length % 2 !== 0;
        const rows      = [];

        for (let i = 0; i < pairs; i++) {
            rows.push({
                tournament_id: tournId,
                round:         nextRound,
                match_number:  i + 1,
                bracket:       'winners',
                p1_id:         shuffled[i * 2],
                p2_id:         shuffled[i * 2 + 1],
                status:        'pending'
            });
        }
        if (hasBye) {
            rows.push({
                tournament_id: tournId,
                round:         nextRound,
                match_number:  pairs + 1,
                bracket:       'winners',
                p1_id:         shuffled[shuffled.length - 1],
                p2_id:         null,
                winner_id:     shuffled[shuffled.length - 1],
                status:        'done'
            });
        }

        if (rows.length > 0) await insertRoundOnce(rows);

    } catch(e) { console.error('[Bounty] Error:', e); }
}
