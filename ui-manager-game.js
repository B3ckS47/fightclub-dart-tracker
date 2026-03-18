// ── GAME PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

function updateDropdowns() {
    const options = players.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    ['p1-select','p2-select','t1p1-select','t1p2-select','t2p1-select','t2p2-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
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
    document.getElementById('p1-legs-display').innerText = `LEGS: ${gameState.legScore[0]}`;
    document.getElementById('p2-legs-display').innerText = `LEGS: ${gameState.legScore[1]}`;

    // Doubles: current player badge
    const cp1 = document.getElementById('p1-current-player');
    const cp2 = document.getElementById('p2-current-player');
    if (isDoubles) {
        cp1.style.display = 'block';
        cp2.style.display = 'block';
        cp1.innerText = '🎯 ' + gameState.teamPlayers[0][gameState.teamPlayerIdx[0]];
        cp2.innerText = '🎯 ' + gameState.teamPlayers[1][gameState.teamPlayerIdx[1]];
    } else {
        cp1.style.display = 'none';
        cp2.style.display = 'none';
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
    } else {
        p2Card.classList.add('score-card--active');
        p2Card.classList.remove('score-card--inactive');
        p1Card.classList.remove('score-card--active');
        p1Card.classList.add('score-card--inactive');
        p2Score.classList.add('score-active');
        p1Score.classList.remove('score-active');
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
            box.style.display = 'flex';
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
    recentThrows.forEach(val => {
        const item = document.createElement('div');
        if (val === "BUST") item.style.color = "var(--red)";
        item.innerText = val;
        el.appendChild(item);
    });
}

function exitGame(isFinished = false) {
    const startVal = parseInt(document.getElementById('start-score-select').value);
    const gameInProgress = gameState.scores[0] !== startVal || gameState.scores[1] !== startVal
        || gameState.legScore[0] > 0 || gameState.legScore[1] > 0;

    if (!isFinished && gameInProgress) {
        const confirmExit = confirm("⚠️ Spiel läuft noch! Wirklich beenden? Fortschritt geht verloren.");
        if (!confirmExit) return;
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