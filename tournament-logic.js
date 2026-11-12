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

        // The tournament first: its mode (and pairing) decide how the result is written
        const { data: tourn } = await supa.from('tournaments').select('*').eq('id', ctx.tournId).single();
        if (!tourn) return true;
        const instant = tourn.mode === 'swiss' && tourn.pairing === 'instant';

        // Claim the result: only the first writer gets the row back. A double tap or a
        // second device stops here instead of advancing the tournament twice.
        const { data: claimed, error: claimError } = await supa.from('tournament_matches')
            .update({
                winner_id: winnerId, loser_id: loserId, status: 'done',
                // instant pairing pairs whoever has waited longest — needs the finishing time
                ...(instant ? { finished_at: new Date().toISOString() } : {})
            })
            .eq('id', ctx.matchId)
            .neq('status', 'done')
            .select('id');
        if (claimError) throw claimError;
        if (!claimed || claimed.length === 0) return true; // already recorded by someone else

        const { data: thisMatch } = await supa.from('tournament_matches')
            .select('bracket, round, match_number, next_match_id')
            .eq('id', ctx.matchId).single();
        if (!thisMatch) return true;

        if (tourn.mode === 'ko') {
            await advanceKO(winnerId, loserId, thisMatch, ctx);
        } else if (tourn.mode === 'swiss') {
            await (instant ? advanceSwissInstant : advanceSwiss)(winnerId, loserId, thisMatch, ctx);
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
            await saveThirdPlace(tournId);
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


// ── SWISS WITH INSTANT PAIRING (tournaments.pairing = 'instant') ──
// No rounds: whenever two players with the same number of losses are free, they get a
// new match right away — nobody waits for the slowest match of a "round".
//   * level = number of losses (0 = winner pool, 1 = loser pool, 2 = out)
//   * a winner stays on his level, the loser drops one level
//   * among the free players of a level the one who has waited longest is paired first,
//     preferably with someone he has not played yet
//   * a lone free player simply waits (no bye after round 1) — someone always arrives:
//     a match of his level ends or a player drops down from the level above
//   * finished when exactly one player is left on each level and nothing is running:
//     the final
// Players are reserved with tournament_participants.in_match (one conditional UPDATE),
// so two devices finishing at the same moment can never put someone in two matches.

// Pure planning — no database access. parts: { id, seed }, ms: all matches of the tournament.
// Returns { final: { p1, p2 } | null, pairs: [{ a, b, level }] }.
function planInstantPairs(parts, ms) {
    if (ms.some(m => m.bracket === 'final')) return { final: null, pairs: [] };

    const done    = ms.filter(m => m.status === 'done');
    const pending = ms.filter(m => m.status === 'pending' && m.p1_id && m.p2_id);
    const losses  = id => done.filter(m => m.loser_id === id).length;
    const busy    = new Set();
    pending.forEach(m => { busy.add(m.p1_id); busy.add(m.p2_id); });

    const alive = parts.filter(p => losses(p.id) < 2);
    const free  = alive.filter(p => !busy.has(p.id));

    if (pending.length === 0) {
        const l0 = alive.filter(p => losses(p.id) === 0);
        const l1 = alive.filter(p => losses(p.id) === 1);
        if (alive.length === 2 && l0.length === 1 && l1.length === 1) {
            return { final: { p1: l0[0].id, p2: l1[0].id }, pairs: [] };
        }
    }

    const met = (a, b) => ms.some(m => (m.p1_id === a && m.p2_id === b) || (m.p1_id === b && m.p2_id === a));
    const waitingSince = id => {
        const t = done.filter(m => m.p1_id === id || m.p2_id === id).map(m => (m.finished_at ? Date.parse(m.finished_at) : 0));
        return t.length ? Math.max(...t) : 0;
    };

    const pairs = [];
    [0, 1].forEach(level => {
        const pool = free.filter(p => losses(p.id) === level)
            .sort((a, b) => waitingSince(a.id) - waitingSince(b.id) || (a.seed || 0) - (b.seed || 0));
        while (pool.length >= 2) {
            const a = pool.shift();
            let j = pool.findIndex(b => !met(a.id, b.id));   // a fresh opponent if there is one
            if (j < 0) j = 0;
            pairs.push({ a: a.id, b: pool.splice(j, 1)[0].id, level });
        }
    });
    return { final: null, pairs };
}

function newMatchId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// Creates one pending match and reserves both players. Returns false if somebody else was
// faster (the match is withdrawn again). Insert first, then reserve: a reservation always
// points to an existing match, so leftovers can be told apart from a claim in flight.
async function createInstantMatch(tournId, aId, bId, bracket) {
    const id = newMatchId();
    let inserted = false;
    for (let tries = 0; tries < 5 && !inserted; tries++) {
        const { data: ms } = await supa.from('tournament_matches')
            .select('round, bracket, match_number, p1_id, p2_id, status').eq('tournament_id', tournId);
        const rows   = ms || [];
        const played = pid => rows.filter(m => m.status === 'done' && (m.p1_id === pid || m.p2_id === pid)).length;
        // "round" = the next game of the more experienced player; the final comes last
        const round  = bracket === 'final'
            ? Math.max(0, ...rows.map(m => m.round)) + 1
            : 1 + Math.max(played(aId), played(bId));
        // highest number + 1 (not the count: a withdrawn match leaves a gap that would collide)
        const number = 1 + Math.max(0, ...rows.filter(m => m.round === round && m.bracket === bracket).map(m => m.match_number));
        const { error } = await supa.from('tournament_matches').insert([{
            id, tournament_id: tournId, round, match_number: number, bracket,
            p1_id: aId, p2_id: bId, status: 'pending'
        }]);
        if (!error) { inserted = true; break; }
        if (error.code !== '23505') { console.error('[Swiss instant] Match insert error:', error.message); return false; }
        // the slot (round/bracket/number) was taken at the same moment — look again
    }
    if (!inserted) return false;

    const { data: got, error: reserveError } = await supa.from('tournament_participants')
        .update({ in_match: id })
        .in('id', [aId, bId])
        .is('in_match', null)
        .select('id');
    if (reserveError || !got || got.length !== 2) {
        if (got && got.length) {
            await supa.from('tournament_participants').update({ in_match: null }).in('id', got.map(r => r.id)).eq('in_match', id);
        }
        await supa.from('tournament_matches').delete().eq('id', id);
        return false;
    }
    return true;
}

// Pairs everything that can be paired right now (and creates the final when it is time).
// Safe to call from anywhere, any number of times: reservations make it idempotent.
async function pairFreePlayers(tournId) {
    for (let attempt = 0; attempt < 6; attempt++) {
        // participants first, matches after: a reservation seen here belongs to a match
        // that was inserted before — and is therefore in the match list fetched next.
        const { data: parts } = await supa.from('tournament_participants').select('id, seed, in_match').eq('tournament_id', tournId);
        const { data: ms }    = await supa.from('tournament_matches')
            .select('id, round, bracket, p1_id, p2_id, status, winner_id, loser_id, finished_at').eq('tournament_id', tournId);
        if (!parts || !ms) return;

        // Reservations of matches that are over (or gone) would block the player for good
        const pendingIds = new Set(ms.filter(m => m.status === 'pending').map(m => m.id));
        const stale = parts.filter(p => p.in_match && !pendingIds.has(p.in_match)).map(p => p.id);
        if (stale.length) await supa.from('tournament_participants').update({ in_match: null }).in('id', stale);

        const plan = planInstantPairs(parts, ms);
        let created = 0, failed = 0;
        if (plan.final) {
            (await createInstantMatch(tournId, plan.final.p1, plan.final.p2, 'final')) ? created++ : failed++;
        }
        for (const pr of plan.pairs) {
            (await createInstantMatch(tournId, pr.a, pr.b, pr.level === 0 ? 'winners' : 'losers')) ? created++ : failed++;
        }
        if (failed === 0) return;
        // somebody else paired at the same time — let them finish, then look again
        await new Promise(r => setTimeout(r, 80 + Math.random() * 250));
    }
}

async function advanceSwissInstant(winnerId, loserId, thisMatch, ctx) {
    const { tournId } = ctx;
    try {
        if (thisMatch.bracket === 'final') {
            await supa.from('tournaments').update({
                status:       'finished',
                winner_id:    winnerId,
                runner_up_id: loserId,
                finished_at:  new Date().toISOString()
            }).eq('id', tournId);
            await saveThirdPlace(tournId);
            return;
        }

        // Display counters (standings) + release both players from this match. The release
        // only counts while the reservation still belongs to THIS match — a sweep may have
        // paired the player again in the meantime.
        const { data: parts } = await supa.from('tournament_participants').select('id, wins, losses').eq('tournament_id', tournId);
        const winnerPart = (parts || []).find(p => p.id === winnerId);
        const loserPart  = (parts || []).find(p => p.id === loserId);
        await Promise.all([
            supa.from('tournament_participants')
                .update({ wins: ((winnerPart && winnerPart.wins) || 0) + 1 }).eq('id', winnerId),
            supa.from('tournament_participants')
                .update({ losses: ((loserPart && loserPart.losses) || 0) + 1 }).eq('id', loserId)
        ]);
        await supa.from('tournament_participants').update({ in_match: null })
            .in('id', [winnerId, loserId]).eq('in_match', ctx.matchId);

        await pairFreePlayers(tournId);
    } catch (e) { console.error('[Swiss instant] Error:', e); }
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

// ── PODIUM / DELETE (tournament overview) ──

// 3rd place of a Swiss tournament: whoever was knocked out last = the loser of the last
// match in the loser pool. Order: by finishing time (instant pairing), else round/number.
function swissThirdId(ms) {
    const lm = ms.filter(m => m.status === 'done' && m.bracket === 'losers' && m.p1_id && m.p2_id && m.loser_id);
    if (lm.length === 0) return null;
    lm.sort((a, b) => (Date.parse(a.finished_at) || 0) - (Date.parse(b.finished_at) || 0)
        || a.round - b.round || a.match_number - b.match_number);
    return lm[lm.length - 1].loser_id;
}

// Matches of a tournament, just the columns swissThirdId needs
async function swissThirdIdOf(tournId) {
    const { data } = await supa.from('tournament_matches')
        .select('round, match_number, bracket, status, p1_id, p2_id, loser_id, finished_at')
        .eq('tournament_id', tournId);
    return swissThirdId(data || []);
}

// Stores the 3rd place when a Swiss tournament ends. A separate, tolerant step: the
// tournament is already closed by then, a problem here must never undo that.
async function saveThirdPlace(tournId) {
    try {
        const thirdId = await swissThirdIdOf(tournId);
        if (thirdId) await supa.from('tournaments').update({ third_id: thirdId }).eq('id', tournId);
    } catch (e) { console.warn('[Tournament] third place not saved:', e); }
}

// Children first, so it does not depend on the database cascading.
// Returns null on success, otherwise the error message.
async function deleteTournamentCascade(tournId) {
    for (const table of ['tournament_matches', 'tournament_participants']) {
        const { error } = await supa.from(table).delete().eq('tournament_id', tournId);
        if (error) return error.message;
    }
    const { error } = await supa.from('tournaments').delete().eq('id', tournId);
    return error ? error.message : null;
}

// Asks, deletes, reports. Resolves true when the tournament is gone.
async function deleteTournamentFlow(t) {
    const notes = [];
    if (t.status === 'active') notes.push('Das Turnier läuft noch.');
    notes.push('Teilnehmer und Partien werden gelöscht. Die gespielten Spiele und ihre Statistiken bleiben erhalten — sie müssen bei Bedarf einzeln gelöscht werden.');
    if (t.mode === 'bounty') {
        notes.push('Einsatz und Auszahlungen stehen im Strafen-Verlauf der Spieler und bleiben dort bestehen — sie müssen von Hand korrigiert werden.');
    }
    const ok = await showConfirm('Turnier löschen', `„${t.name}" wirklich löschen? ${notes.join(' ')} Das kann nicht rückgängig gemacht werden.`, '🗑️');
    if (!ok) return false;
    const err = await deleteTournamentCascade(t.id);
    if (err) { showToast('Fehler beim Löschen: ' + err, 'error'); return false; }
    return true;
}

// ── Tournament tile / header markup ──────────────────────────────────────────
// Shared by tournaments.html (list), tournament-view.html and tournament-summary.html
// so that all three look the same. Styles: .tcard* in style.css.
// Line icons (currentColor = the mode colour): bracket, shuffle arrows, crosshair
const _TI = (body) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TOURN_MODES = {
    ko:     { label: 'K.O.',          rgb: '255,93,108',  icon: _TI('<path d="M3 6h6v12H3M9 12h9"/><circle cx="20" cy="12" r="1.3" fill="currentColor"/>') },
    swiss:  { label: 'Swiss',         rgb: '245,166,35',  icon: _TI('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>') },
    bounty: { label: 'Bounty Hunter', rgb: '179,136,255', icon: _TI('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>') }
};

function tournIsInstant(t) { return !!t && t.mode === 'swiss' && t.pairing === 'instant'; }

// "--tm: r,g,b" inline style: the mode colour that the .tcard styles pick up
function tournTintStyle(t) {
    return `--tm:${(TOURN_MODES[t.mode] || TOURN_MODES.swiss).rgb}`;
}

// Status pill: kind = 'active' | 'done' | 'early'
function tournPillHtml(kind) {
    const text = { active: 'Aktiv', done: 'Abgeschlossen', early: 'Vorzeitig beendet' }[kind] || '';
    return `<span class="tcard-pill tcard-pill--${kind}">${text}</span>`;
}

// Icon, name and one line with mode + settings; `side` is optional HTML on the right
function tournHeadHtml(t, side) {
    const m = TOURN_MODES[t.mode] || { label: t.mode, icon: '' };
    const specs = [
        t.game_type === 'doubles' ? 'Doppel' : 'Einzel',
        t.start_score,
        t.checkout === 'single' ? 'Single Out' : 'Double Out',
        `First to ${t.legs} ${t.legs === 1 ? 'Leg' : 'Legs'}`
    ].join(' · ');
    return `
        <div class="tcard-head">
            <span class="tcard-icon">${m.icon}</span>
            <div class="tcard-titles">
                <div class="tcard-name">${escHtml(t.name)}</div>
                <div class="tcard-sub">
                    <span class="tcard-mode">${m.label}${tournIsInstant(t) ? ' ⚡ Sofort' : ''}</span>
                    ${t.is_official === false ? '<span class="tcard-mode tcard-mode--plain">🎮 Fun</span>' : ''}
                    <span class="tcard-specs">${specs}</span>
                </div>
            </div>
            ${side ? `<div class="tcard-side">${side}</div>` : ''}
        </div>`;
}
