// ── DASHBOARD PAGE UI MANAGER ──

window.addEventListener('DOMContentLoaded', () => {
    fetchPlayers();
});

function updateDropdowns() {} // Not needed on dashboard
let _activePlayerTab = 'members';

function setPlayerTab(tab) {
    _activePlayerTab = tab;
    document.getElementById('tab-members').classList.toggle('player-tab--active', tab === 'members');
    document.getElementById('tab-guests').classList.toggle('player-tab--active',  tab === 'guests');
    updateStatsUI();
}

function updateStatsUI() {
    const box = document.getElementById('player-list-box');
    if (!box) return;

    if (players.length === 0) {
        box.innerHTML = '<p class="muted-text">Noch keine Mitglieder vorhanden.</p>';
        return;
    }

    const members = players.filter(p => p.isMember);
    const guests  = players.filter(p => !p.isMember);
    const list    = _activePlayerTab === 'guests' ? guests : members;

    // Update tab counters
    const tabM = document.getElementById('tab-members');
    const tabG = document.getElementById('tab-guests');
    if (tabM) tabM.textContent = `Mitglieder (${members.length})`;
    if (tabG) tabG.textContent = `Gäste (${guests.length})`;

    if (list.length === 0) {
        box.innerHTML = `<p class="muted-text">Keine ${_activePlayerTab === 'guests' ? 'Gäste' : 'Mitglieder'} vorhanden.</p>`;
        return;
    }

    box.innerHTML = list.map((p, index) => {
        const rank        = index + 1;
        const medalClass  = rank === 1 ? 'lb-avatar--gold' : rank === 2 ? 'lb-avatar--silver' : rank === 3 ? 'lb-avatar--bronze' : '';
        const badgeBg      = rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : 'var(--border-light)';
        const badgeColor  = rank <= 3 ? '#000' : 'var(--text-primary)';
        const initials    = (p.name || '?').slice(0, 2).toUpperCase();
        const avatarInner = p.avatar_url
            ? `<img src="${p.avatar_url}" alt="">`
            : `<span>${initials}</span>`;
        return `
<div class="lb-row" onclick="window.location.href='player-profile.html?id=${p.id}'">
    <div class="lb-avatar-wrap">
        <div class="lb-avatar ${medalClass}">${avatarInner}</div>
        <div class="lb-rank-badge" style="background:${badgeBg}; color:${badgeColor};">${rank}</div>
    </div>
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
