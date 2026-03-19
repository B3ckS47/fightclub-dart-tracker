// ── AUTO-FINE CONSTANTS (IDs from fines_reasons table) ──
const FINE_REASONS = {
    twentySix:    { id: '5183d5de-bad5-4f7c-8703-b0bc89ae6818', name: '26',                 amount: 0.30 },
    ausbullen:    { id: '28d2102b-e892-4366-8580-f752e81c8507', name: 'Sieger ausbullen',   amount: 1.00 },
    schnapszahl:  { id: '30edf2dd-5feb-4f8b-a2dc-566a496484ae', name: 'Schnapszahl stellen',amount: 0.20 }
};

const SCHNAPSZAHLEN = new Set([11,22,33,44,55,66,77,88,99,111,222,333,444,555]);

// Insert a fine row silently — looks up player UUID by name
async function insertFine(playerName, reason) {
    const player = players.find(p => p.name === playerName);
    if (!player) return;
    try {
        await supa.from('fines_ledger').insert([{
            player_id:  player.id,
            amount:     reason.amount,
            type:       'fine',
            reason:     reason.name,
            note:       null,
            created_by: 'system'
        }]);
    } catch(e) { console.error('Fine insert error:', e); }
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

    document.getElementById('nav-setup').style.display        = 'none';
    document.getElementById('nav-game-active').style.display  = 'block';
    document.getElementById('setup-view').style.display        = 'none';
    document.getElementById('active-game-view').style.display  = '';
    document.getElementById('active-game-view').classList.add('game-active');
    refreshDisplay();
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
    if (pts > 180) return alert("Max is 180!");

    // Snapshot for undo — explicitly exclude logs to prevent exponential growth
    const { logs: _ignored, ...snapshot } = gameState;
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
            setTimeout(async () => {
                alert("MATCH OVER! " + gameState.pNames[teamIdx] + " wins!");
                if (gameState.gameType === 'singles' && gameState.isOfficial) {
                    try { await saveMatchToSupabase(); } catch(e) { console.error(e); }
                }
                const startVal = parseInt(document.getElementById('start-score-select').value);
                gameState.scores   = [startVal, startVal];
                gameState.legScore = [0, 0];
                exitGame(true);
            }, 100);
        } else {
            alert("Leg gewonnen von " + gameState.pNames[teamIdx] + "!");
            resetForNextLeg();
        }
        return;
    }

    if (newScore < 0 || (newScore === 1 && gameState.mode === 'double')) {
        alert("BUST!");
        gameState.history[teamIdx].push("BUST");
    } else {
        gameState.scores[teamIdx] = newScore;
        gameState.history[teamIdx].push(pts);

        // ── AUTO FINES (official games only) ──
        if (gameState.isOfficial) {
            const playerName = gameState.gameType === 'singles'
                ? gameState.pNames[teamIdx]
                : gameState.teamPlayers[teamIdx][playerWithinTeam];

            // 26 fine
            if (pts === 26) {
                insertFine(playerName, FINE_REASONS.twentySix);
                showToast(`💸 ${playerName}: 26 — ${FINE_REASONS.twentySix.amount.toFixed(2).replace('.',',')} €`);
            }

            // Schnapszahl fine
            if (SCHNAPSZAHLEN.has(newScore)) {
                insertFine(playerName, FINE_REASONS.schnapszahl);
                showToast(`💸 ${playerName}: Schnapszahl (${newScore}) — ${FINE_REASONS.schnapszahl.amount.toFixed(2).replace('.',',')} €`);
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
    // After both teams have had 20 turns each and neither has won the leg
    const turns0 = gameState.history[0].length;
    const turns1 = gameState.history[1].length;
    if (gameState.isOfficial && turns0 >= 20 && turns1 >= 20 && gameState.scores[0] > 0 && gameState.scores[1] > 0) {
        showAusbullen();
    }
}

function undoMove() {
    if (gameState.logs.length === 0) return;
    const lastSnapshot = gameState.logs.pop();
    const currentLogs  = gameState.logs; // keep the remaining logs
    Object.assign(gameState, lastSnapshot);
    gameState.logs = currentLogs; // restore logs, not the snapshotted ones
    refreshDisplay();
    clearInput();
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

// ── AUSBULLEN ──
function showAusbullen() {
    gameState.ausbullenActive = true;
    clearInput();

    document.getElementById('ausbullen-p1').textContent = gameState.pNames[0];
    document.getElementById('ausbullen-p2').textContent = gameState.pNames[1];
    document.getElementById('ausbullen-overlay').style.display = 'flex';
}

function selectAusbullenWinner(teamIdx) {
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
        setTimeout(async () => {
            alert("MATCH OVER! " + gameState.pNames[teamIdx] + " wins!");
            if (gameState.gameType === 'singles' && gameState.isOfficial) {
                try { await saveMatchToSupabase(); } catch(e) { console.error(e); }
            }
            const startVal = parseInt(document.getElementById('start-score-select').value);
            gameState.scores   = [startVal, startVal];
            gameState.legScore = [0, 0];
            exitGame(true);
        }, 100);
    } else {
        alert("Leg gewonnen von " + gameState.pNames[teamIdx] + "! (Ausbullen)");
        resetForNextLeg();
    }
}