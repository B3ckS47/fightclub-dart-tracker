// ── ONLINE MODE (two devices, one throw each) ──
// Shared by game.html (sending/playing an invite) and index.html (discovering
// and accepting one). Polling-based, same philosophy as spectator.html/
// live_game — no Realtime/websockets needed for a game this slow-paced.

function _escHtmlOnline(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── SETUP SCREEN: sending an invite (game.html) ──
let _inviteId        = null;
let _invitePollTimer = null;

async function sendOnlineInvite() {
    const raw = fcGetUser();
    const me  = raw ? JSON.parse(raw) : null;
    if (!me || !me.player_id) { await showAlert('Kein Profil verknüpft', 'Dein Konto ist mit keinem Spieler-Profil verknüpft.'); return; }
    if (!selectedOnlineInviteeName) { await showAlert('Kein Mitglied ausgewählt', 'Bitte ein Mitglied zum Einladen auswählen.'); return; }

    const myPlayer      = players.find(p => p.id === me.player_id);
    const inviteePlayer = players.find(p => p.name === selectedOnlineInviteeName);
    if (!myPlayer || !inviteePlayer) { await showAlert('Fehler', 'Spielerprofil nicht gefunden.'); return; }

    const { data: inviteeUser, error: userErr } = await supa
        .from('app_users')
        .select('id')
        .eq('player_id', inviteePlayer.id)
        .single();
    if (userErr || !inviteeUser) { await showAlert('Fehler', `${selectedOnlineInviteeName} hat kein Benutzerkonto.`); return; }

    const startVal  = parseInt(document.getElementById('start-score-select').value);
    const legTarget = parseInt(document.getElementById('legs-to-win-select').value);
    const mode      = document.getElementById('checkout-mode-select').value;

    const { data: row, error } = await supa.from('online_games').insert([{
        inviter_user_id:   me.id,
        invitee_user_id:   inviteeUser.id,
        inviter_player_id: myPlayer.id,
        invitee_player_id: inviteePlayer.id,
        inviter_name:      myPlayer.name,
        invitee_name:      inviteePlayer.name,
        status:            'pending',
        start_score:       startVal,
        checkout_mode:     mode,
        target_legs:       legTarget
    }]).select('*').single();

    if (error || !row) { await showAlert('Fehler', 'Einladung konnte nicht gesendet werden.'); console.error(error); return; }

    _inviteId = row.id;
    showOnlineWaitingPanel(inviteePlayer.name);
    startInvitePolling(row.id);
}

function showOnlineWaitingPanel(inviteeName) {
    document.getElementById('online-invite-picker').style.display = 'none';
    document.getElementById('online-waiting-panel').style.display = 'block';
    document.getElementById('online-waiting-text').textContent = `Warte auf Antwort von ${inviteeName}…`;
    document.getElementById('start-game-btn').style.display = 'none';
}

function hideOnlineWaitingPanel() {
    const picker = document.getElementById('online-invite-picker');
    const panel  = document.getElementById('online-waiting-panel');
    const btn    = document.getElementById('start-game-btn');
    if (picker) picker.style.display = '';
    if (panel)  panel.style.display  = 'none';
    if (btn)    btn.style.display    = '';
}

function startInvitePolling(id) {
    _inviteId = id;
    stopInvitePolling();
    _invitePollTimer = setInterval(async () => {
        const { data } = await supa.from('online_games').select('*').eq('id', _inviteId).single();
        if (!data) return;

        if (data.status === 'active') {
            stopInvitePolling();
            hideOnlineWaitingPanel();
            const raw = fcGetUser();
            const me  = raw ? JSON.parse(raw) : null;
            await startOnlineGameFromRow(data, me);
        } else if (data.status === 'declined') {
            stopInvitePolling();
            hideOnlineWaitingPanel();
            await showAlert('Einladung abgelehnt', `${data.invitee_name} hat die Einladung abgelehnt.`);
        }
    }, 3000);
}

function stopInvitePolling() {
    if (_invitePollTimer) { clearInterval(_invitePollTimer); _invitePollTimer = null; }
}

async function cancelOnlineInvite() {
    stopInvitePolling();
    if (_inviteId) {
        try { await supa.from('online_games').update({ status: 'cancelled' }).eq('id', _inviteId).eq('status', 'pending'); }
        catch(e) { console.error('Cancel invite error:', e); }
    }
    _inviteId = null;
    hideOnlineWaitingPanel();
}

// ── ENTRY POINT: game.html?online_game_id=<id> ──
// Covers three cases with one code path: the invitee accepting for the first
// time (status 'pending'), the inviter's own tab noticing acceptance (handled
// via startInvitePolling above, not this function), and resuming an
// already-active game after a reload/crash (status 'active').
async function startOnlineGameFromUrl(onlineId) {
    const raw = fcGetUser();
    const me  = raw ? JSON.parse(raw) : null;
    if (!me) { window.location.href = 'index.html'; return; }

    const { data: row, error } = await supa.from('online_games').select('*').eq('id', onlineId).single();
    if (error || !row) {
        await showAlert('Einladung nicht gefunden', 'Diese Online-Einladung existiert nicht mehr.');
        window.location.href = 'index.html';
        return;
    }

    if (row.status === 'declined' || row.status === 'cancelled') {
        await showAlert('Einladung nicht mehr gültig', 'Diese Einladung wurde abgelehnt oder zurückgezogen.');
        window.location.href = 'index.html';
        return;
    }
    if (row.status === 'finished' || row.status === 'abandoned') {
        await showAlert('Spiel beendet', 'Dieses Online-Spiel ist bereits beendet.');
        window.location.href = 'index.html';
        return;
    }

    if (row.status === 'pending') {
        if (row.invitee_user_id !== me.id) { window.location.href = 'index.html'; return; }

        if (players.length === 0) { try { await fetchPlayers(); } catch(e) {} }

        // Bull Out is decided exactly once, right here, by the device that
        // transitions the invite to 'active' — both devices then just play
        // back the same reveal animation toward this predetermined result.
        const legStarter = Math.random() < 0.5 ? 0 : 1;
        const initialState = {
            gameType:      'singles',
            pNames:        [row.inviter_name, row.invitee_name],
            startScore:    row.start_score,
            scores:        [row.start_score, row.start_score],
            history:       [[], []],
            legScore:      [0, 0],
            targetLegs:    row.target_legs,
            legStarter:    legStarter,
            currentIdx:    legStarter,
            mode:          row.checkout_mode,
            teamPlayers:   [[row.inviter_name], [row.invitee_name]],
            teamPlayerIdx: [0, 0],
            stats:         [makePlayerStats(), makePlayerStats()],
            lastMove:      null
        };

        const { data: updated, error: updErr } = await supa.from('online_games')
            .update({ status: 'active', game_state: initialState, version: 1, responded_at: new Date().toISOString() })
            .eq('id', onlineId)
            .eq('status', 'pending') // optimistic lock — guards against a double-accept race
            .select('*')
            .single();

        if (updErr || !updated) {
            // Lost the race — reload the row and fall through to the 'active' handling below
            const { data: fresh } = await supa.from('online_games').select('*').eq('id', onlineId).single();
            if (!fresh) { window.location.href = 'index.html'; return; }
            await startOnlineGameFromRow(fresh, me);
            return;
        }
        await startOnlineGameFromRow(updated, me);
        return;
    }

    // status === 'active'
    await startOnlineGameFromRow(row, me);
}

// ── IN-GAME SYNC (polling) ──
let _onlinePollTimer = null;

function startOnlinePolling() {
    stopOnlinePolling();
    _onlinePollTimer = setInterval(pollOnlineGame, 3000);
}

function stopOnlinePolling() {
    if (_onlinePollTimer) { clearInterval(_onlinePollTimer); _onlinePollTimer = null; }
}

async function pollOnlineGame() {
    if (!gameState.onlineGameId) return;
    const { data } = await supa
        .from('online_games')
        .select('version,status,game_state')
        .eq('id', gameState.onlineGameId)
        .single();
    if (!data) return;

    if (data.status === 'abandoned' || data.status === 'cancelled') {
        stopOnlinePolling();
        gameState.onlineGameId = null; // already gone server-side — doExitGame() must not write to it again
        await showAlert('Spiel beendet', 'Dein Gegner hat das Spiel verlassen.');
        doExitGame();
        return;
    }
    if (data.status === 'finished') { stopOnlinePolling(); return; }
    if (data.version <= gameState.onlineAppliedVersion) return;

    const lastMove = data.game_state && data.game_state.lastMove;
    gameState.onlineAppliedVersion = data.version;
    if (!lastMove || lastMove.teamIdx === gameState.onlineMyTeamIdx) return; // my own move echoed back, or nothing to replay

    _applyingRemoteOnlineMove = true;
    try {
        gameState.currentIdx = lastMove.teamIdx;
        quickScore(lastMove.pts);
    } finally {
        _applyingRemoteOnlineMove = false;
    }
}

// Pushes only the last throw's delta — the receiving device replays it
// through the exact same quickScore()/submitTurn() pipeline, so bust
// detection, leg/match transitions and avatars all "just work" identically
// on both sides without any extra sync logic.
async function pushOnlineState(pts, teamIdx) {
    if (!gameState.onlineGameId) return;
    const snapshot = {
        gameType:      gameState.gameType,
        pNames:        gameState.pNames,
        startScore:    gameState.startScore,
        scores:        gameState.scores,
        history:       gameState.history,
        legScore:      gameState.legScore,
        targetLegs:    gameState.targetLegs,
        legStarter:    gameState.legStarter,
        currentIdx:    gameState.currentIdx,
        mode:          gameState.mode,
        teamPlayers:   gameState.teamPlayers,
        teamPlayerIdx: gameState.teamPlayerIdx,
        stats:         gameState.stats,
        lastMove:      { pts, teamIdx }
    };
    const nextVersion = gameState.onlineAppliedVersion + 1;
    try {
        const { data, error } = await supa.from('online_games')
            .update({ game_state: snapshot, version: nextVersion, updated_at: new Date().toISOString() })
            .eq('id', gameState.onlineGameId)
            .eq('version', gameState.onlineAppliedVersion) // optimistic lock
            .select('version')
            .single();
        if (error || !data) { console.warn('[Online] push conflict — next poll will reconcile'); return; }
        gameState.onlineAppliedVersion = nextVersion;
    } catch(e) { console.error('Online push error:', e); }
}

// ── STARTSEITE (index.html): discover invites + resume active games ──
async function loadPendingInvites() {
    const raw = fcGetUser();
    const me  = raw ? JSON.parse(raw) : null;
    if (!me) return;

    document.querySelectorAll('.online-invite-card').forEach(c => c.remove());

    const { data } = await supa.from('online_games')
        .select('id, inviter_name, created_at')
        .eq('invitee_user_id', me.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
    if (!data || data.length === 0) return;

    const wrapper   = document.querySelector('.menu-wrapper');
    const schedCard = document.getElementById('next-appt-card');
    if (!wrapper) return;

    data.forEach(row => {
        const card = document.createElement('div');
        card.className = 'next-appt-card online-invite-card';
        card.innerHTML = `
            <div class="next-appt-row">
                <div class="next-appt-left">
                    <span class="appt-type-badge" style="background:rgba(96,165,250,0.15); color:#60a5fa;">ONLINE</span>
                    <div class="next-appt-title">🎮 ${_escHtmlOnline(row.inviter_name)} lädt dich zu einem Spiel ein</div>
                </div>
                <div class="online-invite-actions">
                    <button type="button" class="btn btn-primary" data-action="accept">Annehmen</button>
                    <button type="button" class="btn" style="background:var(--bg-element); color:var(--red); border:1px solid var(--red);" data-action="decline">Ablehnen</button>
                </div>
            </div>`;
        card.querySelector('[data-action="accept"]').addEventListener('click', () => acceptOnlineInvite(row.id));
        card.querySelector('[data-action="decline"]').addEventListener('click', () => declineOnlineInvite(row.id, card));
        wrapper.insertBefore(card, schedCard);
    });
}

function acceptOnlineInvite(id) {
    window.location.href = `game.html?online_game_id=${encodeURIComponent(id)}`;
}

async function declineOnlineInvite(id, cardEl) {
    try {
        await supa.from('online_games')
            .update({ status: 'declined', responded_at: new Date().toISOString() })
            .eq('id', id).eq('status', 'pending');
    } catch(e) { console.error('Decline invite error:', e); }
    if (cardEl) cardEl.remove();
}

async function loadActiveOnlineGame() {
    const raw = fcGetUser();
    const me  = raw ? JSON.parse(raw) : null;
    if (!me) return;

    document.querySelectorAll('.online-resume-card').forEach(c => c.remove());

    const { data } = await supa.from('online_games')
        .select('id, inviter_user_id, invitee_user_id, inviter_name, invitee_name')
        .eq('status', 'active')
        .or(`inviter_user_id.eq.${me.id},invitee_user_id.eq.${me.id}`)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (!data || data.length === 0) return;

    const row           = data[0];
    const opponentName  = row.inviter_user_id === me.id ? row.invitee_name : row.inviter_name;
    const wrapper        = document.querySelector('.menu-wrapper');
    const schedCard      = document.getElementById('next-appt-card');
    if (!wrapper) return;

    const card = document.createElement('a');
    card.href      = `game.html?online_game_id=${encodeURIComponent(row.id)}`;
    card.className = 'next-appt-card live-game-card online-resume-card';
    card.innerHTML = `
        <div class="next-appt-row">
            <div class="live-teaser-left">
                <span class="live-teaser-badge">🌐 ONLINE</span>
                <div class="live-teaser-names">Laufendes Spiel gegen ${_escHtmlOnline(opponentName)}</div>
            </div>
            <div class="next-appt-arrow">»</div>
        </div>`;
    wrapper.insertBefore(card, schedCard);
}

// Best-effort housekeeping — old finished/declined/abandoned rows have no
// further use. No cron in this project, so this runs opportunistically
// whenever the Startseite loads instead.
async function cleanupOldOnlineGames() {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    try {
        await supa.from('online_games')
            .delete()
            .in('status', ['declined', 'cancelled', 'finished', 'abandoned'])
            .lt('updated_at', cutoff);
    } catch(e) { /* best-effort — ignore */ }
}
