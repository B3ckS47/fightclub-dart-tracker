// ── DASHBOARD PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function updateDropdowns() {} // Not needed on dashboard
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

async function openPlayerProfile(playerId) {
    const player = players.find(p => p.id === playerId);
    if (!player) return;

    const summaryBox    = document.getElementById('profile-stats-summary');
    const historyBox    = document.getElementById('profile-history-list');
    const advancedBox   = document.getElementById('profile-advanced-stats');
    const attendCard    = document.getElementById('profile-attendance-card');
    const attendList    = document.getElementById('profile-attendance-list');

    document.getElementById('profile-name').innerText = player.name;
    const delBtn = document.getElementById('delete-player-btn');
    if (delBtn) delBtn.onclick = () => deletePlayer(playerId, player.name);

    showPage('player-profile-view');
    historyBox.innerHTML  = '<p class="muted-text" style="padding:10px 0;">Lade Matches…</p>';
    attendList.innerHTML  = '<p class="muted-text">Lade Termine…</p>';
    attendCard.style.display = 'none';

    // ── RESET ALL FOLD STATES ──
    ['fold-advanced', 'fold-chart', 'fold-history', 'fold-attendance'].forEach(id => {
        const body = document.getElementById(id);
        const icon = document.getElementById(id + '-icon');
        if (body) body.style.display = 'none';
        if (icon) icon.textContent = '▶';
    });
    const h2hSection = document.getElementById('fold-h2h-section');
    const h2hBody    = document.getElementById('fold-h2h');
    const h2hIcon    = document.getElementById('fold-h2h-icon');
    if (h2hSection) h2hSection.style.display = 'none';
    if (h2hBody)    h2hBody.style.display    = 'none';
    if (h2hIcon)    h2hIcon.textContent       = '▶';
    // Hide chart section wrapper until we know there's data
    const chartSection = document.getElementById('profile-chart-section');
    if (chartSection) chartSection.style.display = 'none';

    // ── FETCH ALL DATA IN PARALLEL ──
    const [histRes, userRes, tournRes] = await Promise.all([
        supa.from('game_history').select('*')
            .eq('player_id', playerId)
            .order('created_at', { ascending: false })
            .limit(10),
        supa.from('app_users').select('id')
            .eq('player_id', playerId)
            .maybeSingle(),
        // Fetch tournament participants where this player is winner or runner-up
        supa.from('tournament_participants').select('id, tournament_id')
            .eq('player_id', playerId)
    ]);

    const history = histRes.data || [];
    const partIds = (tournRes.data || []).map(p => p.id);

    // ── HEAD-TO-HEAD ──
    const loggedUser = window.loggedInUser || null;
    const loggedPid  = loggedUser?.player_id || null;
    let loggedPlayer = loggedPid ? players.find(p => p.id === loggedPid) : null;
    if (!loggedPlayer && loggedUser?.username) {
        loggedPlayer = players.find(p => p.name.toLowerCase() === loggedUser.username.toLowerCase());
    }

    if (loggedPlayer && loggedPlayer.id !== playerId) {
        // Fetch from each side — my rows for wins, their rows for avg
        const [myRes, theirRes] = await Promise.all([
            supa.from('game_history').select('is_win, avg_game')
                .eq('player_id', loggedPlayer.id)
                .eq('opponent_name', player.name),
            supa.from('game_history').select('avg_game')
                .eq('player_id', playerId)
                .eq('opponent_name', loggedPlayer.name)
        ]);

        const myGames    = myRes.data   || [];
        const theirGames = theirRes.data || [];
        const myWins     = myGames.filter(g => g.is_win).length;
        const theirWins  = myGames.length - myWins;
        const total      = myGames.length;

        const h2hBox     = document.getElementById('profile-h2h');
        const h2hSection = document.getElementById('fold-h2h-section');

        if (total > 0) {
            if (h2hSection) h2hSection.style.display = 'block';
            const myAvg    = myGames.length    > 0 ? (myGames.reduce((s,g)    => s + (g.avg_game||0), 0) / myGames.length).toFixed(2)    : '–';
            const theirAvg = theirGames.length > 0 ? (theirGames.reduce((s,g) => s + (g.avg_game||0), 0) / theirGames.length).toFixed(2) : '–';
            const myPct    = Math.round((myWins / total) * 100);
            const barColor = myWins > theirWins ? 'var(--green)' : myWins < theirWins ? 'var(--red)' : 'var(--accent)';
            h2hBox.innerHTML = `
<div class="h2h-matchup">
    <div class="h2h-side">
        <div class="h2h-player-name">${loggedPlayer.name}</div>
        <div class="h2h-wins" style="color:${myWins >= theirWins ? 'var(--green)' : 'var(--red)'};">${myWins}</div>
        <div class="h2h-avg-label">Ø ${myAvg}</div>
    </div>
    <div class="h2h-center">
        <div class="h2h-total">${total} Spiele</div>
        <div class="h2h-bar-wrap">
            <div class="h2h-bar-fill" style="width:${myPct}%; background:${barColor};"></div>
        </div>
        <div class="h2h-vs-label">VS</div>
    </div>
    <div class="h2h-side h2h-side--right">
        <div class="h2h-player-name">${player.name}</div>
        <div class="h2h-wins" style="color:${theirWins >= myWins ? 'var(--green)' : 'var(--red)'};">${theirWins}</div>
        <div class="h2h-avg-label">Ø ${theirAvg}</div>
    </div>
</div>`;
        }
    }

    // Fetch finished tournaments where this participant placed 1st or 2nd
    let tournWins   = 0;
    let tournSecond = 0;
    if (partIds.length > 0) {
        const { data: finishedT } = await supa
            .from('tournaments')
            .select('winner_id, runner_up_id')
            .eq('status', 'finished')
            .or(`winner_id.in.(${partIds.join(',')}),runner_up_id.in.(${partIds.join(',')})`);
        tournWins   = (finishedT || []).filter(t => partIds.includes(t.winner_id)).length;
        tournSecond = (finishedT || []).filter(t => partIds.includes(t.runner_up_id)).length;
    }

    // Store for re-use by filter
    openPlayerProfile._history    = history;
    openPlayerProfile._playerId   = playerId;
    openPlayerProfile._tournWins  = tournWins;
    openPlayerProfile._tournSec   = tournSecond;

    // ── ATTENDANCE ──
    const voteUserId = userRes.data ? userRes.data.id : playerId;

    const [votesRes, apptRes] = await Promise.all([
        supa.from('appointment_votes').select('appointment_id')
            .eq('user_id', voteUserId)
            .eq('vote', 'yes'),
        supa.from('appointments').select('*')
            .lt('date', new Date().toISOString())
            .order('date', { ascending: false })
            .limit(20)
    ]);

    const confirmedIds  = new Set((votesRes.data || []).map(v => v.appointment_id));
    const pastAppts     = apptRes.data || [];
    const attended      = pastAppts.filter(a => confirmedIds.has(a.id)).slice(0, 5);

    if (attended.length > 0) {
        const TYPE_COLORS = {
            Training:   { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'TRAINING' },
            Tournament: { bg: 'rgba(245,166,35,0.15)',  color: '#f5a623', label: 'TURNIER'  },
            Event:      { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7', label: 'EVENT'    }
        };
        attendCard.style.display = 'block';
        attendList.innerHTML = attended.map(a => {
            const ts   = TYPE_COLORS[a.type] || TYPE_COLORS.Event;
            const d    = new Date(a.date);
            const date = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
            const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            return `
<div class="attend-row">
    <span class="attend-type-badge" style="background:${ts.bg};color:${ts.color};">${ts.label}</span>
    <div class="attend-info">
        <div class="attend-title">${a.title}</div>
        ${a.place ? `<div class="attend-place">📍 ${a.place}</div>` : ''}
    </div>
    <div class="attend-date">
        <div class="attend-date-str">${date}</div>
        <div class="attend-time-str">${time} Uhr</div>
    </div>
</div>`;
        }).join('');
    } else {
        attendCard.style.display = 'block';
        attendList.innerHTML = '<p class="muted-text">Keine bestätigten Termine gefunden.</p>';
    }

    // ── GAME HISTORY ──
    if (histRes.error || history.length === 0) {
        summaryBox.innerHTML = '<p class="muted-text">Noch keine Statistiken.</p>';
        historyBox.innerHTML = '<p class="muted-text" style="padding:20px 0;">Keine Matches gefunden.</p>';
        return;
    }

    const totalGames  = history.length;
    const gamesWon    = history.filter(h => h.is_win === true).length;
    const winRate     = ((gamesWon / totalGames) * 100).toFixed(1);
    const total180s   = history.reduce((sum, h) => sum + (h.one_eighties || 0), 0);
    const total26s    = history.reduce((sum, h) => sum + (h.twenty_sixes || 0), 0);
    const lifetimeAvg = (history.reduce((sum, h) => sum + (h.avg_game || 0), 0) / totalGames).toFixed(2);

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

    // Render advanced stats (respects filter)
    renderAdvancedStats(null);

    historyBox.innerHTML = history.slice(0, 5).map(h => `
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
        <button class="match-delete-btn" onclick="deleteMatch('${h.id}', '${player.id}')" style="display:${(window.loggedInUser?.role === 'admin') ? 'inline-block' : 'none'};">Löschen</button>
    </div>
</div>`).join('');

    // ── PERFORMANCE CHART ──
    const chartBox = document.getElementById('profile-chart');
    if (!chartBox) return;

    const chartData = history.slice(0, 5).reverse();
    if (chartData.length < 2) {
        chartSection.style.display = 'none';
        return;
    }
    chartSection.style.display = 'block';

    const avgs   = chartData.map(h => parseFloat(h.avg_game) || 0);
    const labels = chartData.map((h, i) => 'G' + (i + 1));
    const minVal = Math.max(0, Math.floor(Math.min(...avgs) - 10));
    const maxVal = Math.ceil(Math.max(...avgs) + 10);
    const W = 500, H = 180, padL = 40, padR = 16, padT = 16, padB = 32;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const xPos = i => padL + (i / (avgs.length - 1)) * innerW;
    const yPos = v => padT + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;

    const points   = avgs.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ');
    const areaPath = `M${xPos(0)},${yPos(avgs[0])} ` +
        avgs.map((v, i) => `L${xPos(i)},${yPos(v)}`).join(' ') +
        ` L${xPos(avgs.length-1)},${padT + innerH} L${xPos(0)},${padT + innerH} Z`;

    const gridLines = [0, 0.25, 0.5, 0.75, 1].map(t => {
        const v = minVal + t * (maxVal - minVal);
        const y = yPos(v);
        return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#2e2e38" stroke-width="1"/>
                <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#55555f" font-size="10">${Math.round(v)}</text>`;
    }).join('');

    const xLabels = labels.map((lbl, i) =>
        `<text x="${xPos(i)}" y="${H - 6}" text-anchor="middle" fill="#55555f" font-size="11">${lbl}</text>`
    ).join('');

    const dots = avgs.map((v, i) => `
        <circle cx="${xPos(i)}" cy="${yPos(v)}" r="4" fill="#f5a623" stroke="#0d0d0f" stroke-width="2"/>
        <text x="${xPos(i)}" y="${yPos(v) - 10}" text-anchor="middle" fill="#f0f0f5" font-size="10" font-weight="bold">${v.toFixed(1)}</text>
    `).join('');

    chartBox.innerHTML = `
<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">
    <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#f5a623" stop-opacity="0.25"/>
            <stop offset="100%" stop-color="#f5a623" stop-opacity="0"/>
        </linearGradient>
    </defs>
    ${gridLines}
    ${xLabels}
    <path d="${areaPath}" fill="url(#areaGrad)"/>
    <polyline points="${points}" fill="none" stroke="#f5a623" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
</svg>`;
}

// ── ADVANCED STATS RENDERER (supports date filter) ──
function renderAdvancedStats(fromDate) {
    const advancedBox = document.getElementById('profile-advanced-stats');
    if (!advancedBox) return;

    const allHistory  = openPlayerProfile._history   || [];
    const tournWins   = openPlayerProfile._tournWins  || 0;
    const tournSecond = openPlayerProfile._tournSec   || 0;

    // Apply date filter
    const history = fromDate
        ? allHistory.filter(h => new Date(h.created_at) >= fromDate)
        : allHistory;

    if (history.length === 0) {
        advancedBox.innerHTML = '<p class="muted-text" style="padding:8px 0;">Keine Daten für diesen Zeitraum.</p>';
        return;
    }

    const totalGames        = history.length;
    const gamesWon          = history.filter(h => h.is_win === true).length;
    const gamesLost         = totalGames - gamesWon;
    const bestGameAvg       = Math.max(...history.map(h => h.avg_game || 0)).toFixed(2);
    const totalLegsWon      = history.reduce((sum, h) => sum + (h.legs_won   || 0), 0);
    const totalLegsLost     = history.reduce((sum, h) => sum + (h.legs_lost  || 0), 0);
    const avgTo170          = (history.reduce((sum, h) => sum + (h.avg_pre_170    || 0), 0) / totalGames).toFixed(2);
    const totalClosingDarts = history.reduce((sum, h) => sum + (h.closing_darts   || 0), 0);
    const avgVisitsToClose  = (totalClosingDarts / totalGames / 3).toFixed(1);
    const totalHighFinishes = history.reduce((sum, h) => sum + (h.high_finishes   || 0), 0);
    const highestFinish     = Math.max(0, ...history.map(h => h.highest_finish    || 0));

    advancedBox.innerHTML = `
<div class="adv-box"><div class="adv-label">Games (W / L)</div><div class="adv-value">${totalGames} &nbsp;<span style="color:var(--green)">${gamesWon}</span>/<span style="color:var(--red)">${gamesLost}</span></div></div>
<div class="adv-box"><div class="adv-label">Best Game Avg</div><div class="adv-value" style="color:var(--accent)">${bestGameAvg}</div></div>
<div class="adv-box"><div class="adv-label">Total Legs</div><div class="adv-value">${totalLegsWon + totalLegsLost}</div></div>
<div class="adv-box"><div class="adv-label">Legs (W / L)</div><div class="adv-value">${totalLegsWon} / ${totalLegsLost}</div></div>
<div class="adv-box"><div class="adv-label">Avg to 170</div><div class="adv-value">${avgTo170}</div></div>
<div class="adv-box"><div class="adv-label">Visits to Close</div><div class="adv-value">${avgVisitsToClose}</div></div>
<div class="adv-box"><div class="adv-label">High Finishes</div><div class="adv-value" style="color:var(--accent)">${totalHighFinishes}</div></div>
<div class="adv-box"><div class="adv-label">Highest Finish</div><div class="adv-value" style="color:var(--accent)">${highestFinish > 0 ? highestFinish : '–'}</div></div>
<div class="adv-box"><div class="adv-label">🏆 Turniersiege</div><div class="adv-value" style="color:#ffd700;">${tournWins}</div></div>
<div class="adv-box"><div class="adv-label">🥈 Turnierfinale</div><div class="adv-value" style="color:#c0c0c0;">${tournSecond}</div></div>`;
}