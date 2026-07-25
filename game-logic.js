// ── TOURNAMENT INTEGRATION ──
const _urlParams    = new URLSearchParams(window.location.search);
const _tournMatchId = _urlParams.get('tournament_match_id');
const _tournId      = _urlParams.get('tournament_id');
const _tournP1Id    = _urlParams.get('tournament_p1_id');
const _tournP2Id    = _urlParams.get('tournament_p2_id');
const _skipSetup    = _urlParams.get('skip_setup') === '1';
const _isOfficial   = _urlParams.get('is_official') !== '0';

// Called directly when coming from a tournament (skip_setup=1)
async function startGameFromTournament() {
    const p1        = _urlParams.get('p1');
    const p2        = _urlParams.get('p2');
    const startVal  = parseInt(_urlParams.get('start_score')) || 501;
    const legTarget = parseInt(_urlParams.get('legs'))        || 2;
    const mode      = _urlParams.get('checkout')             || 'double';
    const gameType  = _urlParams.get('game_type')            || 'singles';

    if (!p1 || !p2) return;

    gameState.gameType    = gameType;
    if (gameType === 'singles') {
        gameState.pNames      = [p1, p2];
        gameState.teamPlayers = [[p1], [p2]];
        gameState.stats       = [makePlayerStats(), makePlayerStats()];
    } else {
        const t1 = p1.split(' & ');
        const t2 = p2.split(' & ');
        gameState.pNames      = [p1, p2];
        gameState.teamPlayers = [t1, t2];
        gameState.stats       = [makePlayerStats(), makePlayerStats(), makePlayerStats(), makePlayerStats()];
    }

    gameState.startScore    = startVal;
    gameState.scores        = [startVal, startVal];
    gameState.history       = [[], []];
    gameState.legScore      = [0, 0];
    gameState.targetLegs    = legTarget;
    gameState.legStarter    = 0;
    gameState.currentIdx    = 0;
    gameState.teamPlayerIdx = [0, 0];
    gameState.mode          = mode;
    gameState.isOfficial    = _isOfficial;

    // Keep the (hidden) setup dropdown in sync so any DOM reads stay consistent
    const startSelect = document.getElementById('start-score-select');
    if (startSelect) startSelect.value = String(startVal);
    gameState.logs          = [];
    gameState.ausbullenActive = true;

    document.getElementById('nav-setup').style.display       = 'none';
    document.getElementById('nav-game-active').style.display = 'block';
    document.getElementById('setup-view').style.display      = 'none';
    document.getElementById('active-game-view').style.display = '';
    document.getElementById('active-game-view').classList.add('game-active');
    refreshDisplay();

    // VS intro doubles as starter selection — tap a picture to begin
    await showVsIntro();
}
async function saveTournamentResult(winnerName) {
    if (!_tournMatchId || !_tournP1Id || !_tournP2Id) return;
    try {
        const p1Name   = _urlParams.get('p1');
        const winnerId = winnerName === p1Name ? _tournP1Id : _tournP2Id;
        const loserId  = winnerName === p1Name ? _tournP2Id : _tournP1Id;

        // Mark match done
        await supa.from('tournament_matches').update({
            winner_id: winnerId,
            loser_id:  loserId,
            status:    'done'
        }).eq('id', _tournMatchId);

        // Fetch tournament mode + this match details
        const [{ data: tourn }, { data: thisMatch }] = await Promise.all([
            supa.from('tournaments').select('mode, name').eq('id', _tournId).single(),
            supa.from('tournament_matches')
                .select('bracket, round, match_number')
                .eq('id', _tournMatchId).single()
        ]);
        if (!tourn || !thisMatch) return;

        if (tourn.mode === 'ko') {
            await advanceKO(winnerId, thisMatch);
        } else if (tourn.mode === 'swiss') {
            await advanceSwiss(winnerId, loserId, thisMatch);
        } else if (tourn.mode === 'bounty') {
            await advanceBounty(winnerId, loserId, tourn);
        }
    } catch(e) { console.error('[Tournament] Error:', e); }
}

async function advanceKO(winnerId, thisMatch) {
    const { data: nextMatches } = await supa
        .from('tournament_matches')
        .select('id, p1_id, p2_id')
        .eq('tournament_id', _tournId)
        .eq('round', thisMatch.round + 1)
        .eq('bracket', 'winners');
    if (!nextMatches || nextMatches.length === 0) return;
    const nextMatch = nextMatches[Math.floor((thisMatch.match_number - 1) / 2)];
    if (!nextMatch) return;
    const field = nextMatch.p1_id ? 'p2_id' : 'p1_id';
    await supa.from('tournament_matches').update({ [field]: winnerId }).eq('id', nextMatch.id);
}

async function advanceSwiss(winnerId, loserId, thisMatch) {
    try {
        // Final match — close tournament directly
        if (thisMatch.bracket === 'final') {
            await supa.from('tournaments').update({
                status:       'finished',
                winner_id:    winnerId,
                runner_up_id: loserId,
                finished_at:  new Date().toISOString()
            }).eq('id', _tournId);
            return;
        }

        // 1. Fetch current participant records
        const { data: allParts } = await supa
            .from('tournament_participants')
            .select('id, name, wins, losses, bye_count, seed')
            .eq('tournament_id', _tournId);
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
                .eq('tournament_id', _tournId),
            supa.from('tournament_matches')
                .select('id, round, bracket, p1_id, p2_id, status, winner_id, loser_id')
                .eq('tournament_id', _tournId)
        ]);
        if (!parts || !allMatches) return;

        // 4. Check if all matches in current round are done
        const round = thisMatch.round;
        const thisRound = allMatches.filter(m => m.round === round);
        const allDone = thisRound.every(m => m.status === 'done' || m.id === _tournMatchId);
        if (!allDone) return;

        // 5. Build pools from updated records
        const winnersPool = parts.filter(p => (p.losses || 0) === 0);
        const losersPool  = parts.filter(p => (p.losses || 0) === 1);
        const finalMs     = allMatches.filter(m => m.bracket === 'final');
        const nextRound   = round + 1;

        // 6. Final condition: 1 player in each pool
        if (winnersPool.length === 1 && losersPool.length === 1 && finalMs.length === 0) {
            await supa.from('tournament_matches').insert([{
                tournament_id: _tournId,
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
            if (pool.length === 0) return;
            if (pool.length === 1) return; // champion, wait for other pool

            const sorted = [...pool].sort((a, b) => (a.seed || 0) - (b.seed || 0));
            const hasBye = sorted.length % 2 !== 0;
            let byePlayer = null;

            if (hasBye) {
                // Player with lowest bye_count gets the bye (random if tied)
                const minByes = Math.min(...sorted.map(p => p.bye_count || 0));
                const eligible = sorted.filter(p => (p.bye_count || 0) === minByes);
                byePlayer = eligible[Math.floor(Math.random() * eligible.length)];

                await Promise.all([
                    supa.from('tournament_participants')
                        .update({ bye_count: (byePlayer.bye_count || 0) + 1, wins: (byePlayer.wins || 0) + 1 })
                        .eq('id', byePlayer.id),
                    supa.from('tournament_matches').insert([{
                        tournament_id: _tournId,
                        round:         nextRound,
                        match_number:  Math.ceil(sorted.length / 2),
                        bracket:       bracketLabel,
                        p1_id:         byePlayer.id,
                        p2_id:         null,
                        winner_id:     byePlayer.id,
                        loser_id:      null,
                        status:        'done'
                    }])
                ]);
            }

            const toMatch = sorted.filter(p => !byePlayer || p.id !== byePlayer.id);
            const rows = [];
            for (let i = 0; i < toMatch.length / 2; i++) {
                rows.push({
                    tournament_id: _tournId,
                    round:         nextRound,
                    match_number:  i + 1,
                    bracket:       bracketLabel,
                    p1_id:         toMatch[i * 2].id,
                    p2_id:         toMatch[i * 2 + 1].id,
                    status:        'pending'
                });
            }
            if (rows.length > 0) await supa.from('tournament_matches').insert(rows);
        }

        await generatePoolMatches(winnersPool, 'winners');
        await generatePoolMatches(losersPool,  'losers');

    } catch(e) { console.error('[Swiss] Error:', e); }
}


// ── BOUNTY HUNTER MODE ──
async function advanceBounty(winnerId, loserId, tourn) {
    try {
        const tournName = tourn.name || 'Bounty Turnier';

        // 1. Fetch all participants including player_id
        const { data: parts } = await supa
            .from('tournament_participants')
            .select('id, name, lives, bounty, player_id')
            .eq('tournament_id', _tournId);
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
            }).eq('id', _tournId);
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
            .eq('tournament_id', _tournId);
        if (!updatedParts) return;

        const alive = updatedParts.filter(p => (p.lives || 0) > 0);

        // 3. If only 1 alive and we didn't catch isFinal above (edge case), finalize
        if (alive.length === 1) {
            await supa.from('tournaments').update({
                status:      'finished',
                winner_id:   alive[0].id,
                finished_at: new Date().toISOString()
            }).eq('id', _tournId);
            return;
        }

        // 4. Check all current round matches done
        const { data: allMatches } = await supa
            .from('tournament_matches')
            .select('id, round, status')
            .eq('tournament_id', _tournId)
            .order('round', { ascending: false });
        if (!allMatches) return;

        const currentRound  = allMatches[0].round;
        const thisRoundDone = allMatches
            .filter(m => m.round === currentRound)
            .every(m => m.status === 'done' || m.id === _tournMatchId);

        if (!thisRoundDone) return;

        // 5. Generate next round with alive players — shuffled randomly
        const nextRound = currentRound + 1;
        const aliveIds  = alive.map(p => p.id);
        const shuffled  = aliveIds.sort(() => Math.random() - 0.5);
        const pairs     = Math.floor(shuffled.length / 2);
        const hasBye    = shuffled.length % 2 !== 0;
        const rows      = [];

        for (let i = 0; i < pairs; i++) {
            rows.push({
                tournament_id: _tournId,
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
                tournament_id: _tournId,
                round:         nextRound,
                match_number:  pairs + 1,
                bracket:       'winners',
                p1_id:         shuffled[shuffled.length - 1],
                p2_id:         null,
                winner_id:     shuffled[shuffled.length - 1],
                status:        'done'
            });
        }

        if (rows.length > 0) await supa.from('tournament_matches').insert(rows);

    } catch(e) { console.error('[Bounty] Error:', e); }
}

// ── AUTO-FINE CONSTANTS (IDs from fines_reasons table) ──
const FINE_REASONS = {
    twentySix:    { id: '5183d5de-bad5-4f7c-8703-b0bc89ae6818', name: '26',                 amount: 0.30 },
    ausbullen:    { id: '28d2102b-e892-4366-8580-f752e81c8507', name: 'Sieger ausbullen',   amount: 1.00 },
    schnapszahl:  { id: '30edf2dd-5feb-4f8b-a2dc-566a496484ae', name: 'Schnapszahl stellen',amount: 0.20 }
};

const SCHNAPSZAHLEN = new Set([11,22,33,44,55,66,77,88,99,111,222,333,444,555]);

// Insert a fine row silently — looks up player UUID by name, returns inserted ID
async function insertFine(playerName, reason) {
    const player = players.find(p => p.name === playerName);
    if (!player) return null;
    try {
        const { data } = await supa.from('fines_ledger').insert([{
            player_id:  player.id,
            amount:     reason.amount,
            type:       'fine',
            reason:     reason.name,
            note:       null,
            created_by: 'system'
        }]).select('id').single();
        return data ? data.id : null;
    } catch(e) { console.error('Fine insert error:', e); return null; }
}

// ── LIVE GAME STATE ──
const _liveUser = JSON.parse(sessionStorage.getItem('fc47_user') || '{}');
const _liveId   = _liveUser.id   || 'current';
const _liveRole = _liveUser.role || '';

async function pushLiveState() {
    if (!gameState.isOfficial) return;
    try {
        await supa.from('live_game').upsert({
            id:         _liveId,
            role:       _liveRole,
            state:      {
                pNames:        gameState.pNames,
                scores:        gameState.scores,
                legScore:      gameState.legScore,
                targetLegs:    gameState.targetLegs,
                currentIdx:    gameState.currentIdx,
                gameType:      gameState.gameType,
                teamPlayers:   gameState.teamPlayers,
                teamPlayerIdx: gameState.teamPlayerIdx,
                history:       gameState.history,
                liveAvgs:      [0, 1].map(i => {
                    let pts = 0, darts = 0;
                    if (gameState.gameType === 'singles') {
                        pts = gameState.stats[i].totalPoints;
                        darts = gameState.stats[i].dartsThrown;
                    } else {
                        const b = i === 0 ? 0 : 2;
                        pts = gameState.stats[b].totalPoints + gameState.stats[b+1].totalPoints;
                        darts = gameState.stats[b].dartsThrown + gameState.stats[b+1].dartsThrown;
                    }
                    return darts > 0 ? parseFloat((pts / (darts / 3)).toFixed(2)) : null;
                })
            },
            updated_at: new Date().toISOString()
        });
    } catch(e) { console.error('Live state push error:', e); }
}

async function clearLiveState() {
    try {
        await supa.from('live_game').upsert({ id: _liveId, role: _liveRole, state: null, updated_at: new Date().toISOString() });
    } catch(e) { console.error('Live state clear error:', e); }
}

// ── TOAST ──
let toastQueue = [];
let toastRunning = false;

function showToast(message) {
    toastQueue.push(message);
    if (!toastRunning) processToastQueue();
}

function processToastQueue() {
    if (toastQueue.length === 0) { toastRunning = false; return; }
    toastRunning = true;
    const msg = toastQueue.shift();

    const el = document.createElement('div');
    el.className   = 'fine-toast';
    el.textContent = msg;
    document.body.appendChild(el);

    // Trigger animation
    requestAnimationFrame(() => el.classList.add('fine-toast--visible'));

    setTimeout(() => {
        el.classList.remove('fine-toast--visible');
        setTimeout(() => { el.remove(); processToastQueue(); }, 350);
    }, 2800);
}

// ── HELPERS ──
function makePlayerStats() {
    return {
        oneEighties:   0,
        twentySixes:   0,
        totalPoints:   0,
        dartsThrown:   0,
        pointsPre170:  0,
        dartsPre170:   0,
        dartsToClose:  0,
        isBelow170:    false,
        highScore:     0,        // highest single visit
        highFinish:    0,        // highest finishing visit
        dartsPerLeg:   [],       // darts thrown per leg won (cumulative, for undo)
        avgPerLeg:     [],       // avg per individual leg won [{ avg, darts }]
        legPoints:     0,        // points scored in current leg
        legDarts:      0         // darts thrown in current leg
    };
}

// ── TRAINING MODE (vs. bot) ──
const BOT_ICON = '🤖'; // every bot display name starts with this — used to detect the bot side in vsAvatarHtml()
let pendingBotTurnTimer = null; // setTimeout handle — kept OUTSIDE gameState (not JSON-serializable, not part of undo)

let gameState = {
    gameType: 'singles',
    isOfficial: true,
    opponentType: 'member',    // 'member' | 'bot'
    botTargetAvg: null,        // bot's target 3-dart average, when opponentType === 'bot'
    botStrengthMode: null,     // 'custom' | 'member' — informational only
    botSourceMemberName: null, // mirrored member's name, when botStrengthMode === 'member'
    pNames: ["P1", "P2"],
    startScore: 501,
    scores: [501, 501],
    history: [[], []],
    legScore: [0, 0],
    targetLegs: 1,
    legStarter: 0,
    currentIdx: 0,
    mode: 'double',
    input: "",
    logs: [],
    teamPlayers: [["A","B"], ["X","Y"]],
    teamPlayerIdx: [0, 0],
    stats: [makePlayerStats(), makePlayerStats()],
    ausbullenActive: false   // blocks input while modal is open
};

window.addEventListener('DOMContentLoaded', () => {
    // fetchPlayers is called by ui-manager-game.js
});

// ── VS INTRO ANIMATION ──
function vsAvatarHtml(name) {
    if (name.startsWith(BOT_ICON)) {
        // Mirroring a member's strength: show THEIR photo/initials with a
        // small robot badge overlaid, instead of the generic bot icon.
        const memberObj = gameState.botSourceMemberName
            ? players.find(pl => pl.name === gameState.botSourceMemberName)
            : null;
        if (!memberObj) {
            return `<div class="vs-intro-avatar vs-intro-avatar--bot"><span>${BOT_ICON}</span></div>`;
        }
        const inner = memberObj.avatar_url
            ? `<img src="${memberObj.avatar_url}" alt="">`
            : `<span>${memberObj.name.slice(0, 2).toUpperCase()}</span>`;
        // No badge overlay — the "🤖 " name label already makes it clear this is the bot
        return `<div class="vs-intro-avatar vs-intro-avatar--bot">${inner}</div>`;
    }
    const p        = players.find(pl => pl.name === name);
    const initials = (name || '?').slice(0, 2).toUpperCase();
    return p && p.avatar_url
        ? `<div class="vs-intro-avatar"><img src="${p.avatar_url}" alt=""></div>`
        : `<div class="vs-intro-avatar"><span>${initials}</span></div>`;
}

function renderVsSide(avatarsElId, nameElId, names, teamLabel) {
    const avatarsEl = document.getElementById(avatarsElId);
    avatarsEl.className = names.length > 1 ? 'vs-intro-avatars vs-intro-avatars--pair' : 'vs-intro-avatars';
    avatarsEl.innerHTML  = names.map(vsAvatarHtml).join('');
    document.getElementById(nameElId).textContent = teamLabel;
}

// Small match-info chips shown under the VS screen — fills the otherwise
// empty space and doubles as a last glance at the settings before throwing.
function vsMatchTagsHtml() {
    const typeLabel     = gameState.gameType === 'doubles' ? '👥 Doppel' : '👤 Einzel';
    const checkoutLabel = gameState.mode === 'single' ? 'Single Out' : 'Double Out';
    const legsLabel     = `First to ${gameState.targetLegs} ${gameState.targetLegs === 1 ? 'Leg' : 'Legs'}`;
    const officialLabel = gameState.isOfficial ? '🏆 Offiziell' : '🎉 Spaßspiel';
    const tags = [typeLabel, gameState.startScore, checkoutLabel, legsLabel, officialLabel];
    if (gameState.opponentType === 'bot') tags.push(`🤖 Training Ø${gameState.botTargetAvg}`);
    return tags.map(t => `<span class="vs-intro-tag">${t}</span>`).join('');
}

// Shows both players'/teams' pictures with a short entrance animation.
// Doubles as the starter-selection screen — tapping a side picks who
// begins the first leg (see pickStarter below).
async function showVsIntro() {
    if (players.length === 0) { try { await fetchPlayers(); } catch(e) {} }

    renderVsSide('vs-intro-avatars-p1', 'vs-intro-name-p1', gameState.teamPlayers[0], gameState.pNames[0]);
    renderVsSide('vs-intro-avatars-p2', 'vs-intro-name-p2', gameState.teamPlayers[1], gameState.pNames[1]);
    document.getElementById('vs-intro-tags').innerHTML = vsMatchTagsHtml();

    const overlay = document.getElementById('vs-intro-overlay');
    overlay.classList.remove('vs-intro-overlay--out');
    overlay.style.display = 'flex';
}

// Tapping a player's/team's picture in the VS screen picks the starter
function pickStarter(teamIdx) {
    const overlay = document.getElementById('vs-intro-overlay');
    overlay.classList.add('vs-intro-overlay--out');
    setTimeout(() => {
        overlay.style.display = 'none';
        overlay.classList.remove('vs-intro-overlay--out');
    }, 300);
    selectStarter(teamIdx);
}

function setGameType(type) {
    gameState.gameType = type;
    document.getElementById('type-singles').classList.toggle('game-type-btn--active', type === 'singles');
    document.getElementById('type-doubles').classList.toggle('game-type-btn--active', type === 'doubles');
    document.getElementById('singles-select').style.display = type === 'singles' ? 'flex' : 'none';
    document.getElementById('doubles-select').style.display = type === 'doubles' ? 'flex' : 'none';
    if (typeof refreshGameDropdowns === 'function') refreshGameDropdowns();
}

async function startGame() {
    clearPendingBotTurn(); // discard any leftover timer from a previous game
    const opponentType = document.getElementById('opp-bot').classList.contains('game-type-btn--active') ? 'bot' : 'member';

    const startVal  = parseInt(document.getElementById('start-score-select').value);
    const legTarget = parseInt(document.getElementById('legs-to-win-select').value);
    const mode      = document.getElementById('checkout-mode-select').value;

    if (gameState.gameType === 'singles') {
        if (opponentType === 'bot') {
            // Training is always "the logged-in member vs. the app" — no opponent picker needed
            const raw         = fcGetUser();
            const currentUser = raw ? JSON.parse(raw) : null;
            const myPlayer    = currentUser && currentUser.player_id ? players.find(p => p.id === currentUser.player_id) : null;
            if (!myPlayer) { await showAlert('Kein Profil verknüpft', 'Dein Konto ist mit keinem Spieler-Profil verknüpft.'); return; }
            const p1 = myPlayer.name;
            gameState.pNames      = [p1, `${BOT_ICON} Training`]; // bot label is finalized below once strength mode is known
            gameState.teamPlayers = [[p1], [`${BOT_ICON} Training`]];
            gameState.stats       = [makePlayerStats(), makePlayerStats()];
        } else {
            const p1 = document.getElementById('p1-select').value;
            const p2 = document.getElementById('p2-select').value;
            if (!p1 || !p2)  { await showAlert('Spieler fehlt', 'Bitte zwei Spieler auswählen!'); return; }
            if (p1 === p2)   { await showAlert('Gleicher Spieler', 'Bitte zwei verschiedene Spieler auswählen!'); return; }
            gameState.pNames      = [p1, p2];
            gameState.teamPlayers = [[p1], [p2]];
            gameState.stats       = [makePlayerStats(), makePlayerStats()];
        }
    } else {
        const t1p1 = document.getElementById('t1p1-select').value;
        const t1p2 = document.getElementById('t1p2-select').value;
        const t2p1 = document.getElementById('t2p1-select').value;
        const t2p2 = document.getElementById('t2p2-select').value;
        if (new Set([t1p1,t1p2,t2p1,t2p2]).size < 4) { await showAlert('Gleiche Spieler', 'Bitte vier verschiedene Spieler auswählen!'); return; }
        gameState.pNames      = [t1p1 + " & " + t1p2, t2p1 + " & " + t2p2];
        gameState.teamPlayers = [[t1p1, t1p2], [t2p1, t2p2]];
        gameState.stats       = [makePlayerStats(), makePlayerStats(), makePlayerStats(), makePlayerStats()];
    }

    gameState.startScore    = startVal;
    gameState.scores        = [startVal, startVal];
    gameState.history       = [[], []];
    gameState.legScore      = [0, 0];
    gameState.targetLegs    = legTarget;
    gameState.legStarter    = 0;
    gameState.currentIdx    = 0;
    gameState.teamPlayerIdx = [0, 0];
    gameState.mode          = mode;
    gameState.opponentType  = opponentType;
    gameState.isOfficial    = opponentType === 'bot'
        ? false   // training games are never official — regardless of any stale toggle state
        : document.getElementById('game-official-btn').classList.contains('game-type-btn--active');

    if (opponentType === 'bot') {
        const strengthMode = document.getElementById('bot-mode-member').classList.contains('game-type-btn--active') ? 'member' : 'custom';
        gameState.botStrengthMode = strengthMode;
        if (strengthMode === 'member') {
            const memberName = typeof selectedBotMemberName !== 'undefined' ? selectedBotMemberName : null;
            const memberObj  = players.find(p => p.name === memberName);
            gameState.botSourceMemberName = memberName || null;
            gameState.botTargetAvg = memberObj ? parseFloat(memberObj.stats.avgGame) : 45; // avgGame is a string (toFixed) — parseFloat needed
            if (!gameState.botTargetAvg || isNaN(gameState.botTargetAvg) || gameState.botTargetAvg <= 0) gameState.botTargetAvg = 45;
            const botLabel = memberName ? `${BOT_ICON} ${memberName}` : `${BOT_ICON} Training`;
            gameState.pNames[1]      = botLabel;
            gameState.teamPlayers[1] = [botLabel];
        } else {
            gameState.botSourceMemberName = null;
            gameState.botTargetAvg = parseInt(document.getElementById('bot-target-avg-input').value) || 45;
            gameState.pNames[1]      = `${BOT_ICON} Training`;
            gameState.teamPlayers[1] = [`${BOT_ICON} Training`];
        }
    } else {
        gameState.botTargetAvg = null;
        gameState.botStrengthMode = null;
        gameState.botSourceMemberName = null;
    }

    gameState.logs          = [];
    gameState.ausbullenActive = true; // block input until starter is chosen

    document.getElementById('nav-setup').style.display        = 'none';
    document.getElementById('nav-game-active').style.display  = 'block';
    document.getElementById('setup-view').style.display        = 'none';
    document.getElementById('active-game-view').style.display  = '';
    document.getElementById('active-game-view').classList.add('game-active');
    refreshDisplay();

    // VS intro doubles as starter selection — tap a picture to begin
    await showVsIntro();
}

function pressKey(num) {
    if (gameState.ausbullenActive) return;
    if (gameState.input.length < 3) {
        gameState.input += num;
        document.getElementById('input-preview').innerText = gameState.input;
    }
}

// Directly set score and submit — used by tablet quick-score buttons
function quickScore(val) {
    if (gameState.ausbullenActive) return;
    gameState.input = String(val);
    document.getElementById('input-preview').innerText = gameState.input;
    submitTurn();
}

// ── TRAINING MODE: BOT THROW GENERATION ──
// Produces a plausible 3-dart visit score (0–180). No checkout-route logic —
// the number goes straight through quickScore() into the existing
// submitTurn() pipeline, so bust/finish/stats "just work" unchanged.
function generateBotThrow(targetAvg, remainingScore) {
    const avg = Math.max(15, Math.min(140, targetAvg || 45));

    function randNormal(mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Checkout attempt: only relevant when actually in finishing range (≤170).
    // Conversion chance scales with skill and drops the further out the
    // remaining score is — realistically often takes several visits,
    // especially for weaker players, rather than finishing on the first go.
    if (remainingScore > 1 && remainingScore <= 170) {
        let checkoutChance = Math.max(0.12, Math.min(0.55, (avg - 10) / 100));
        if (remainingScore > 100)      checkoutChance *= 0.3;
        else if (remainingScore > 60)  checkoutChance *= 0.55;
        else if (remainingScore > 40)  checkoutChance *= 0.8;
        if (Math.random() < Math.max(0.06, Math.min(0.65, checkoutChance))) {
            return remainingScore;
        }
    }

    // Normal visit — a small mixture so most throws cluster tightly around
    // the player's real average (previously the spread was nearly as wide
    // as the average itself, which made both 0s and huge outliers far too
    // common). Occasionally a genuinely great or poor visit still happens.
    const coreSd = Math.max(8, Math.min(16, avg * 0.28));
    const roll = Math.random();
    let score;
    if (roll < 0.05) {
        // Rare great visit (big treble run, maybe even a ton+)
        score = randNormal(Math.min(160, avg + 70), 20);
    } else if (roll < 0.09) {
        // Rare poor visit (off night, bad miss) — the only realistic path to a very low score
        score = randNormal(Math.max(8, avg * 0.35), 10);
    } else {
        score = randNormal(avg, coreSd);
    }

    return Math.max(0, Math.min(180, Math.round(score)));
}

function clearPendingBotTurn() {
    if (pendingBotTurnTimer) {
        clearTimeout(pendingBotTurnTimer);
        pendingBotTurnTimer = null;
    }
}

// Call after any state change that might hand the turn to the bot. Fully
// guarded / safe to call unconditionally from every hook point.
function maybeTriggerBotTurn() {
    clearPendingBotTurn(); // never allow two scheduled bot turns to stack

    if (gameState.opponentType !== 'bot') return;
    if (gameState.currentIdx !== 1) return;               // bot is always teamIdx 1
    if (gameState.ausbullenActive) return;                  // starter picker open
    if (gameState.scores[0] === 0 || gameState.scores[1] === 0) return; // a leg just ended, a modal is (about to be) shown
    if (document.getElementById('leg-modal-overlay').style.display === 'flex') return;
    if (document.getElementById('match-modal-overlay').style.display === 'flex') return;
    if (document.getElementById('exit-modal-overlay').style.display === 'flex') return;

    pendingBotTurnTimer = setTimeout(() => {
        pendingBotTurnTimer = null;
        // Re-validate right before throwing — cheap extra safety on top of
        // clearPendingBotTurn(), in case state changed during the delay.
        if (gameState.opponentType !== 'bot' || gameState.currentIdx !== 1 || gameState.ausbullenActive) return;
        if (document.getElementById('leg-modal-overlay').style.display === 'flex') return;
        if (document.getElementById('match-modal-overlay').style.display === 'flex') return;
        if (document.getElementById('exit-modal-overlay').style.display === 'flex') return;

        quickScore(generateBotThrow(gameState.botTargetAvg, gameState.scores[1]));
    }, 1000 + Math.random() * 800); // ~1000–1800ms "thinking" delay
}

async function submitTurn() {
    if (gameState.ausbullenActive) return;
    const pts = parseInt(gameState.input) || 0;
    if (pts > 180) { showToast('⚠️ Maximum ist 180!'); clearInput(); return; }

    // Snapshot for undo — explicitly exclude logs to prevent exponential growth
    const { logs: _ignored, ...snapshot } = gameState;
    snapshot.fineIdsThisTurn = []; // will be filled after fines insert
    gameState.logs.push(JSON.parse(JSON.stringify(snapshot)));
    if (gameState.logs.length > 10) gameState.logs.shift();

    const teamIdx          = gameState.currentIdx;
    const playerWithinTeam = gameState.teamPlayerIdx[teamIdx];
    const newScore         = gameState.scores[teamIdx] - pts;

    const statsIdx = gameState.gameType === 'singles'
        ? teamIdx
        : teamIdx === 0 ? playerWithinTeam : 2 + playerWithinTeam;
    const pStats = gameState.stats[statsIdx];

    pStats.dartsThrown += 3;
    pStats.totalPoints += pts;
    pStats.legDarts    += 3;
    pStats.legPoints   += pts;
    if (pts > pStats.highScore) pStats.highScore = pts;
    if (pts === 180) pStats.oneEighties++;
    if (pts === 26)  pStats.twentySixes++;
    if (!pStats.isBelow170) {
        pStats.pointsPre170 += pts;
        pStats.dartsPre170  += 3;
        if (gameState.scores[teamIdx] - pts <= 170) pStats.isBelow170 = true;
    } else {
        pStats.dartsToClose += 3;
    }

    if (newScore === 0) {
        // Track finish score and per-leg avg for the WINNER
        if (pts > pStats.highFinish) pStats.highFinish = pts;
        const legAvg = pStats.legDarts > 0
            ? parseFloat((pStats.legPoints / (pStats.legDarts / 3)).toFixed(2))
            : 0;
        pStats.avgPerLeg.push({ avg: legAvg, darts: pStats.legDarts, won: true });
        pStats.legPoints = 0;
        pStats.legDarts  = 0;
        pStats.dartsPerLeg.push(pStats.dartsThrown);

        // Also snapshot the LOSER's avg for this leg
        const loserTeamIdx  = teamIdx === 0 ? 1 : 0;
        const loserStatsIdx = gameState.gameType === 'singles'
            ? loserTeamIdx
            : loserTeamIdx === 0
                ? gameState.teamPlayerIdx[0]
                : 2 + gameState.teamPlayerIdx[1];
        const lStats = gameState.stats[loserStatsIdx];
        const loserLegAvg = lStats.legDarts > 0
            ? parseFloat((lStats.legPoints / (lStats.legDarts / 3)).toFixed(2))
            : 0;
        lStats.avgPerLeg.push({ avg: loserLegAvg, darts: lStats.legDarts, won: false });
        lStats.legPoints = 0;
        lStats.legDarts  = 0;

        gameState.legScore[teamIdx]++;
        gameState.scores[teamIdx] = 0;
        if (typeof refreshDisplay === "function") refreshDisplay();

        if (gameState.legScore[teamIdx] >= gameState.targetLegs) {
            if (gameState.gameType === 'singles' && gameState.isOfficial) {
                try { await saveMatchToSupabase(); } catch(e) { console.error(e); }
            }
            showMatchModal(gameState.pNames[teamIdx]);
        } else {
            showLegModal(gameState.pNames[teamIdx]);
        }
        return;
    }

    if (newScore < 0 || (newScore === 1 && gameState.mode === 'double')) {
        showToast('💥 BUST!');
        gameState.history[teamIdx].push("BUST");
    } else {
        gameState.scores[teamIdx] = newScore;
        gameState.history[teamIdx].push(pts);

        // ── AUTO FINES (official games only) ──
        if (gameState.isOfficial) {
            // Doubles: fines hit both team players — win as a team, lose as a team
            const finedPlayers = gameState.gameType === 'singles'
                ? [gameState.pNames[teamIdx]]
                : gameState.teamPlayers[teamIdx];
            const fineLabel = finedPlayers.join(' & ');
            const perPlayer = gameState.gameType === 'doubles' ? 'je ' : '';

            const insertedIds = [];

            // 26 fine
            if (pts === 26) {
                for (const name of finedPlayers) {
                    const id = await insertFine(name, FINE_REASONS.twentySix);
                    if (id) insertedIds.push(id);
                }
                showToast(`💸 ${fineLabel}: 26 — ${perPlayer}${FINE_REASONS.twentySix.amount.toFixed(2).replace('.',',')} €`);
            }

            // Schnapszahl fine
            if (SCHNAPSZAHLEN.has(newScore)) {
                for (const name of finedPlayers) {
                    const id = await insertFine(name, FINE_REASONS.schnapszahl);
                    if (id) insertedIds.push(id);
                }
                showToast(`💸 ${fineLabel}: Schnapszahl (${newScore}) — ${perPlayer}${FINE_REASONS.schnapszahl.amount.toFixed(2).replace('.',',')} €`);
            }

            // Store inserted IDs in the most recent log snapshot for undo
            if (insertedIds.length > 0 && gameState.logs.length > 0) {
                gameState.logs[gameState.logs.length - 1].fineIdsThisTurn = insertedIds;
            }
        }
    }

    // Cap history to last 20 entries — only last 4 are displayed anyway
    if (gameState.history[teamIdx].length > 20) gameState.history[teamIdx].shift();

    if (gameState.gameType === 'doubles') {
        gameState.teamPlayerIdx[teamIdx] = (playerWithinTeam + 1) % 2;
    }
    gameState.currentIdx = teamIdx === 0 ? 1 : 0;
    clearInput();
    refreshDisplay();

    // ── AUSBULLEN CHECK ──
    const turns0 = gameState.history[0].length;
    const turns1 = gameState.history[1].length;
    if (gameState.isOfficial && turns0 >= 20 && turns1 >= 20 && gameState.scores[0] > 0 && gameState.scores[1] > 0) {
        showAusbullen();
    }

    // Push live state after every official turn
    if (gameState.isOfficial) pushLiveState();

    maybeTriggerBotTurn();
}

function undoMove() {
    clearPendingBotTurn(); // cancel any scheduled bot throw before rewinding state
    if (gameState.logs.length === 0) return;
    const lastSnapshot = gameState.logs.pop();
    const currentLogs  = gameState.logs;

    // Delete any fines that were inserted during the undone turn
    const fineIds = lastSnapshot.fineIdsThisTurn || [];
    if (fineIds.length > 0) {
        supa.from('fines_ledger').delete().in('id', fineIds)
            .then(() => {})
            .catch(e => console.error('Fine undo error:', e));
    }

    Object.assign(gameState, lastSnapshot);
    gameState.logs = currentLogs;
    refreshDisplay();
    clearInput();
}

// ── LEG MODAL ──
function showLegModal(winnerName) {
    document.getElementById('leg-modal-subtitle').textContent = winnerName;
    document.getElementById('leg-modal-overlay').style.display = 'flex';
}

function dismissLegModal() {
    document.getElementById('leg-modal-overlay').style.display = 'none';
    resetForNextLeg();
    if (gameState.isOfficial) pushLiveState();
}

// ── MATCH MODAL ──
let matchWinnerName = '';
let matchLoserName  = '';
function showMatchModal(winnerName) {
    matchWinnerName = winnerName;
    matchLoserName  = gameState.pNames[0] === winnerName ? gameState.pNames[1] : gameState.pNames[0];
    document.getElementById('match-modal-subtitle').textContent = winnerName + ' gewinnt das Match!';

    // ── Build stats table ──
    const isDoubles = gameState.gameType === 'doubles';

    // Aggregate stats per team (doubles: merge both players)
    function teamStats(teamIdx) {
        if (!isDoubles) return gameState.stats[teamIdx];
        const base = teamIdx === 0 ? 0 : 2;
        const s0 = gameState.stats[base];
        const s1 = gameState.stats[base + 1];
        // Interleave avgPerLeg by leg number (alternating players per leg in doubles)
        const maxLegs = Math.max(s0.avgPerLeg.length, s1.avgPerLeg.length);
        const merged = [];
        for (let i = 0; i < maxLegs; i++) {
            const a = s0.avgPerLeg[i], b = s1.avgPerLeg[i];
            if (a && b) merged.push({ avg: parseFloat(((a.avg + b.avg) / 2).toFixed(2)), darts: a.darts + b.darts });
            else if (a) merged.push(a);
            else if (b) merged.push(b);
        }
        return {
            totalPoints: s0.totalPoints  + s1.totalPoints,
            dartsThrown: s0.dartsThrown  + s1.dartsThrown,
            highScore:   Math.max(s0.highScore,  s1.highScore),
            highFinish:  Math.max(s0.highFinish, s1.highFinish),
            avgPerLeg:   merged
        };
    }

    const s0 = teamStats(0);
    const s1 = teamStats(1);

    function totalAvg(s) {
        return s.dartsThrown > 0 ? (s.totalPoints / (s.dartsThrown / 3)) : 0;
    }

    // Fixed rows
    const fixedRows = [
        {
            label: 'Avg gesamt',
            v0: totalAvg(s0).toFixed(2),
            v1: totalAvg(s1).toFixed(2),
            higher: true
        },
        {
            label: 'Höchster Wurf',
            v0: s0.highScore || '–',
            v1: s1.highScore || '–',
            higher: true
        },
        {
            label: 'Höchstes Finish',
            v0: s0.highFinish || '–',
            v1: s1.highFinish || '–',
            higher: true
        }
    ];

    // Per-leg avg rows — both teams now have entries for every leg
    const maxLegs = Math.max(s0.avgPerLeg.length, s1.avgPerLeg.length);
    const legRows = [];
    for (let i = 0; i < maxLegs; i++) {
        const l0 = s0.avgPerLeg[i];
        const l1 = s1.avgPerLeg[i];
        const v0 = l0 ? l0.avg.toFixed(2) : '–';
        const v1 = l1 ? l1.avg.toFixed(2) : '–';
        const n0 = parseFloat(v0), n1 = parseFloat(v1);
        const valid  = !isNaN(n0) && !isNaN(n1);
        // Green = higher avg (regardless of who won the leg)
        const p0best = valid && n0 > n1;
        const p1best = valid && n1 > n0;
        // 🎯 icon marks who won the leg
        const v0str = (l0?.won ? '🎯 ' : '') + v0;
        const v1str = (l1?.won ? '🎯 ' : '') + v1;
        legRows.push(`<tr>
            <td class="mstat-val ${p0best ? 'mstat-val--best' : ''}">${v0str}</td>
            <td class="mstat-label mstat-label--leg">Leg ${i + 1}</td>
            <td class="mstat-val ${p1best ? 'mstat-val--best' : ''}">${v1str}</td>
        </tr>`);
    }

    function renderRow(row) {
        const n0 = parseFloat(row.v0);
        const n1 = parseFloat(row.v1);
        const valid  = !isNaN(n0) && !isNaN(n1) && row.v0 !== '–' && row.v1 !== '–';
        const p0wins = valid && (row.higher ? n0 > n1 : n0 < n1);
        const p1wins = valid && (row.higher ? n1 > n0 : n1 < n0);
        const labelClass = row.isLeg ? 'mstat-label mstat-label--leg' : 'mstat-label';
        return `<tr>
            <td class="mstat-val ${p0wins ? 'mstat-val--best' : ''}">${row.v0}</td>
            <td class="${labelClass}">${row.label}</td>
            <td class="mstat-val ${p1wins ? 'mstat-val--best' : ''}">${row.v1}</td>
        </tr>`;
    }

    const dividerRow = maxLegs > 0 ? `<tr class="mstat-divider-row"><td colspan="3"><span>AVG PRO LEG</span></td></tr>` : '';

    const tableRows = fixedRows.map(renderRow).join('') + dividerRow + legRows.join('');

    const p0short = gameState.pNames[0].length > 12 ? gameState.pNames[0].slice(0,11)+'…' : gameState.pNames[0];
    const p1short = gameState.pNames[1].length > 12 ? gameState.pNames[1].slice(0,11)+'…' : gameState.pNames[1];

    document.getElementById('match-modal-stats').innerHTML = `
        <table class="mstat-table">
            <thead>
                <tr>
                    <th class="mstat-name ${gameState.pNames[0] === winnerName ? 'mstat-name--winner' : ''}">${p0short} ${gameState.pNames[0] === winnerName ? '🏆' : ''}</th>
                    <th></th>
                    <th class="mstat-name ${gameState.pNames[1] === winnerName ? 'mstat-name--winner' : ''}">${p1short} ${gameState.pNames[1] === winnerName ? '🏆' : ''}</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>`;

    document.getElementById('match-modal-overlay').style.display = 'flex';
}

async function dismissMatchModal() {
    document.getElementById('match-modal-overlay').style.display = 'none';
    const startVal = gameState.startScore;
    gameState.scores   = [startVal, startVal];
    gameState.legScore = [0, 0];
    await clearLiveState();
    // Save tournament result if this was a tournament match
    if (_tournMatchId) {
        await saveTournamentResult(matchWinnerName);
    }
    exitGame(true);
}

function undoFromMatchModal() {
    if (gameState.logs.length === 0) return;
    document.getElementById('match-modal-overlay').style.display = 'none';
    undoMove();
}

function clearInput() {
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";
}

// ── PHYSICAL KEYBOARD SCORING (numpad digits + Enter/Backspace) ──
// Mirrors the on-screen numpad: digit keys feed pressKey(), Enter submits,
// Backspace/Delete clears the current input (same as the "C" button).
// Only active while a game is actually in progress, and never hijacks a
// real form field (e.g. the training-setup inputs) that happens to have focus.
document.addEventListener('keydown', (e) => {
    if (document.getElementById('active-game-view').style.display === 'none') return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        pressKey(e.key);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        submitTurn();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        clearInput();
    }
});

function resetForNextLeg() {
    const startVal = gameState.startScore;
    gameState.scores  = [startVal, startVal];
    gameState.history = [[], []];
    gameState.legStarter = gameState.legStarter === 0 ? 1 : 0;
    gameState.currentIdx = gameState.legStarter;
    if (gameState.gameType === 'doubles') {
        gameState.teamPlayerIdx[gameState.legStarter] =
            (gameState.teamPlayerIdx[gameState.legStarter] + 1) % 2;
    }
    gameState.input = "";
    refreshDisplay();
    maybeTriggerBotTurn();
}

// ── STARTER SELECTION ──
function selectStarter(teamIdx) {
    gameState.ausbullenActive = false;
    gameState.legStarter  = teamIdx;
    gameState.currentIdx  = teamIdx;
    refreshDisplay();
    maybeTriggerBotTurn();
}

// ── AUSBULLEN ──
function showAusbullen() {
    gameState.ausbullenActive = true;
    clearInput();

    document.getElementById('ausbullen-p1').textContent = gameState.pNames[0];
    document.getElementById('ausbullen-p2').textContent = gameState.pNames[1];
    document.getElementById('ausbullen-overlay').style.display = 'flex';
}

async function selectAusbullenWinner(teamIdx) {
    document.getElementById('ausbullen-overlay').style.display = 'none';
    gameState.ausbullenActive = false;

    // Fine both players for ausbullen (official games only — ausbullen only fires in official anyway)
    const loserIdx = teamIdx === 0 ? 1 : 0;
    for (const idx of [teamIdx, loserIdx]) {
        if (gameState.gameType === 'singles') {
            insertFine(gameState.pNames[idx], FINE_REASONS.ausbullen);
            showToast(`💸 ${gameState.pNames[idx]}: Sieger ausbullen — ${FINE_REASONS.ausbullen.amount.toFixed(2).replace('.',',')} €`);
        } else {
            // Doubles: fine each individual player in the team
            for (const name of gameState.teamPlayers[idx]) {
                insertFine(name, FINE_REASONS.ausbullen);
                showToast(`💸 ${name}: Sieger ausbullen — ${FINE_REASONS.ausbullen.amount.toFixed(2).replace('.',',')} €`);
            }
        }
    }

    // Award the leg to the chosen team
    const ausbullenStatsIdx = gameState.gameType === 'singles'
        ? teamIdx
        : teamIdx === 0 ? gameState.teamPlayerIdx[0] : 2 + gameState.teamPlayerIdx[1];
    gameState.stats[ausbullenStatsIdx].dartsPerLeg.push(gameState.stats[ausbullenStatsIdx].dartsThrown);
    gameState.legScore[teamIdx]++;

    if (gameState.legScore[teamIdx] >= gameState.targetLegs) {
        if (gameState.gameType === 'singles' && gameState.isOfficial) {
            try { await saveMatchToSupabase(); } catch(e) { console.error(e); }
        }
        showMatchModal(gameState.pNames[teamIdx]);
    } else {
        showLegModal(gameState.pNames[teamIdx] + ' (Ausbullen)');
    }
            }
