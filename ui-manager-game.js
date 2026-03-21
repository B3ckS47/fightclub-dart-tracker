// ── GAME PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

const SINGLES_SELECTS = ['p1-select', 'p2-select'];
const DOUBLES_SELECTS = ['t1p1-select', 't1p2-select', 't2p1-select', 't2p2-select'];
const GAME_SELECTS    = [...SINGLES_SELECTS, ...DOUBLES_SELECTS];

function updateDropdowns() {
    GAME_SELECTS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const prev = el.value;
        el.innerHTML = players.map(p =>
            `<option value="${p.name}">${p.name}</option>`
        ).join('');
        if (prev && players.find(p => p.name === prev)) el.value = prev;
        el.onchange = refreshGameDropdowns;
    });
    // Default p2 to second player
    const p2 = document.getElementById('p2-select');
    if (p2 && players.length > 1) p2.selectedIndex = 1;
    refreshGameDropdowns();
}

function refreshGameDropdowns() {
    // Only filter within the currently active mode's selects
    const isDoubles = gameState.gameType === 'doubles';
    const activeSelects = isDoubles ? DOUBLES_SELECTS : SINGLES_SELECTS;

    const selected = new Set(
        activeSelects
            .map(id => document.getElementById(id))
            .filter(el => el)
            .map(el => el.value)
            .filter(Boolean)
    );

    activeSelects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const current = el.value;
        el.innerHTML = players
            .filter(p => p.name === current || !selected.has(p.name))
            .map(p => `<option value="${p.name}">${p.name}</option>`)
            .join('');
        el.value = current;
    });
}
function refreshDisplay() {
    const isDoubles = gameState.gameType === 'doubles';
    const activeIdx = gameState.currentIdx;

    document.getElementById('p1-name-display').innerText = gameState.pNames[0];
    document.getElementById('p2-name-display').innerText = gameState.pNames[1];
    document.getElementById('p1-score-display').innerText = gameState.scores[0];
    document.getElementById('p2-score-display').innerText = gameState.scores[1];
    document.getElementById('mode-display').innerText = `FIRST TO ${gameState.targetLegs} LEGS`;

    // Render legs as dots: ● filled, ○ empty
    [0, 1].forEach(idx => {
        const won  = gameState.legScore[idx];
        const dots = Array.from({ length: gameState.targetLegs }, (_, i) =>
            i < won ? '●' : '○'
        ).join(' ');
        document.getElementById(`p${idx + 1}-legs-display`).innerText = dots;
    });

    // Doubles: current player badge (mobile) + throwing name in header (tablet)
    const cp1 = document.getElementById('p1-current-player');
    const cp2 = document.getElementById('p2-current-player');
    const t1  = document.getElementById('p1-throwing-display');
    const t2  = document.getElementById('p2-throwing-display');
    if (isDoubles) {
        const throwing1 = gameState.teamPlayers[0][gameState.teamPlayerIdx[0]];
        const throwing2 = gameState.teamPlayers[1][gameState.teamPlayerIdx[1]];
        cp1.style.display = 'block';
        cp2.style.display = 'block';
        cp1.innerText = '🎯 ' + throwing1;
        cp2.innerText = '🎯 ' + throwing2;
        if (t1) { t1.textContent = '🎯 ' + throwing1; t1.classList.remove('sc-throwing--dot'); }
        if (t2) { t2.textContent = '🎯 ' + throwing2; t2.classList.remove('sc-throwing--dot'); }
    } else {
        cp1.style.display = 'none';
        cp2.style.display = 'none';
        // Starter dot keeps left column occupied so name stays centered
        if (t1) { t1.textContent = gameState.legStarter === 0 ? '●' : ''; t1.classList.toggle('sc-throwing--dot', gameState.legStarter === 0); }
        if (t2) { t2.textContent = gameState.legStarter === 1 ? '●' : ''; t2.classList.toggle('sc-throwing--dot', gameState.legStarter === 1); }
    }

    // Active card highlight
    const p1Card  = document.getElementById('p1-card');
    const p2Card  = document.getElementById('p2-card');
    const p1Score = document.getElementById('p1-score-display');
    const p2Score = document.getElementById('p2-score-display');

    if (activeIdx === 0) {
        p1Card.classList.add('score-card--active');
        p1Card.classList.remove('score-card--inactive');
        p2Card.classList.remove('score-card--active');
        p2Card.classList.add('score-card--inactive');
        p1Score.classList.add('score-active');
        p2Score.classList.remove('score-active');
        document.getElementById('p1-name-display').style.color = 'var(--text-primary)';
        document.getElementById('p2-name-display').style.color = '';
    } else {
        p2Card.classList.add('score-card--active');
        p2Card.classList.remove('score-card--inactive');
        p1Card.classList.remove('score-card--active');
        p1Card.classList.add('score-card--inactive');
        p2Score.classList.add('score-active');
        p1Score.classList.remove('score-active');
        document.getElementById('p2-name-display').style.color = 'var(--text-primary)';
        document.getElementById('p1-name-display').style.color = '';
    }

    renderHist(0, 'p1-history');
    renderHist(1, 'p2-history');

    // Averages
    const startScore = parseInt(document.getElementById('start-score-select').value);
    [0, 1].forEach(teamIdx => {
        const pointsScored = startScore - gameState.scores[teamIdx];
        const turns = gameState.history[teamIdx].filter(val => val !== "BUST").length;
        const avg = turns > 0 ? (pointsScored / turns).toFixed(2) : "0.00";
        document.getElementById(`p${teamIdx + 1}-avg-display`).innerText = `AVG: ${avg}`;
    });

    // Checkout helpers
    const isTablet = window.innerWidth >= 768;
    const helper   = document.getElementById('checkout-helper');
    const pathText = document.getElementById('checkout-path');
    const curScore = gameState.scores[activeIdx];

    if (!isTablet && gameState.mode === 'double' && curScore <= 170 && checkouts[curScore]) {
        helper.style.display = 'flex';
        pathText.innerText = checkouts[curScore];
    } else {
        helper.style.display = 'none';
    }

    [0, 1].forEach(idx => {
        const box  = document.getElementById(`p${idx + 1}-checkout`);
        const path = document.getElementById(`p${idx + 1}-checkout-path`);
        if (!box) return;
        const score = gameState.scores[idx];
        if (isTablet && gameState.mode === 'double' && score <= 170 && checkouts[score]) {
            box.style.display = 'block';
            path.innerText = checkouts[score];
        } else {
            box.style.display = 'none';
        }
    });
}

function renderHist(pIdx, elId) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    const recentThrows = gameState.history[pIdx].slice(-4).reverse();
    recentThrows.forEach((val, i) => {
        const item = document.createElement('div');
        item.className = 'history-row';
        const throwNum = gameState.history[pIdx].length - i;
        const numSpan  = document.createElement('span');
        numSpan.className   = 'history-throw-num';
        numSpan.textContent = `#${throwNum}`;
        const valSpan  = document.createElement('span');
        valSpan.className   = 'history-throw-val';
        valSpan.textContent = val;
        if (val === "BUST") valSpan.style.color = "var(--red)";
        item.appendChild(numSpan);
        item.appendChild(valSpan);
        el.appendChild(item);
    });
}

function exitGame(isFinished = false) {
    const startVal = parseInt(document.getElementById('start-score-select').value);
    const gameInProgress = gameState.scores[0] !== startVal || gameState.scores[1] !== startVal
        || gameState.legScore[0] > 0 || gameState.legScore[1] > 0;

    if (!isFinished && gameInProgress) {
        document.getElementById('exit-modal-overlay').style.display = 'flex';
        return;
    }

    doExitGame();
}

function confirmExit() {
    document.getElementById('exit-modal-overlay').style.display = 'none';
    doExitGame();
}

function cancelExit() {
    document.getElementById('exit-modal-overlay').style.display = 'none';
}

function doExitGame() {
    if (typeof clearLiveState === 'function') clearLiveState();
    // If launched from a tournament, go back to the tournament view
    const tournId = new URLSearchParams(window.location.search).get('tournament_id');
    if (tournId) {
        window.location.href = `tournament-view.html?id=${tournId}`;
        return;
    }
    document.getElementById('nav-setup').style.display = 'block';
    document.getElementById('nav-game-active').style.display = 'none';
    document.getElementById('setup-view').style.display = 'block';
    document.getElementById('active-game-view').classList.remove('game-active');
    document.getElementById('active-game-view').style.display = 'none';
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";
}

window.exitGame = exitGame;

function toggleGameMode() {
    const track = document.getElementById('game-mode-track');
    const label = document.getElementById('game-mode-label');
    const isOn  = track.classList.toggle('game-mode-track--on');
    label.textContent = isOn ? '🏆 Offizielles Spiel' : '🎉 Spaßspiel';
}