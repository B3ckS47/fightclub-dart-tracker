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
    stats: [makePlayerStats(), makePlayerStats()]
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
    gameState.logs          = [];

    document.getElementById('nav-setup').style.display        = 'none';
    document.getElementById('nav-game-active').style.display  = 'block';
    document.getElementById('setup-view').style.display        = 'none';
    document.getElementById('active-game-view').style.display  = '';
    document.getElementById('active-game-view').classList.add('game-active');
    refreshDisplay();
}

function pressKey(num) {
    if (gameState.input.length < 3) {
        gameState.input += num;
        document.getElementById('input-preview').innerText = gameState.input;
    }
}

// Directly set score and submit — used by tablet quick-score buttons
function quickScore(val) {
    gameState.input = String(val);
    document.getElementById('input-preview').innerText = gameState.input;
    submitTurn();
}

async function submitTurn() {
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
                if (gameState.gameType === 'singles') {
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
    }

    // Cap history to last 20 entries — only last 4 are displayed anyway
    if (gameState.history[teamIdx].length > 20) gameState.history[teamIdx].shift();

    if (gameState.gameType === 'doubles') {
        gameState.teamPlayerIdx[teamIdx] = (playerWithinTeam + 1) % 2;
    }
    gameState.currentIdx = teamIdx === 0 ? 1 : 0;
    clearInput();
    refreshDisplay();
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