// --- NAVIGATION ---
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    // Reset nav buttons
    document.getElementById('nav-game').classList.remove('active');
    document.getElementById('nav-stats').classList.remove('active');

    if (id === 'game-page') {
        document.getElementById('nav-game').classList.add('active');
    }

    if (id === 'stats-page') {
        document.getElementById('nav-stats').classList.add('active');
        updateStatsUI();
    }
}

// Show the players of the club as a Leaderboard
function updateStatsUI() {
    const box = document.getElementById('player-list-box');
    if (!box) return;

    if (players.length === 0) {
        box.innerHTML = '<p class="muted-text">Noch keine Mitglieder vorhanden.</p>';
        return;
    }

    box.innerHTML = players.map((p, index) => {
        const rank = index + 1;
        const rankBg = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : '#3a3a48';

        return `
<div class="lb-row" onclick="openPlayerProfile('${p.id}')">
    <div class="lb-rank" style="background:${rankBg};">${rank}</div>
    <div class="lb-info">
        <div class="lb-name">${p.name}</div>
        <div class="lb-sub">Avg: ${p.stats.avgGame} &nbsp;·&nbsp; W-L: ${p.stats.gamesWon}–${p.stats.gamesLost}</div>
    </div>
    <div class="lb-winrate">
        <div class="lb-winrate-val">${p.stats.winRatio}%</div>
        <div class="lb-winrate-lbl">Win Rate</div>
    </div>
</div>`;
    }).join('');
}

// Creates the Profile-View with all Statistics
async function openPlayerProfile(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return console.error("Player not found!");

    const summaryBox  = document.getElementById('profile-stats-summary');
    const historyBox  = document.getElementById('profile-history-list');
    const advancedBox = document.getElementById('profile-advanced-stats');

    document.getElementById('profile-name').innerText = player.name;

    const delBtn = document.getElementById('delete-player-btn');
    if (delBtn) delBtn.onclick = () => deletePlayer(playerId, player.name);

    showPage('player-profile-view');
    historyBox.innerHTML = '<p class="muted-text" style="padding:10px 0;">Lade Matches…</p>';

    // Load Match History from Supabase
    const { data: history, error } = await supa
        .from('game_history')
        .select('*')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error || !history || history.length === 0) {
        summaryBox.innerHTML = '<p class="muted-text">Noch keine Statistiken.</p>';
        historyBox.innerHTML = '<p class="muted-text" style="padding:20px 0;">Keine Matches gefunden.</p>';
        return;
    }

    // Calculate Totals
    const totalGames  = history.length;
    const gamesWon    = history.filter(h => h.is_win === true).length;
    const gamesLost   = totalGames - gamesWon;
    const winRate     = ((gamesWon / totalGames) * 100).toFixed(1);
    const total180s   = history.reduce((sum, h) => sum + (h.one_eighties || 0), 0);
    const total26s    = history.reduce((sum, h) => sum + (h.twenty_sixes || 0), 0);
    const lifetimeAvg = (history.reduce((sum, h) => sum + (h.avg_game || 0), 0) / totalGames).toFixed(2);
    const avgTo170    = (history.reduce((sum, h) => sum + (h.avg_pre_170 || 0), 0) / totalGames).toFixed(2);
    const totalLegsWon    = history.reduce((sum, h) => sum + (h.legs_won  || 0), 0);
    const totalLegsLost   = history.reduce((sum, h) => sum + (h.legs_lost || 0), 0);
    const totalLegsPlayed = totalLegsWon + totalLegsLost;
    const bestGameAvg = Math.max(...history.map(h => h.avg_game || 0)).toFixed(2);
    const totalClosingDarts  = history.reduce((sum, h) => sum + (h.closing_darts || 0), 0);
    const avgVisitsToClose   = (totalClosingDarts / totalGames / 3).toFixed(1);

    // Key Stats Grid
    summaryBox.innerHTML = `
<div class="stat-box stat-box--accent">
    <div class="stat-label">Win Rate</div>
    <div class="stat-value stat-value--green">${winRate}%</div>
</div>
<div class="stat-box">
    <div class="stat-label">Lifetime Avg</div>
    <div class="stat-value">${lifetimeAvg}</div>
</div>
<div class="stat-box">
    <div class="stat-label">180s</div>
    <div class="stat-value stat-value--accent">${total180s}</div>
</div>
<div class="stat-box">
    <div class="stat-label">26s</div>
    <div class="stat-value">${total26s}</div>
</div>`;

    // Advanced Analytics Grid
    advancedBox.innerHTML = `
<div class="adv-box">
    <div class="adv-label">Games (W / L)</div>
    <div class="adv-value">${totalGames} &nbsp;<span style="color:var(--green)">${gamesWon}</span>/<span style="color:var(--red)">${gamesLost}</span></div>
</div>
<div class="adv-box">
    <div class="adv-label">Best Game Avg</div>
    <div class="adv-value" style="color:var(--accent)">${bestGameAvg}</div>
</div>
<div class="adv-box">
    <div class="adv-label">Total Legs</div>
    <div class="adv-value">${totalLegsPlayed}</div>
</div>
<div class="adv-box">
    <div class="adv-label">Legs (W / L)</div>
    <div class="adv-value">${totalLegsWon} / ${totalLegsLost}</div>
</div>
<div class="adv-box">
    <div class="adv-label">Avg to 170</div>
    <div class="adv-value">${avgTo170}</div>
</div>
<div class="adv-box">
    <div class="adv-label">Visits to Close</div>
    <div class="adv-value">${avgVisitsToClose}</div>
</div>`;

    // Match History List
    historyBox.innerHTML = history.map(h => `
<div class="match-row ${h.is_win ? 'match-row--win' : 'match-row--loss'}">
    <div>
        <div class="match-result ${h.is_win ? 'match-result--win' : 'match-result--loss'}">
            ${h.is_win ? 'WON' : 'LOST'} <span class="match-opponent">vs ${h.opponent_name || 'Opponent'}</span>
        </div>
        <div class="match-date">${new Date(h.created_at).toLocaleDateString('de-DE')}</div>
    </div>
    <div class="match-right">
        <div>
            <div class="match-avg">Avg: <strong>${h.avg_game}</strong></div>
            <div class="match-legs">Legs: ${h.leg_count}</div>
        </div>
        <button class="match-delete-btn" onclick="deleteMatch('${h.id}', '${player.id}')">Löschen</button>
    </div>
</div>`).join('');
}

function refreshDisplay() {
    const isDoubles = gameState.gameType === 'doubles';
    const activeIdx = gameState.currentIdx;

    // Team / player names
    document.getElementById('p1-name-display').innerText = gameState.pNames[0];
    document.getElementById('p2-name-display').innerText = gameState.pNames[1];
    document.getElementById('p1-score-display').innerText = gameState.scores[0];
    document.getElementById('p2-score-display').innerText = gameState.scores[1];
    document.getElementById('mode-display').innerText = `FIRST TO ${gameState.targetLegs} LEGS`;
    document.getElementById('p1-legs-display').innerText = `LEGS: ${gameState.legScore[0]}`;
    document.getElementById('p2-legs-display').innerText = `LEGS: ${gameState.legScore[1]}`;

    // Doubles: show current player badge inside each team card
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

    // Averages — in doubles, average the two team members together
    const startScore = parseInt(document.getElementById('start-score-select').value);
    [0, 1].forEach(teamIdx => {
        const pointsScored = startScore - gameState.scores[teamIdx];
        const turns = gameState.history[teamIdx].filter(val => val !== "BUST").length;
        const avg = turns > 0 ? (pointsScored / turns).toFixed(2) : "0.00";
        document.getElementById(`p${teamIdx + 1}-avg-display`).innerText = `AVG: ${avg}`;
    });

    // Checkout helper — shared (mobile) + per-player (tablet)
    const isTablet = window.innerWidth >= 768;

    // Shared mobile checkout (active player only)
    const helper   = document.getElementById('checkout-helper');
    const pathText = document.getElementById('checkout-path');
    const curScore = gameState.scores[activeIdx];
    if (!isTablet && gameState.mode === 'double' && curScore <= 170 && checkouts[curScore]) {
        helper.style.display = 'flex';
        pathText.innerText = checkouts[curScore];
    } else {
        helper.style.display = 'none';
    }

    // Per-player checkouts (tablet only)
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

// Keep the last 4 throws as history
function renderHist(pIdx, elId) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    const recentThrows = gameState.history[pIdx].slice(-4).reverse();

    recentThrows.forEach((val, i) => {
        const item = document.createElement('div');
        if (val === "BUST") item.style.color = "var(--red)";
        item.innerText = val;
        el.appendChild(item);
    });
}

// Player dropdowns for game setup
function updateDropdowns() {
    const options = players.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    ['p1-select','p2-select','t1p1-select','t1p2-select','t2p1-select','t2p2-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
    });
}

function exitGame(isFinished = false) {
    const startVal = parseInt(document.getElementById('start-score-select').value);
    const gameInProgress = gameState.scores[0] !== startVal || gameState.scores[1] !== startVal
        || gameState.legScore[0] > 0 || gameState.legScore[1] > 0;

    if (!isFinished && gameInProgress) {
        const ok = await showConfirm('Spiel beenden', 'Spiel läuft noch! Wirklich beenden? Fortschritt geht verloren.');
        if (!ok) return;
    }

    document.getElementById('nav-default').style.display     = 'flex';
    document.getElementById('nav-game-active').style.display = 'none';
    document.getElementById('setup-view').style.display      = 'block';
    document.getElementById('active-game-view').classList.remove('game-active');
    document.getElementById('active-game-view').style.display = 'none';
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";

    showPage('game-page');
}

window.exitGame = exitGame;