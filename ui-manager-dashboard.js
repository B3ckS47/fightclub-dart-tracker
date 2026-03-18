// ── DASHBOARD PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function updateDropdowns() { /* dashboard does not use dropdowns */ }
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

    const summaryBox  = document.getElementById('profile-stats-summary');
    const historyBox  = document.getElementById('profile-history-list');
    const advancedBox = document.getElementById('profile-advanced-stats');

    document.getElementById('profile-name').innerText = player.name;
    const delBtn = document.getElementById('delete-player-btn');
    if (delBtn) delBtn.onclick = () => deletePlayer(playerId, player.name);

    showPage('player-profile-view');
    historyBox.innerHTML = '<p class="muted-text" style="padding:10px 0;">Lade Matches…</p>';

    const { data: history, error } = await supa
        .from('game_history').select('*')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error || !history || history.length === 0) {
        summaryBox.innerHTML = '<p class="muted-text">Noch keine Statistiken.</p>';
        historyBox.innerHTML = '<p class="muted-text" style="padding:20px 0;">Keine Matches gefunden.</p>';
        return;
    }

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
    const totalClosingDarts = history.reduce((sum, h) => sum + (h.closing_darts || 0), 0);
    const avgVisitsToClose  = (totalClosingDarts / totalGames / 3).toFixed(1);

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

    advancedBox.innerHTML = `
<div class="adv-box"><div class="adv-label">Games (W / L)</div><div class="adv-value">${totalGames} &nbsp;<span style="color:var(--green)">${gamesWon}</span>/<span style="color:var(--red)">${gamesLost}</span></div></div>
<div class="adv-box"><div class="adv-label">Best Game Avg</div><div class="adv-value" style="color:var(--accent)">${bestGameAvg}</div></div>
<div class="adv-box"><div class="adv-label">Total Legs</div><div class="adv-value">${totalLegsPlayed}</div></div>
<div class="adv-box"><div class="adv-label">Legs (W / L)</div><div class="adv-value">${totalLegsWon} / ${totalLegsLost}</div></div>
<div class="adv-box"><div class="adv-label">Avg to 170</div><div class="adv-value">${avgTo170}</div></div>
<div class="adv-box"><div class="adv-label">Visits to Close</div><div class="adv-value">${avgVisitsToClose}</div></div>`;

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