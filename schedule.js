const supa = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_KEY);

const raw         = sessionStorage.getItem('fc47_user');
const currentUser = raw ? JSON.parse(raw) : null;

const TYPE_COLORS = {
    Training:   { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'TRAINING'  },
    Tournament: { bg: 'rgba(245,166,35,0.15)',  color: '#f5a623', label: 'TURNIER'   },
    Event:      { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7', label: 'EVENT'     },
    Gameday:    { bg: 'rgba(255,68,85,0.15)',   color: '#ff4455', label: 'SPIELTAG'  }
};

// Upcoming list: running appointments + the next one are open by default, then
// this many collapsed rows; "Weitere" adds MORE_STEP at a time.
const UPCOMING_COLLAPSED_SHOWN = 5;
const PAST_SHOWN               = 5;
const MORE_STEP                = 5;

let allPlayers = [];
let memberPlayerIds = new Set();
let avatarByPlayerId = {};
let userToPlayerId = {};
let _upcomingRaw = [];
let _pastRaw     = [];
let _allVotesRaw = [];
// null = not loaded yet. Only the archive's fines summary needs it, so it is
// fetched when the archive is first opened instead of on every page load.
let _allFinesRaw = null;
let _finesLoading = false;
let _scheduleFilter = '';

// UI state that must survive a re-render (e.g. after casting a vote)
const _apptOpen  = new Map();   // appointment id -> true/false; absent = default
const _namesOpen = new Set();   // "<id>-yes" / "<id>-no" name lists the user expanded
const _extraShown = { upcoming: 0, past: 0 };


function setScheduleFilter(type) {
    _scheduleFilter = type;
    _extraShown.upcoming = 0;
    _extraShown.past     = 0;
    renderFilterChips();
    renderAll();
}

// Filter bar above the lists — "ALLE" plus one chip per type (applies to the archive too)
function renderFilterChips() {
    const chip = (key, label, style, extra) => `
        <button type="button" class="appt-type-chip${extra || ''}${key === _scheduleFilter ? ' appt-type-chip--active' : ''}"
            ${style ? `style="${style}"` : ''} onclick="setScheduleFilter('${key}')">${label}</button>`;
    document.getElementById('schedule-filter').innerHTML =
        chip('', 'ALLE', '', ' appt-type-chip--all') +
        Object.entries(TYPE_COLORS).map(([key, t]) => chip(key, t.label, `--tb:${t.bg};--tc:${t.color};`)).join('');
}

function renderAll() {
    const matches = a => !_scheduleFilter || a.type === _scheduleFilter;
    renderAppointments(_upcomingRaw.filter(matches), _allVotesRaw, 'upcoming-list', false);
    renderAppointments(_pastRaw.filter(matches),     _allVotesRaw, 'past-list',     true);
}

document.addEventListener('DOMContentLoaded', () => {
    if (currentUser && currentUser.role === 'admin') {
        document.getElementById('admin-create-section').style.display = 'block';
        renderTypeChips();
        renderRepeatChips();
    }
    renderFilterChips();
    loadAppointments();
});

// ── NEW / EDIT APPOINTMENT SHEET ──
let _newApptType  = 'Training';
let _editApptId   = null;    // null = creating, otherwise the appointment being edited
let _repeatWeekly = false;
const REPEAT_MAX  = 52;

const pad2          = n => String(n).padStart(2, '0');
const localDateStr  = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localTimeStr  = iso => { const d = new Date(iso); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function renderRepeatChips() {
    const chip = (weekly, label) => `
        <button type="button" class="appt-type-chip${weekly === _repeatWeekly ? ' appt-type-chip--active' : ''}"
            onclick="setRepeat(${weekly})">${label}</button>`;
    document.getElementById('appt-repeat-chips').innerHTML = chip(false, 'EINMALIG') + chip(true, 'WÖCHENTLICH');
    document.getElementById('appt-repeat-count-wrap').style.display = _repeatWeekly ? 'block' : 'none';
    updateRepeatHint();
}

function setRepeat(weekly) {
    _repeatWeekly = weekly;
    renderRepeatChips();
}

// Dates of a weekly series, computed on the calendar (not +7*24h) so summer/winter time can't shift them
function seriesDates(dateVal, count) {
    const [y, m, d] = dateVal.split('-').map(Number);
    return Array.from({ length: count }, (_, i) => localDateStr(new Date(y, m - 1, d + 7 * i)));
}

function updateRepeatHint() {
    const hint = document.getElementById('appt-repeat-hint');
    if (!_repeatWeekly) { hint.textContent = ''; return; }
    const dateVal = document.getElementById('appt-date').value;
    const count   = parseInt(document.getElementById('appt-repeat-count').value, 10);
    if (!dateVal)                                  { hint.textContent = 'Bitte oben ein Datum für den ersten Termin wählen.'; return; }
    if (!(count >= 2 && count <= REPEAT_MAX))      { hint.textContent = `Anzahl zwischen 2 und ${REPEAT_MAX}.`; return; }
    const dates = seriesDates(dateVal, count);
    const fmt   = ds => new Date(ds + 'T12:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    hint.textContent = `${count} Termine: ${fmt(dates[0])} bis ${fmt(dates[count - 1])}`;
}

function renderTypeChips() {
    document.getElementById('appt-type-chips').innerHTML = Object.entries(TYPE_COLORS).map(([key, t]) => `
        <button type="button" class="appt-type-chip${key === _newApptType ? ' appt-type-chip--active' : ''}"
            style="--tb:${t.bg};--tc:${t.color};" onclick="selectApptType('${key}')">${t.label}</button>`).join('');
}

function selectApptType(type) {
    _newApptType = type;
    renderTypeChips();
}

// id given = edit that appointment (prefilled, no series), otherwise a blank new one
function openApptSheet(id) {
    const appt = id ? [..._upcomingRaw, ..._pastRaw].find(a => a.id === id) : null;
    _editApptId = appt ? appt.id : null;

    const set = (field, value) => { document.getElementById(field).value = value; };
    if (appt) {
        _newApptType = appt.type;
        set('appt-title',      appt.title);
        // Date-only appointments are stored as UTC midnight, timed ones as a real instant
        set('appt-date',       appt.start_time ? localDateStr(new Date(appt.start_time)) : appt.date.slice(0, 10));
        set('appt-start-time', appt.start_time ? localTimeStr(appt.start_time) : '');
        set('appt-end-time',   appt.end_time   ? localTimeStr(appt.end_time)   : '');
        set('appt-place',      appt.place || '');
    } else {
        _newApptType = 'Training';
        ['appt-title', 'appt-date', 'appt-start-time', 'appt-end-time', 'appt-place'].forEach(f => set(f, ''));
    }
    _repeatWeekly = false;
    document.getElementById('appt-sheet-title').textContent = appt ? 'TERMIN BEARBEITEN' : 'NEUER TERMIN';
    document.getElementById('appt-submit-btn').textContent  = appt ? 'SPEICHERN' : 'TERMIN ANLEGEN';
    document.getElementById('appt-repeat-wrap').style.display = appt ? 'none' : '';
    document.getElementById('schedule-msg').textContent = '';

    // Delete / end early live in the edit sheet
    document.getElementById('appt-edit-actions').style.display = appt ? 'block' : 'none';
    if (appt) {
        document.getElementById('appt-end-btn').style.display = getApptStatus(appt) === 'active' ? 'block' : 'none';
        document.getElementById('appt-edit-note').textContent = appt.fines_processed_at
            ? 'Dieser Termin ist beendet und abgerechnet. Änderungen wirken sich nicht mehr auf die Durchschnittsstrafe aus.'
            : '';
    }
    renderTypeChips();
    renderRepeatChips();

    openSheet('appt-sheet', 'appt-sheet-overlay');
    setTimeout(() => document.getElementById('appt-title').focus(), 350);
}

function closeApptSheet() {
    closeSheet('appt-sheet', 'appt-sheet-overlay');
}

// ── APPOINTMENT STATUS ──
// Returns 'upcoming' | 'active' | 'past'
function getApptStatus(appt) {
    const now     = new Date();
    const startAt = appt.start_time ? new Date(appt.start_time) : new Date(appt.date);
    // Without an end time an appointment would stay "running" forever, so it
    // ends with its calendar day.
    const endAt   = appt.end_time
        ? new Date(appt.end_time)
        : new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + 1);

    if (now >= endAt)   return 'past';
    if (now >= startAt) return 'active';
    return 'upcoming';
}

// ── LOAD ALL APPOINTMENTS ──
async function loadAppointments() {
    let votes;
    try {
        // Stable composite order: without one, page boundaries between range()
        // calls are not guaranteed and rows could be skipped or repeated.
        votes = await fetchAllRows(() =>
            supa.from('appointment_votes').select('*').order('appointment_id').order('user_id'));
    } catch (e) {
        console.error('Stimmen laden fehlgeschlagen:', e);
        document.getElementById('upcoming-list').innerHTML = '<p class="muted-text">Fehler beim Laden.</p>';
        return;
    }

    const [apptRes, playersRes, usersRes] = await Promise.all([
        supa.from('appointments').select('*').order('date', { ascending: true }),
        supa.from('players').select('id, name, avatar_url').order('name'),
        supa.from('app_users').select('id, player_id, role')
    ]);

    if (apptRes.error) {
        document.getElementById('upcoming-list').innerHTML = '<p class="muted-text">Fehler beim Laden.</p>';
        return;
    }

    allPlayers = playersRes.data || [];
    const allUsers  = usersRes.data || [];
    const linkedIds = allUsers.map(u => u.player_id).filter(Boolean);
    memberPlayerIds = new Set(linkedIds);

    avatarByPlayerId = {};
    allPlayers.forEach(p => { avatarByPlayerId[p.id] = p.avatar_url || null; });

    userToPlayerId = {};
    allUsers.forEach(u => { userToPlayerId[u.id] = u.player_id; });

    const all = apptRes.data || [];

    const upcoming = all.filter(a => getApptStatus(a) === 'upcoming');
    const active   = all.filter(a => getApptStatus(a) === 'active');
    const past     = all.filter(a => getApptStatus(a) === 'past').reverse();

    // Active pinned at top of upcoming section
    _upcomingRaw = [...active, ...upcoming];
    _pastRaw     = past;
    _allVotesRaw = votes;
    _allFinesRaw = null;

    renderAll();
    if (document.getElementById('past-section').style.display !== 'none') ensureFinesLoaded();
}

// The average fine for absentees is booked by the database (pg_cron job
// 'durchschnittsstrafe', see sql/durchschnittsstrafe.sql) FINE_GRACE_MIN minutes
// after an appointment ends. This window mirrors that function so the summary
// on the card shows the same total — keep both in sync.
const FINE_GRACE_MIN = 60;

function fineWindow(appt) {
    const start = new Date(appt.start_time || appt.date).getTime();
    const end   = new Date(appt.end_time).getTime();
    let nextStart = Infinity;
    [..._upcomingRaw, ..._pastRaw].forEach(o => {
        if (o.id === appt.id) return;
        const s = new Date(o.start_time || o.date).getTime();
        if (s > start && s < nextStart) nextStart = s;
    });
    return { start, end: Math.max(end, Math.min(end + FINE_GRACE_MIN * 60000, nextStart)) };
}

// Fines feeding the per-appointment summary in the archive.
// If this fails, show the archive without summaries rather than failing the page.
async function ensureFinesLoaded() {
    if (_allFinesRaw !== null || _finesLoading) return;
    _finesLoading = true;
    try {
        // The real per-session fines (not the system-generated "Durchschnitt"
        // catch-up fines) are matched against each appointment's time window.
        _allFinesRaw = await fetchAllRows(() =>
            supa.from('fines_ledger').select('amount, note, created_at')
                .eq('type', 'fine').not('reason', 'like', 'Bountyeinsatz%').order('id'));
    } catch (e) {
        console.error('Strafen-Zusammenfassung laden fehlgeschlagen:', e);
        _allFinesRaw = [];
    }
    _finesLoading = false;
    renderAll();
}

// ── VOTE AVATAR ──
function voteAvatarHtml(v, stacked) {
    const playerId = v.is_guest ? v.user_id : userToPlayerId[v.user_id];
    const url      = playerId ? avatarByPlayerId[playerId] : null;
    const initials = escHtml((v.username || '?').slice(0, 2).toUpperCase());
    const cls      = 'lb-avatar lb-avatar--sm' + (stacked ? ' lb-avatar--stacked' : '');
    return url
        ? `<span class="${cls}"><img src="${escHtml(url)}" alt=""></span>`
        : `<span class="${cls}">${initials}</span>`;
}

const VOTE_STACK_MAX = 10;

function voteAvatarStackHtml(votes) {
    if (votes.length === 0) return '';
    const shown = votes.slice(0, VOTE_STACK_MAX).map(v => voteAvatarHtml(v, true)).join('');
    const rest  = votes.length - VOTE_STACK_MAX;
    return shown + (rest > 0 ? `<span class="vote-avatar-more">+${rest}</span>` : '');
}

// ── TOGGLE VOTE NAME LIST ──
function toggleVoteNames(key) {
    const el   = document.getElementById(`vote-names-${key}`);
    const icon = document.getElementById(`vote-toggle-${key}`);
    if (!el) return;
    const collapsed = el.classList.toggle('vote-names--collapsed');
    if (collapsed) _namesOpen.delete(key); else _namesOpen.add(key);
    if (icon) icon.textContent = collapsed ? '▶' : '▼';
}

// ── TOGGLE APPOINTMENT CARD ──
function toggleAppt(id) {
    const card = document.getElementById(`appt-${id}`);
    if (!card) return;
    const open = card.classList.toggle('appt-card--open');
    _apptOpen.set(id, open);
}

function showMoreAppointments(kind) {
    _extraShown[kind] += MORE_STEP;
    renderAll();
}

// ── DATE / TIME LABELS ──
function fmtClock(iso) {
    return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// "Di 03.11." (year only when it is not the current one)
function fmtShortDay(appt) {
    const d   = new Date(appt.start_time || appt.date);
    let   day = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
        .replace(/^(\S+?)\.?,\s*/, '$1 ');
    if (d.getFullYear() !== new Date().getFullYear()) day += d.getFullYear();
    return day;
}

// ── RENDER APPOINTMENT CARDS ──
function renderAppointments(appointments, allVotes, containerId, isPast) {
    const container = document.getElementById(containerId);

    if (appointments.length === 0) {
        container.innerHTML = `<p class="muted-text">${isPast ? 'Keine vergangenen Termine.' : 'Keine bevorstehenden Termine.'}</p>`;
        return;
    }

    // Open by default: everything that is running plus the next upcoming one
    const defaultOpen = new Set();
    if (!isPast) {
        appointments.forEach(a => { if (getApptStatus(a) === 'active') defaultOpen.add(a.id); });
        const next = appointments.find(a => getApptStatus(a) === 'upcoming');
        if (next) defaultOpen.add(next.id);
    }

    const kind    = isPast ? 'past' : 'upcoming';
    const limit   = (isPast ? PAST_SHOWN : defaultOpen.size + UPCOMING_COLLAPSED_SHOWN) + _extraShown[kind];
    const visible = appointments.slice(0, limit);
    const rest    = appointments.length - visible.length;

    container.innerHTML = visible.map(appt => {
        const isOpen = _apptOpen.has(appt.id) ? _apptOpen.get(appt.id) : defaultOpen.has(appt.id);
        return appointmentCardHtml(appt, allVotes, isPast, isOpen);
    }).join('') + (rest > 0
        ? `<button class="appt-more-btn" onclick="showMoreAppointments('${kind}')">Weitere Termine anzeigen (${rest})</button>`
        : '');
}

function appointmentCardHtml(appt, allVotes, isPast, isOpen) {
    const votes     = allVotes.filter(v => v.appointment_id === appt.id);
    const attending = votes.filter(v => v.vote === 'yes');
    const declining = votes.filter(v => v.vote === 'no');
    const myVote    = currentUser ? votes.find(v => v.user_id === currentUser.id) : null;
    const typeStyle = TYPE_COLORS[appt.type] || TYPE_COLORS.Event;

    const apptStatus   = getApptStatus(appt);
    const isActive     = apptStatus === 'active';
    const isVoteLocked = isActive || isPast;
    const canVote      = !isVoteLocked && currentUser && (currentUser.role === 'admin' || currentUser.role === 'member');

    // Day and start time are already in the collapsed row — the expanded card
    // only adds what the row doesn't show: the end time (and place, below)
    const endStr = appt.end_time ? fmtClock(appt.end_time) : '';

    const activeBadge = isActive ? `<span class="appt-active-badge">● LÄUFT</span>` : '';

    // Marker for "my" vote in the collapsed row — voting is mandatory, so an
    // open one has to be visible without expanding the card.
    let meMarker = '';
    if (!isPast && currentUser && (currentUser.role === 'admin' || currentUser.role === 'member')) {
        if (myVote)          meMarker = `<span class="appt-me appt-me--${myVote.vote}" title="Deine Antwort">${myVote.vote === 'yes' ? '✓' : '✗'}</span>`;
        else if (canVote)    meMarker = `<span class="appt-me appt-me--open" title="Noch nicht abgestimmt">?</span>`;
        else                 meMarker = `<span class="appt-me appt-me--none"></span>`;
    }
    const needsVote = canVote && !myVote;

    // Fines summary for past Training appointments
    let finesSummary = '';
    if (isPast && appt.type === 'Training' && appt.end_time && _allFinesRaw) {
        // Fines logged during the session (same window the database job uses),
        // not the "Durchschnitt" catch-up fines charged to absentees (note 'appt:…').
        const win       = fineWindow(appt);
        const apptFines = _allFinesRaw.filter(f => {
            if ((f.note || '').startsWith('appt:')) return false;
            const t = new Date(f.created_at).getTime();
            return t >= win.start && t <= win.end;
        });
        const totalFines   = apptFines.reduce((s, f) => s + parseFloat(f.amount), 0);
        // Only count members/admins (non-guests) — consistent with who gets the avg fine
        const memberAttendeeCount = attending.filter(v => !v.is_guest).length;
        const avgFine      = memberAttendeeCount > 0 ? (totalFines / memberAttendeeCount) : 0;
        if (totalFines > 0) {
            finesSummary = `
            <div class="appt-fines-summary">
                <span class="appt-fines-item">💸 Gesamt <strong>${totalFines.toFixed(2)} €</strong></span>
                <span class="appt-fines-divider">·</span>
                <span class="appt-fines-item">Ø pro Kopf <strong>${avgFine.toFixed(2)} €</strong></span>
            </div>`;
        }
    }

    // Until the database job has run, tell when the average fine will be booked
    // (fines_processed_at exists once sql/durchschnittsstrafe.sql was applied)
    if (isPast && appt.type === 'Training' && appt.end_time && 'fines_processed_at' in appt && !appt.fines_processed_at) {
        const at = fmtClock(new Date(new Date(appt.end_time).getTime() + FINE_GRACE_MIN * 60000).toISOString());
        finesSummary += `<div class="appt-vote-locked">⏳ Durchschnittsstrafe für Abwesende folgt kurz nach ${at} Uhr</div>`;
    }

    // One vote column (yes / no) with its avatar stack and expandable name list
    const voteColumn = (kind, list, icon) => {
        const key       = `${appt.id}-${kind}`;
        const namesOpen = _namesOpen.has(key);
        return `
        <div class="vote-col vote-col--${kind}">
            <div class="vote-col-header"${list.length > 0 ? ` onclick="toggleVoteNames('${key}')" style="cursor:pointer;"` : ''}>
                <span class="vote-icon">${icon}</span>
                <span class="vote-count vote-count--${kind}">${list.length}</span>
                ${list.length > 0 ? `<span class="vote-toggle-icon" id="vote-toggle-${key}">${namesOpen ? '▼' : '▶'}</span>` : ''}
            </div>
            ${list.length > 0 ? `
            <div class="vote-avatar-stack" onclick="toggleVoteNames('${key}')">
                ${voteAvatarStackHtml(list)}
            </div>
            <div class="vote-names vote-names--col${namesOpen ? '' : ' vote-names--collapsed'}" id="vote-names-${key}">
                ${list.map(v => `
                    <span class="vote-name vote-name--${kind}${v.is_guest ? ' vote-name--guest' : ''}">
                        <span class="vote-name-main">
                            ${voteAvatarHtml(v)}
                            <span class="vote-name-text">${v.is_guest ? '👤 ' : ''}${escHtml(v.username)}</span>
                        </span>${kind === 'yes' && canVote && v.is_guest
                            ? `<button class="vote-guest-remove" onclick="removeGuestVote('${appt.id}', '${v.user_id}')" title="Entfernen">×</button>`
                            : ''
                        }
                    </span>`).join('')}
            </div>` : '<span class="vote-none">–</span>'}
        </div>`;
    };

    return `
<div class="appt-card ${isPast ? 'appt-card--past' : ''} ${isActive ? 'appt-card--active' : ''} ${isOpen ? 'appt-card--open' : ''} ${needsVote ? 'appt-card--unvoted' : ''}" id="appt-${appt.id}">
    <div class="appt-row" onclick="toggleAppt('${appt.id}')">
        <span class="appt-row-main">
            <span class="appt-row-type" style="--tb:${typeStyle.bg};--tc:${typeStyle.color};"><span class="appt-row-type-label">${typeStyle.label}</span></span>
            <span class="appt-row-title">${escHtml(appt.title)}</span>
        </span>
        <span class="appt-row-meta">
            <span class="appt-row-when">
                <span class="appt-row-day">${fmtShortDay(appt)}</span>
                ${appt.start_time ? `<span class="appt-row-time">${fmtClock(appt.start_time)}</span>` : ''}
            </span>
            <span class="appt-row-counts">
                <span class="appt-row-count appt-row-count--yes">✅ ${attending.length}</span>
                <span class="appt-row-count appt-row-count--no">❌ ${declining.length}</span>
            </span>
            ${meMarker}
            <span class="appt-chevron">▶</span>
        </span>
    </div>

    <div class="appt-body">
        <div class="appt-info">
            <span class="appt-info-left">
                <span class="appt-type-badge" style="background:${typeStyle.bg};color:${typeStyle.color};">${typeStyle.label}</span>
                ${activeBadge}
            </span>
            <span class="appt-info-right">
                ${endStr ? `<span>bis ${endStr} Uhr</span>` : ''}
                ${appt.place ? `<span>📍 ${escHtml(appt.place)}</span>` : ''}
            </span>
        </div>

        <div class="appt-votes">
            ${voteColumn('yes', attending, '✅')}
            ${voteColumn('no',  declining, '❌')}
        </div>

        ${canVote ? `
        <div class="appt-actions">
            <button onclick="castVote('${appt.id}', 'yes')"
                class="btn-vote btn-vote--yes ${myVote && myVote.vote === 'yes' ? 'btn-vote--active' : ''}">
                ✅ Zusage
            </button>
            <button onclick="castVote('${appt.id}', 'no')"
                class="btn-vote btn-vote--no ${myVote && myVote.vote === 'no' ? 'btn-vote--active-no' : ''}">
                ❌ Absage
            </button>
        </div>
        <button class="appt-wide-btn" onclick="openGuestSheet('${appt.id}')">＋ GAST HINZUFÜGEN</button>` : isVoteLocked && !isPast ? `
        <div class="appt-vote-locked">🔒 Abstimmung geschlossen – Termin läuft</div>` : ''}

        ${finesSummary}

        ${currentUser && currentUser.role === 'admin'
            ? `<button class="appt-wide-btn" onclick="openApptSheet('${appt.id}')">BEARBEITEN</button>`
            : ''}
    </div>
</div>`;
}

// ── LOCAL VOTE STATE ──
// A vote only changes one row; patching the local list is instant and avoids
// re-downloading every vote ever cast.
function setLocalVote(row) {
    _allVotesRaw = _allVotesRaw.filter(v => !(v.appointment_id === row.appointment_id && v.user_id === row.user_id));
    _allVotesRaw.push(row);
    renderAll();
}

// ── CAST VOTE ──
async function castVote(appointmentId, vote) {
    if (!currentUser) return;
    const row = {
        appointment_id: appointmentId,
        user_id:        currentUser.id,
        username:       currentUser.username,
        vote:           vote,
        is_guest:       false
    };
    const { error } = await supa.from('appointment_votes').upsert(row, { onConflict: 'appointment_id,user_id' });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    setLocalVote(row);
}

// ── GUEST SHEET: add one or more guests to an appointment ──
let _guestApptId = null;
const _guestSel  = new Set();

// Non-member players not yet entered as a guest for this appointment
function availableGuestsFor(apptId) {
    const taken = new Set(_allVotesRaw.filter(v => v.appointment_id === apptId && v.is_guest).map(v => v.user_id));
    return allPlayers.filter(p => !memberPlayerIds.has(p.id) && !taken.has(p.id));
}

function openGuestSheet(apptId) {
    const appt = [..._upcomingRaw, ..._pastRaw].find(a => a.id === apptId);
    if (!appt) return;
    _guestApptId = apptId;
    _guestSel.clear();
    document.getElementById('guest-search').value = '';
    document.getElementById('guest-sheet-sub').textContent = `${appt.title} · ${fmtShortDay(appt)}`;
    renderGuestList();
    openSheet('guest-sheet', 'guest-sheet-overlay');
}

function closeGuestSheet() {
    closeSheet('guest-sheet', 'guest-sheet-overlay');
}

function renderGuestList() {
    const all     = availableGuestsFor(_guestApptId);
    const query   = document.getElementById('guest-search').value.trim().toLowerCase();
    const guests  = query ? all.filter(g => g.name.toLowerCase().includes(query)) : all;
    document.getElementById('guest-sheet-list').innerHTML = guests.length === 0
        ? `<p class="muted-text" style="text-align:center; padding:12px 0;">${all.length === 0 ? 'Alle bekannten Gäste sind bereits eingetragen.' : 'Kein Gast gefunden.'}</p>`
        : guests.map(g => `
            <button type="button" class="guest-pick${_guestSel.has(g.id) ? ' guest-pick--on' : ''}" onclick="toggleGuestPick('${g.id}')">
                ${voteAvatarHtml({ is_guest: true, user_id: g.id, username: g.name })}
                <span class="guest-pick-name">${escHtml(g.name)}</span>
                <span class="guest-pick-check">${_guestSel.has(g.id) ? '✓' : ''}</span>
            </button>`).join('');

    const n   = _guestSel.size;
    const btn = document.getElementById('guest-submit-btn');
    btn.disabled    = n === 0;
    btn.textContent = n === 0 ? 'GAST AUSWÄHLEN' : n === 1 ? '1 GAST HINZUFÜGEN' : `${n} GÄSTE HINZUFÜGEN`;
}

function toggleGuestPick(id) {
    if (_guestSel.has(id)) _guestSel.delete(id); else _guestSel.add(id);
    renderGuestList();
}

async function submitGuests() {
    if (!currentUser || _guestSel.size === 0) return;
    const rows = [..._guestSel].map(id => {
        const g = allPlayers.find(p => p.id === id);
        return { appointment_id: _guestApptId, user_id: id, username: g ? g.name : '?', vote: 'yes', is_guest: true };
    });
    const { error } = await supa.from('appointment_votes').upsert(rows, { onConflict: 'appointment_id,user_id' });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

    _allVotesRaw = _allVotesRaw.filter(v => !(v.appointment_id === _guestApptId && rows.some(r => r.user_id === v.user_id)));
    _allVotesRaw.push(...rows);
    closeGuestSheet();
    renderAll();
    showToast(rows.length === 1 ? 'Gast hinzugefügt.' : `${rows.length} Gäste hinzugefügt.`, 'success');
}

// ── REMOVE GUEST VOTE ──
async function removeGuestVote(appointmentId, guestId) {
    if (!currentUser) return;
    const { error } = await supa
        .from('appointment_votes')
        .delete()
        .eq('appointment_id', appointmentId)
        .eq('user_id', guestId);
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    _allVotesRaw = _allVotesRaw.filter(v => !(v.appointment_id === appointmentId && v.user_id === guestId));
    renderAll();
}

// ── CREATE / UPDATE APPOINTMENT ──
async function saveAppointment() {
    const title     = document.getElementById('appt-title').value.trim();
    const type      = _newApptType;
    const dateVal   = document.getElementById('appt-date').value;
    const startTime = document.getElementById('appt-start-time').value;
    const endTime   = document.getElementById('appt-end-time').value;
    const place     = document.getElementById('appt-place').value.trim();
    const msgEl     = document.getElementById('schedule-msg');

    const fail = text => {
        msgEl.textContent = text;
        msgEl.style.color = 'var(--red)';
        setTimeout(() => msgEl.textContent = '', 3000);
    };

    if (!title || !dateVal) return fail('Bitte Bezeichnung und Datum angeben.');
    if (endTime && !startTime) return fail('Bitte Startzeit angeben, wenn eine Endzeit gesetzt ist.');
    if (endTime && endTime <= startTime) return fail('Die Endzeit muss nach der Startzeit liegen.');

    // The time columns of one appointment on a given day (YYYY-MM-DD)
    const fieldsFor = ds => {
        const startISO = startTime ? new Date(`${ds}T${startTime}`).toISOString() : null;
        const endISO   = endTime   ? new Date(`${ds}T${endTime}`).toISOString()   : null;
        return {
            title,
            type,
            date:       startISO || new Date(ds).toISOString(),
            start_time: startISO,
            end_time:   endISO,
            place:      place || null
        };
    };

    if (_editApptId) {
        const { error } = await supa.from('appointments').update(fieldsFor(dateVal)).eq('id', _editApptId);
        if (error) return fail('Fehler: ' + error.message);
        closeApptSheet();
        showToast('Termin gespeichert.', 'success');
        loadAppointments();
        return;
    }

    let count = 1;
    if (_repeatWeekly) {
        count = parseInt(document.getElementById('appt-repeat-count').value, 10);
        if (!(count >= 2 && count <= REPEAT_MAX)) return fail(`Anzahl der Termine: 2 bis ${REPEAT_MAX}.`);
    }

    const rows = seriesDates(dateVal, count).map(ds => ({
        ...fieldsFor(ds),
        status:     'upcoming',
        created_by: currentUser.username
    }));
    const { error } = await supa.from('appointments').insert(rows);
    if (error) return fail('Fehler: ' + error.message);

    closeApptSheet();
    showToast(count > 1 ? `${count} Termine angelegt.` : 'Termin wurde hinzugefügt.', 'success');
    loadAppointments();
}

// ── END APPOINTMENT EARLY (admin only) ──
async function endAppointmentNow(id) {
    const ok = await showConfirm('Termin beenden', `Diesen Termin jetzt frühzeitig beenden? Die Durchschnittsstrafe für Abwesende wird ${FINE_GRACE_MIN} Minuten nach dem Ende berechnet.`);
    if (!ok) return;

    const { error } = await supa.from('appointments')
        .update({ end_time: new Date().toISOString() })
        .eq('id', id);

    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

    closeApptSheet();
    showToast('Termin beendet.', 'success');
    loadAppointments();
}

// ── DELETE APPOINTMENT ──
async function deleteAppointment(id) {
    const ok = await showConfirm('Termin löschen', 'Diesen Termin wirklich löschen?');
    if (!ok) return;
    const { error } = await supa.from('appointments').delete().eq('id', id);
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    closeApptSheet();
    showToast('Termin gelöscht.', 'success');
    loadAppointments();
}

// ── TOGGLE PAST SECTION ──
function togglePast() {
    const section = document.getElementById('past-section');
    const icon    = document.getElementById('past-toggle-icon');
    const isOpen  = section.style.display !== 'none';
    section.style.display = isOpen ? 'none' : 'block';
    icon.textContent = isOpen ? '▼' : '▲';
    if (!isOpen) ensureFinesLoaded();
}
