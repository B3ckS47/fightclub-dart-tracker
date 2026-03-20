// ── TOURNAMENT INTEGRATION ──
const _urlParams    = new URLSearchParams(window.location.search);
const _tournMatchId = _urlParams.get('tournament_match_id');
const _tournId      = _urlParams.get('tournament_id');
const _tournP1Id    = _urlParams.get('tournament_p1_id');
const _tournP2Id    = _urlParams.get('tournament_p2_id');

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
            supa.from('tournaments').select('mode').eq('id', _tournId).single(),
            supa.from('tournament_matches')
                .select('bracket, round, match_number')
                .eq('id', _tournMatchId).single()
        ]);
        if (!tourn || !thisMatch) return;

        if (tourn.mode === 'ko') {
            await advanceKO(winnerId, thisMatch);
        } else {
            await advanceSwiss(winnerId, loserId, thisMatch);
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
    const { data: allMatches } = await supa
        .from('tournament_matches')
        .select('id, round, match_number, bracket, p1_id, p2_id, status, winner_id, loser_id')
        .eq('tournament_id', _tournId);
    if (!allMatches) return;

    const winnerMs = allMatches.filter(m => m.bracket === 'winners');
    const loserMs  = allMatches.filter(m => m.bracket === 'losers');
    const finalMs  = allMatches.filter(m => m.bracket === 'final');
    const round    = thisMatch.round;
    const bracket  = thisMatch.bracket;

    if (bracket === 'winners') {
        // ── Check if all winners matches this round are now done ──
        const thisRoundW = winnerMs.filter(m => m.round === round);
        const allDone    = thisRoundW.every(m => m.status === 'done' || m.id === _tournMatchId);

        // Collect all winners from this round (including the one just played)
        const roundWinners = thisRoundW.map(m =>
            m.id === _tournMatchId ? winnerId : m.winner_id
        ).filter(Boolean);

        // Collect all losers from this round
        const roundLosers = thisRoundW.map(m =>
            m.id === _tournMatchId ? loserId : m.loser_id
        ).filter(Boolean);

        if (allDone) {
            // Only 1 winner left → they're the winners bracket champion
            // Check if there's a losers bracket champion to face
            const losersDoneMs = loserMs.filter(m => m.status === 'done');
            const losersChamp  = losersDoneMs.length > 0
                ? losersDoneMs[losersDoneMs.length - 1].winner_id : null;

            if (roundWinners.length === 1) {
                // Winners bracket champion determined
                if (losersChamp && finalMs.length === 0) {
                    // Create the final
                    await supa.from('tournament_matches').insert([{
                        tournament_id: _tournId,
                        round:         round + 1,
                        match_number:  1,
                        bracket:       'final',
                        p1_id:         roundWinners[0],
                        p2_id:         losersChamp,
                        status:        'pending'
                    }]);
                }
                // If no losers champ yet, final will be created when losers bracket finishes
            } else {
                // Create next winners bracket round matches
                const nextRound = round + 1;
                for (let i = 0; i < Math.floor(roundWinners.length / 2); i++) {
                    await supa.from('tournament_matches').insert([{
                        tournament_id: _tournId,
                        round:         nextRound,
                        match_number:  i + 1,
                        bracket:       'winners',
                        p1_id:         roundWinners[i * 2],
                        p2_id:         roundWinners[i * 2 + 1] || null,
                        status:        'pending'
                    }]);
                }
            }

            // Create losers bracket matches for all losers this round
            const existingLoserRounds = loserMs.length > 0
                ? Math.max(...loserMs.map(m => m.round)) : 0;
            const newLoserRound = existingLoserRounds + 1;
            for (let i = 0; i < Math.floor(roundLosers.length / 2); i++) {
                await supa.from('tournament_matches').insert([{
                    tournament_id: _tournId,
                    round:         newLoserRound,
                    match_number:  i + 1,
                    bracket:       'losers',
                    p1_id:         roundLosers[i * 2],
                    p2_id:         roundLosers[i * 2 + 1] || null,
                    status:        'pending'
                }]);
            }
        }
        // If not all done yet, just wait — the last match of the round triggers creation

    } else if (bracket === 'losers') {
        // Winner stays in losers bracket next round, loser is eliminated
        const thisRoundL = loserMs.filter(m => m.round === round);
        const allDone    = thisRoundL.every(m => m.status === 'done' || m.id === _tournMatchId);

        if (allDone) {
            const roundWinners = thisRoundL.map(m =>
                m.id === _tournMatchId ? winnerId : m.winner_id
            ).filter(Boolean);

            if (roundWinners.length === 1) {
                // Losers bracket champion — check if winners champ is waiting
                const winnersDoneMs = winnerMs.filter(m => m.status === 'done');
                const winnersChamp  = winnersDoneMs.length > 0
                    ? winnersDoneMs[winnersDoneMs.length - 1].winner_id : null;

                if (winnersChamp && finalMs.length === 0) {
                    await supa.from('tournament_matches').insert([{
                        tournament_id: _tournId,
                        round:         Math.max(...allMatches.map(m => m.round)) + 1,
                        match_number:  1,
                        bracket:       'final',
                        p1_id:         winnersChamp,
                        p2_id:         roundWinners[0],
                        status:        'pending'
                    }]);
                }
            } else {
                // More losers bracket matches needed
                const nextRound = round + 1;
                for (let i = 0; i < Math.floor(roundWinners.length / 2); i++) {
                    await supa.from('tournament_matches').insert([{
                        tournament_id: _tournId,
                        round:         nextRound,
                        match_number:  i + 1,
                        bracket:       'losers',
                        p1_id:         roundWinners[i * 2],
                        p2_id:         roundWinners[i * 2 + 1] || null,
                        status:        'pending'
                    }]);
                }
            }
        }

    } else if (bracket === 'final') {
        // 1st: winnerId, 2nd: loserId (winners bracket finalist who lost final)
        // 3rd: handled by checkAndCloseTournaments via losers bracket
    }
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
                pNames:       gameState.pNames,
                scores:       gameState.scores,
                legScore:     gameState.legScore,
                targetLegs:   gameState.targetLegs,
                currentIdx:   gameState.currentIdx,
                gameType:     gameState.gameType,
                teamPlayers:  gameState.teamPlayers,
                teamPlayerIdx: gameState.teamPlayerIdx,
                history:      gameState.history
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
        oneEighties: 0,
        twentySixes: 0,
        totalPoints: 0,
        dartsThrown: 0,
        pointsPre170: 0,
        dartsPre170: 0,
        dartsToClose: 0,
        isBelow170: false
    };
}

let gameState = {
    gameType: 'singles',
    isOfficial: true,
    pNames: ["P1", "P2"],
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

function setGameType(type) {
    gameState.gameType = type;
    document.getElementById('type-singles').classList.toggle('game-type-btn--active', type === 'singles');
    document.getElementById('type-doubles').classList.toggle('game-type-btn--active', type === 'doubles');
    document.getElementById('singles-select').style.display = type === 'singles' ? 'flex' : 'none';
    document.getElementById('doubles-select').style.display = type === 'doubles' ? 'flex' : 'none';
}

function startGame() {
    const startVal  = parseInt(document.getElementById('start-score-select').value);
    const legTarget = parseInt(document.getElementById('legs-to-win-select').value);
    const mode      = document.getElementById('checkout-mode-select').value;

    if (gameState.gameType === 'singles') {
        const p1 = document.getElementById('p1-select').value;
        const p2 = document.getElementById('p2-select').value;
        if (!p1 || !p2)  return alert("Bitte zwei Spieler auswaehlen!");
        if (p1 === p2)   return alert("Bitte zwei verschiedene Spieler auswaehlen!");
        gameState.pNames      = [p1, p2];
        gameState.teamPlayers = [[p1], [p2]];
        gameState.stats       = [makePlayerStats(), makePlayerStats()];
    } else {
        const t1p1 = document.getElementById('t1p1-select').value;
        const t1p2 = document.getElementById('t1p2-select').value;
        const t2p1 = document.getElementById('t2p1-select').value;
        const t2p2 = document.getElementById('t2p2-select').value;
        if (new Set([t1p1,t1p2,t2p1,t2p2]).size < 4) return alert("Bitte vier verschiedene Spieler auswaehlen!");
        gameState.pNames      = [t1p1 + " & " + t1p2, t2p1 + " & " + t2p2];
        gameState.teamPlayers = [[t1p1, t1p2], [t2p1, t2p2]];
        gameState.stats       = [makePlayerStats(), makePlayerStats(), makePlayerStats(), makePlayerStats()];
    }

    gameState.scores        = [startVal, startVal];
    gameState.history       = [[], []];
    gameState.legScore      = [0, 0];
    gameState.targetLegs    = legTarget;
    gameState.legStarter    = 0;
    gameState.currentIdx    = 0;
    gameState.teamPlayerIdx = [0, 0];
    gameState.mode          = mode;
    gameState.isOfficial    = document.getElementById('game-mode-track').classList.contains('game-mode-track--on');
    gameState.logs          = [];
    gameState.ausbullenActive = true; // block input until starter is chosen

    document.getElementById('nav-setup').style.display        = 'none';
    document.getElementById('nav-game-active').style.display  = 'block';
    document.getElementById('setup-view').style.display        = 'none';
    document.getElementById('active-game-view').style.display  = '';
    document.getElementById('active-game-view').classList.add('game-active');
    refreshDisplay();

    // Show starter selection modal
    document.getElementById('starter-p1').textContent = gameState.pNames[0];
    document.getElementById('starter-p2').textContent = gameState.pNames[1];
    document.getElementById('starter-modal-overlay').style.display = 'flex';
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
            const playerName = gameState.gameType === 'singles'
                ? gameState.pNames[teamIdx]
                : gameState.teamPlayers[teamIdx][playerWithinTeam];

            const insertedIds = [];

            // 26 fine
            if (pts === 26) {
                const id = await insertFine(playerName, FINE_REASONS.twentySix);
                if (id) insertedIds.push(id);
                showToast(`💸 ${playerName}: 26 — ${FINE_REASONS.twentySix.amount.toFixed(2).replace('.',',')} €`);
            }

            // Schnapszahl fine
            if (SCHNAPSZAHLEN.has(newScore)) {
                const id = await insertFine(playerName, FINE_REASONS.schnapszahl);
                if (id) insertedIds.push(id);
                showToast(`💸 ${playerName}: Schnapszahl (${newScore}) — ${FINE_REASONS.schnapszahl.amount.toFixed(2).replace('.',',')} €`);
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
}

function undoMove() {
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
    document.getElementById('match-modal-overlay').style.display = 'flex';
}

async function dismissMatchModal() {
    document.getElementById('match-modal-overlay').style.display = 'none';
    const startVal = parseInt(document.getElementById('start-score-select').value);
    gameState.scores   = [startVal, startVal];
    gameState.legScore = [0, 0];
    await clearLiveState();
    // Save tournament result if this was a tournament match
    if (_tournMatchId) {
        await saveTournamentResult(matchWinnerName);
    }
    exitGame(true);
}

function clearInput() {
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";
}

function resetForNextLeg() {
    const startVal = parseInt(document.getElementById('start-score-select').value);
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
}

// ── STARTER SELECTION ──
function selectStarter(teamIdx) {
    document.getElementById('starter-modal-overlay').style.display = 'none';
    gameState.ausbullenActive = false;
    gameState.legStarter  = teamIdx;
    gameState.currentIdx  = teamIdx;
    refreshDisplay();
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