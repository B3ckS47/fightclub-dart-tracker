// ── GAME PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

const SINGLES_SELECTS = ['p1-select', 'p2-select'];
const DOUBLES_SELECTS = ['t1p1-select', 't1p2-select', 't2p1-select', 't2p2-select'];
const ALL_GAME_SELECTS = [...SINGLES_SELECTS, ...DOUBLES_SELECTS];

function updateDropdowns() {
    // `players` is sorted by win rate (leaderboard order) globally — sort a
    // copy alphabetically here so the setup dropdowns stay easy to scan.
    const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'de'));

    // Populate all selects with full player list
    ALL_GAME_SELECTS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const prev = el.value;
        el.innerHTML = sortedPlayers.map(p =>
            `<option value="${p.name}">${p.name}</option>`
        ).join('');
        if (prev && sortedPlayers.find(p => p.name === prev)) el.value = prev;
        el.onchange = refreshGameDropdowns;
    });
    // Default p2 to second player
    const p2 = document.getElementById('p2-select');
    if (p2 && sortedPlayers.length > 1) p2.selectedIndex = 1;
    refreshGameDropdowns();
    if (typeof refreshBotMemberCarousel === 'function') refreshBotMemberCarousel();
    if (typeof renderOnlineMemberList === 'function') renderOnlineMemberList();
}

// ── OPPONENT TYPE: Mitglied / Training / Online ──
function setOpponentType(type) {
    const isBot    = type === 'bot';
    const isOnline = type === 'online';
    const isSolo   = isBot || isOnline; // both force Einzel, no player picker

    document.getElementById('opp-member').classList.toggle('game-type-btn--active', type === 'member');
    document.getElementById('opp-bot').classList.toggle('game-type-btn--active', isBot);
    document.getElementById('opp-online').classList.toggle('game-type-btn--active', isOnline);

    if (isSolo && gameState.gameType !== 'singles') setGameType('singles');

    // Training/Online are always "you vs. one opponent", 1-on-1 — no need to
    // ask Einzel/Doppel or show a player picker at all
    document.getElementById('game-type-selector-wrap').style.display = isSolo ? 'none' : '';
    document.getElementById('game-type-divider').style.display       = isSolo ? 'none' : '';
    document.getElementById('singles-select').style.display = isSolo ? 'none' : 'flex';

    document.getElementById('training-config').style.display   = isBot    ? '' : 'none';
    document.getElementById('online-config').style.display     = isOnline ? '' : 'none';
    document.getElementById('game-mode-selector').style.display = isSolo  ? 'none' : '';

    document.getElementById('start-game-btn').textContent = isOnline ? 'EINLADEN' : 'SPIEL STARTEN';

    if (isBot)    refreshBotMemberCarousel();
    if (isOnline) renderOnlineMemberList();
}

// Dispatcher for the setup screen's single primary button — starts a local
// game normally, or sends an online invite instead when Online mode is active.
function onStartButtonClick() {
    const isOnline = document.getElementById('opp-online').classList.contains('game-type-btn--active');
    if (isOnline) {
        if (typeof sendOnlineInvite === 'function') sendOnlineInvite();
    } else {
        startGame();
    }
}

function setBotStrengthMode(mode) {
    document.getElementById('bot-mode-custom').classList.toggle('game-type-btn--active', mode === 'custom');
    document.getElementById('bot-mode-member').classList.toggle('game-type-btn--active', mode === 'member');
    document.getElementById('bot-custom-panel').style.display = mode === 'custom' ? '' : 'none';
    document.getElementById('bot-member-panel').style.display = mode === 'member' ? '' : 'none';
}

function syncBotAvgFromSlider(val) {
    document.getElementById('bot-target-avg-input').value = val;
}
function syncBotAvgFromNumber(val) {
    const clamped = Math.min(100, Math.max(20, parseInt(val) || 20));
    document.getElementById('bot-target-avg-slider').value = clamped;
}

// ── "WIE MITGLIED" CARD PICKER (weakest → strongest, left to right) ──
let selectedBotMemberName = null;

function refreshBotMemberCarousel() {
    const el = document.getElementById('bot-member-carousel');
    if (!el) return;
    const sortedPlayers = players
        .filter(p => p.isMember) // guests can't be mirrored — same flag used to split Mitglieder/Gäste on the dashboard
        .sort((a, b) => parseFloat(a.stats.avgGame) - parseFloat(b.stats.avgGame)); // weakest -> strongest

    el.innerHTML = sortedPlayers.map(p => {
        const avg      = parseFloat(p.stats.avgGame).toFixed(2);
        const initials = (p.name || '?').slice(0, 2).toUpperCase();
        const inner    = p.avatar_url ? `<img src="${p.avatar_url}" alt="">` : `<span>${initials}</span>`;
        return `
<div class="bot-member-card" data-name="${escHtmlGame(p.name)}">
    <div class="bot-member-card-avatar">${inner}</div>
    <div class="bot-member-card-name">${escHtmlGame(p.name)}</div>
    <div class="bot-member-card-avg">Ø ${avg}</div>
</div>`;
    }).join('');

    // Keep the current selection if that member is still in the list, else default to the weakest (leftmost)
    const stillPresent = sortedPlayers.find(p => p.name === selectedBotMemberName);
    if (sortedPlayers.length > 0) selectBotMember(stillPresent ? stillPresent.name : sortedPlayers[0].name);
}

function selectBotMember(name) {
    selectedBotMemberName = name;
    document.querySelectorAll('.bot-member-card').forEach(c => {
        c.classList.toggle('bot-member-card--active', c.dataset.name === name);
    });
}

// Click delegation — the container is already in the HTML by the time this
// script runs (it's loaded at the end of <body>), so no need to wait for
// DOMContentLoaded here.
(() => {
    const carousel = document.getElementById('bot-member-carousel');
    if (!carousel) return;
    carousel.addEventListener('click', (e) => {
        const card = e.target.closest('.bot-member-card');
        if (card) selectBotMember(card.dataset.name);
    });
})();

// "Zufall" — a light chases across the cards, slowing down, and lands on a
// random member. Same visual idea as a raffle/case-opening reveal, built
// with plain DOM/CSS (no external assets).
function spinRandomBotMember() {
    const cards = [...document.querySelectorAll('.bot-member-card')];
    if (cards.length === 0) return;
    const btn = document.getElementById('bot-random-btn');
    btn.disabled = true;

    const finalIndex = Math.floor(Math.random() * cards.length);
    const totalSteps = cards.length * 3 + finalIndex; // at least a couple full sweeps before landing
    let step = 0;

    function tick() {
        const idx = step % cards.length;
        cards.forEach(c => c.classList.remove('bot-member-card--active'));
        cards[idx].classList.add('bot-member-card--active');
        cards[idx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

        if (step >= totalSteps) {
            selectBotMember(cards[finalIndex].dataset.name);
            btn.disabled = false;
            return;
        }
        step++;
        const progress = step / totalSteps;
        const delay = 40 + Math.pow(progress, 3) * 260; // eases out from ~40ms to ~300ms between steps
        setTimeout(tick, delay);
    }
    tick();
}

// ── ONLINE MODE: member invite picker (alphabetical, no averages) ──
let selectedOnlineInviteeName = null;

function renderOnlineMemberList() {
    const el = document.getElementById('online-invite-list');
    if (!el) return;
    const raw = fcGetUser();
    const me  = raw ? JSON.parse(raw) : null;
    const sortedPlayers = players
        .filter(p => p.isMember && (!me || p.id !== me.player_id)) // can't invite yourself
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    el.innerHTML = sortedPlayers.map(p => {
        const initials = (p.name || '?').slice(0, 2).toUpperCase();
        const inner    = p.avatar_url ? `<img src="${p.avatar_url}" alt="">` : `<span>${initials}</span>`;
        return `
<div class="bot-member-card" data-name="${escHtmlGame(p.name)}">
    <div class="bot-member-card-avatar">${inner}</div>
    <div class="bot-member-card-name">${escHtmlGame(p.name)}</div>
</div>`;
    }).join('');

    const stillPresent = sortedPlayers.find(p => p.name === selectedOnlineInviteeName);
    selectOnlineInvitee(stillPresent ? stillPresent.name : null);
}

function selectOnlineInvitee(name) {
    selectedOnlineInviteeName = name;
    document.querySelectorAll('#online-invite-list .bot-member-card').forEach(c => {
        c.classList.toggle('bot-member-card--active', c.dataset.name === name);
    });
}

// Click delegation — same reasoning as the bot-member-carousel one above:
// the container already exists by the time this script runs.
(() => {
    const list = document.getElementById('online-invite-list');
    if (!list) return;
    list.addEventListener('click', (e) => {
        const card = e.target.closest('.bot-member-card');
        if (card) selectOnlineInvitee(card.dataset.name);
    });
})();

// Shows/hides the numpad's undo button and the match-modal undo button —
// online games disable undo entirely (see game-logic.js undoMove()).
function toggleOnlineUndoButtons(show) {
    document.querySelectorAll('.key-undo').forEach(btn => { btn.style.display = show ? '' : 'none'; });
    const matchUndo = document.getElementById('match-modal-undo-btn');
    if (matchUndo) matchUndo.style.display = show ? '' : 'none';
}

function escHtmlGame(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function refreshGameDropdowns() {
    // Same alphabetical order as updateDropdowns() — `players` itself stays
    // sorted by win rate, so re-sort a copy here too.
    const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name, 'de'));

    // Only filter within the currently active mode's selects
    const isDoubles    = gameState.gameType === 'doubles';
    const activeGroup  = isDoubles ? DOUBLES_SELECTS : SINGLES_SELECTS;

    const selected = new Set(
        activeGroup
            .map(id => document.getElementById(id))
            .filter(el => el)
            .map(el => el.value)
            .filter(Boolean)
    );

    activeGroup.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const current = el.value;
        el.innerHTML = sortedPlayers
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
    const startScore = gameState.startScore;
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

    // ── ONLINE MODE: "waiting for opponent" banner + disabled input ──
    const onlineBanner = document.getElementById('online-waiting-banner');
    if (onlineBanner) {
        const isOnline = gameState.opponentType === 'online';
        const myTurn   = gameState.currentIdx === gameState.onlineMyTeamIdx;
        onlineBanner.style.display = (isOnline && !myTurn) ? 'block' : 'none';
        document.querySelectorAll('.controls').forEach(c => {
            c.classList.toggle('controls--waiting', isOnline && !myTurn);
        });
    }
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
    const startVal = gameState.startScore;
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
    if (typeof clearPendingBotTurn === 'function') clearPendingBotTurn(); // cancel any pending bot throw when leaving the game
    if (typeof clearLiveState === 'function') clearLiveState();
    if (gameState.opponentType === 'online' && gameState.onlineGameId) {
        supa.from('online_games')
            .update({ status: 'abandoned', finished_at: new Date().toISOString() })
            .eq('id', gameState.onlineGameId)
            .then(() => {})
            .catch(e => console.error('Online abandon write error:', e));
        if (typeof stopOnlinePolling === 'function') stopOnlinePolling();
        gameState.onlineGameId = null;
    }
    if (typeof toggleOnlineUndoButtons === 'function') toggleOnlineUndoButtons(true); // restore undo for the next (non-online) game
    // If launched from a tournament, go back to the tournament view
    const tournId = new URLSearchParams(window.location.search).get('tournament_id');
    if (tournId) {
        window.location.href = `tournament-view.html?id=${tournId}`;
        return;
    }
    document.getElementById('nav-setup').style.display = 'block';
    document.getElementById('nav-game-active').style.display = 'none';
    document.getElementById('setup-view').style.display = '';
    document.getElementById('active-game-view').classList.remove('game-active');
    document.getElementById('active-game-view').style.display = 'none';
    gameState.input = "";
    document.getElementById('input-preview').innerText = "0";
}

window.exitGame = exitGame;

function setGameMode(official) {
    document.getElementById('game-official-btn').classList.toggle('game-type-btn--active', official);
    document.getElementById('game-fun-btn').classList.toggle('game-type-btn--active', !official);
}