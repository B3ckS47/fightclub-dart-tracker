const SUPABASE_URL = 'https://daejfzypbnwtucwftkzn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xajv6XFl28cNrdMSohDhjg_aDyMT3Bl';
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const raw         = sessionStorage.getItem('fc47_user');
const currentUser = raw ? JSON.parse(raw) : null;

const TYPE_COLORS = {
    Training:   { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa', label: 'TRAINING'  },
    Tournament: { bg: 'rgba(245,166,35,0.15)',  color: '#f5a623', label: 'TURNIER'   },
    Event:      { bg: 'rgba(168,85,247,0.15)',  color: '#a855f7', label: 'EVENT'     },
    Gameday:    { bg: 'rgba(255,68,85,0.15)',   color: '#ff4455', label: 'SPIELTAG'  }
};

let allPlayers = [];
let memberPlayerIds = new Set();
let _upcomingRaw = [];
let _pastRaw     = [];
let _allVotesRaw = [];
let _scheduleFilter = '';

function setScheduleFilter(type) {
    _scheduleFilter = type;
    const filtered  = _upcomingRaw.filter(a => !type || a.type === type);
    const filteredP = _pastRaw.filter(a => !type || a.type === type);
    renderAppointments(filtered,  _allVotesRaw, 'upcoming-list', false);
    renderAppointments(filteredP, _allVotesRaw, 'past-list',     true);
}

document.addEventListener('DOMContentLoaded', () => {
    if (currentUser && currentUser.role === 'admin') {
        document.getElementById('admin-create-section').style.display = 'block';
    }
    loadAppointments();
});

// ── ABSENCE FINE CONSTANTS ──
const ABSENCE_FINES = {
    Training: { id: 'b9c3c0aa-fc23-4106-b6b5-574bcd098450', name: 'Nicht An- oder Abmelden: Training', amount: 5.00  },
    Gameday:  { id: 'ce73932c-fbc0-4edc-b5fc-ea3327124d77', name: 'Nicht An- oder Abmelden: Spiel',    amount: 20.00 }
};

// ── APPOINTMENT STATUS ──
// Returns 'upcoming' | 'active' | 'past'
function getApptStatus(appt) {
    const now     = new Date();
    const startAt = appt.start_time ? new Date(appt.start_time) : new Date(appt.date);
    const endAt   = appt.end_time   ? new Date(appt.end_time)   : null;

    if (endAt && now >= endAt) return 'past';
    if (now >= startAt)        return 'active';
    return 'upcoming';
}

// ── LOAD ALL APPOINTMENTS ──
async function loadAppointments() {
    const [apptRes, votesRes, playersRes, usersRes] = await Promise.all([
        supa.from('appointments').select('*').order('date', { ascending: true }),
        supa.from('appointment_votes').select('*'),
        supa.from('players').select('id, name').order('name'),
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

    const allVotes = votesRes.data || [];
    const all      = apptRes.data || [];

    const upcoming = all.filter(a => getApptStatus(a) === 'upcoming');
    const active   = all.filter(a => getApptStatus(a) === 'active');
    const past     = all.filter(a => getApptStatus(a) === 'past').reverse();

    // Active pinned at top of upcoming section
    const upcomingSection = [...active, ...upcoming];

    _upcomingRaw = upcomingSection;
    _pastRaw     = past;
    _allVotesRaw = allVotes;

    renderAppointments(upcomingSection, allVotes, 'upcoming-list', false);
    renderAppointments(past,            allVotes, 'past-list',     true);

    await handleStatusTransitions(all, allVotes, allUsers);
    await checkAbsenceFines(past, allVotes, allUsers);
}

// ── STATUS TRANSITIONS & AVERAGE FINE ──
async function handleStatusTransitions(all, allVotes, allUsers) {
    for (const appt of all) {
        const computed = getApptStatus(appt);

        if (computed === 'active' && appt.status !== 'active') {
            await supa.from('appointments')
                .update({ status: 'active' })
                .eq('id', appt.id);
        }

        if (computed === 'past' && appt.status !== 'past') {
            await supa.from('appointments')
                .update({ status: 'past' })
                .eq('id', appt.id);

            await applyAverageFine(appt, allVotes, allUsers);
        }
    }
}

// ── AVERAGE FINE ──
async function applyAverageFine(appt, allVotes, allUsers) {
    if (!appt.end_time) return;

    // Fines created during the appointment window
    const { data: finesDuring } = await supa
        .from('fines_ledger')
        .select('amount')
        .eq('type', 'fine')
        .gte('created_at', appt.start_time || appt.date)
        .lte('created_at', appt.end_time)
        .neq('reason', `Durchschnitt ${appt.title}`);

    if (!finesDuring || finesDuring.length === 0) return;

    const totalFines = finesDuring.reduce((s, r) => s + parseFloat(r.amount), 0);

    const apptVotes     = allVotes.filter(v => v.appointment_id === appt.id);
    const attendeeIds   = new Set(apptVotes.filter(v => v.vote === 'yes').map(v => v.user_id));
    const attendeeCount = attendeeIds.size;
    if (attendeeCount === 0) return;

    const avgFine = Math.round((totalFines / attendeeCount) * 100) / 100;
    if (avgFine <= 0) return;

    const eligibleUsers = allUsers.filter(u =>
        (u.role === 'member' || u.role === 'admin') && u.player_id
    );
    const absentUsers = eligibleUsers.filter(u => !attendeeIds.has(u.id));
    if (absentUsers.length === 0) return;

    const reasonName = `Durchschnitt ${appt.title}`;

    const { data: existing } = await supa
        .from('fines_ledger')
        .select('player_id')
        .eq('reason', reasonName)
        .eq('note', `appt:${appt.id}`);

    const alreadyFined = new Set((existing || []).map(r => r.player_id));

    const rowsToInsert = absentUsers
        .filter(u => !alreadyFined.has(u.player_id))
        .map(u => ({
            player_id:  u.player_id,
            amount:     avgFine,
            type:       'fine',
            reason:     reasonName,
            note:       `appt:${appt.id}`,
            created_by: 'system'
        }));

    if (rowsToInsert.length === 0) return;

    const { error } = await supa.from('fines_ledger').insert(rowsToInsert);
    if (error) console.error('Avg fine insert error:', error.message);
}

// ── ABSENCE FINES (no-show / no-vote) ──
async function checkAbsenceFines(pastAppointments, allVotes, allUsers) {
    const relevant = pastAppointments.filter(a => a.type === 'Training' || a.type === 'Gameday');
    if (relevant.length === 0) return;

    const eligibleUsers = allUsers.filter(u =>
        (u.role === 'member' || u.role === 'admin') && u.player_id
    );
    if (eligibleUsers.length === 0) return;

    const { data: existingFines } = await supa
        .from('fines_ledger')
        .select('player_id, note')
        .in('reason', [ABSENCE_FINES.Training.name, ABSENCE_FINES.Gameday.name]);

    const alreadyFined = new Set(
        (existingFines || [])
            .filter(f => f.note && f.note.startsWith('appt:'))
            .map(f => `${f.player_id}:${f.note.replace('appt:', '')}`)
    );

    const votedSet     = new Set(allVotes.map(v => `${v.user_id}:${v.appointment_id}`));
    const rowsToInsert = [];

    for (const appt of relevant) {
        const fine = ABSENCE_FINES[appt.type];
        for (const user of eligibleUsers) {
            const hasVoted    = votedSet.has(`${user.id}:${appt.id}`);
            const hasFinedKey = `${user.player_id}:${appt.id}`;
            if (!hasVoted && !alreadyFined.has(hasFinedKey)) {
                rowsToInsert.push({
                    player_id:  user.player_id,
                    amount:     fine.amount,
                    type:       'fine',
                    reason:     fine.name,
                    note:       `appt:${appt.id}`,
                    created_by: 'system'
                });
            }
        }
    }

    if (rowsToInsert.length === 0) return;
    const { error } = await supa.from('fines_ledger').insert(rowsToInsert);
    if (error) console.error('Absence fine insert error:', error.message);
}

// ── RENDER APPOINTMENT CARDS ──
function renderAppointments(appointments, allVotes, containerId, isPast) {
    const container = document.getElementById(containerId);

    if (appointments.length === 0) {
        container.innerHTML = `<p class="muted-text">${isPast ? 'Keine vergangenen Termine.' : 'Keine bevorstehenden Termine.'}</p>`;
        return;
    }

    const guests = allPlayers.filter(p => !memberPlayerIds.has(p.id));

    container.innerHTML = appointments.map(appt => {
        const votes     = allVotes.filter(v => v.appointment_id === appt.id);
        const attending = votes.filter(v => v.vote === 'yes');
        const declining = votes.filter(v => v.vote === 'no');
        const myVote    = currentUser ? votes.find(v => v.user_id === currentUser.id) : null;
        const typeStyle = TYPE_COLORS[appt.type] || TYPE_COLORS.Event;

        const apptStatus   = getApptStatus(appt);
        const isActive     = apptStatus === 'active';
        const isVoteLocked = isActive || isPast;

        // Date display
        const dateObj = new Date(appt.date);
        const dateStr = dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

        // Time display: prefer start_time/end_time columns, fallback to date
        let timeStr = '';
        if (appt.start_time) {
            const st = new Date(appt.start_time);
            timeStr = st.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            if (appt.end_time) {
                const et = new Date(appt.end_time);
                timeStr += ' – ' + et.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
            }
        } else {
            timeStr = dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
        }

        const activeBadge = isActive ? `<span class="appt-active-badge">● LÄUFT</span>` : '';

        const guestVotedIds   = new Set(votes.filter(v => v.is_guest).map(v => v.user_id));
        const availableGuests = guests.filter(g => !guestVotedIds.has(g.id));

        const canVote = !isVoteLocked && currentUser && (currentUser.role === 'admin' || currentUser.role === 'member');

        return `
<div class="appt-card ${isPast ? 'appt-card--past' : ''} ${isActive ? 'appt-card--active' : ''}">
    <div class="appt-card-header">
        <div class="appt-left">
            <span class="appt-type-badge" style="background:${typeStyle.bg};color:${typeStyle.color};">${typeStyle.label}</span>
            ${activeBadge}
            <div class="appt-title">${appt.title}</div>
        </div>
        <div class="appt-date-block">
            <div class="appt-date">${dateStr}</div>
            <div class="appt-time">${timeStr}</div>
            ${appt.place ? `<div class="appt-place">📍 ${appt.place}</div>` : ''}
        </div>
    </div>

    <div class="appt-votes">
        <div class="vote-col vote-col--yes">
            <div class="vote-col-header">
                <span class="vote-icon">✅</span>
                <span class="vote-count vote-count--yes">${attending.length}</span>
            </div>
            <div class="vote-names vote-names--col">
                ${attending.length > 0
                    ? attending.map(v => `
                        <span class="vote-name vote-name--yes${v.is_guest ? ' vote-name--guest' : ''}">
                            ${v.is_guest ? '👤 ' : ''}${v.username}${canVote && v.is_guest
                                ? `<button class="vote-guest-remove" onclick="removeGuestVote('${appt.id}', '${v.user_id}')" title="Entfernen">×</button>`
                                : ''
                            }
                        </span>`).join('')
                    : '<span class="vote-none">–</span>'}
            </div>
        </div>
        <div class="vote-col vote-col--no">
            <div class="vote-col-header">
                <span class="vote-icon">❌</span>
                <span class="vote-count vote-count--no">${declining.length}</span>
            </div>
            <div class="vote-names vote-names--col">
                ${declining.length > 0
                    ? declining.map(v => `<span class="vote-name vote-name--no">${v.username}</span>`).join('')
                    : '<span class="vote-none">–</span>'}
            </div>
        </div>
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
    ${availableGuests.length > 0 ? `
    <div class="guest-vote-row">
        <select id="guest-select-${appt.id}" class="select-field select-guest">
            <option value="">👤 Gast auswählen…</option>
            ${availableGuests.map(g => `<option value="${g.id}">${g.name}</option>`).join('')}
        </select>
        <button onclick="addGuestVote('${appt.id}')" class="btn-vote btn-vote--guest">
            + Gast
        </button>
    </div>` : ''}` : isVoteLocked && !isPast ? `
    <div class="appt-vote-locked">🔒 Abstimmung geschlossen – Termin läuft</div>` : ''}

    ${currentUser && currentUser.role === 'admin' ? `
    <div class="appt-admin-actions">
        ${isActive ? `<button onclick="endAppointmentNow('${appt.id}')" class="btn btn-accent btn-sm">⏹ Termin beenden</button>` : ''}
        <button onclick="deleteAppointment('${appt.id}')" class="btn btn-danger-outline btn-sm">Löschen</button>
    </div>` : ''}
</div>`;
    }).join('');
}

// ── CAST VOTE ──
async function castVote(appointmentId, vote) {
    if (!currentUser) return;
    const { error } = await supa.from('appointment_votes').upsert({
        appointment_id: appointmentId,
        user_id:        currentUser.id,
        username:       currentUser.username,
        vote:           vote,
        is_guest:       false
    }, { onConflict: 'appointment_id,user_id' });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    loadAppointments();
}

// ── ADD GUEST VOTE ──
async function addGuestVote(appointmentId) {
    if (!currentUser) return;
    const select  = document.getElementById(`guest-select-${appointmentId}`);
    const guestId = select ? select.value : '';
    if (!guestId) return;
    const guest = allPlayers.find(p => p.id === guestId);
    if (!guest) return;
    const { error } = await supa.from('appointment_votes').upsert({
        appointment_id: appointmentId,
        user_id:        guest.id,
        username:       guest.name,
        vote:           'yes',
        is_guest:       true
    }, { onConflict: 'appointment_id,user_id' });
    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }
    loadAppointments();
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
    loadAppointments();
}

// ── CREATE APPOINTMENT ──
async function createAppointment() {
    const title     = document.getElementById('appt-title').value.trim();
    const type      = document.getElementById('appt-type').value;
    const dateVal   = document.getElementById('appt-date').value;
    const startTime = document.getElementById('appt-start-time').value;
    const endTime   = document.getElementById('appt-end-time').value;
    const place     = document.getElementById('appt-place').value.trim();
    const msgEl     = document.getElementById('schedule-msg');

    if (!title || !dateVal) {
        msgEl.textContent = 'Bitte Bezeichnung und Datum angeben.';
        msgEl.style.color = 'var(--red)';
        setTimeout(() => msgEl.textContent = '', 3000);
        return;
    }
    if (endTime && !startTime) {
        msgEl.textContent = 'Bitte Startzeit angeben, wenn eine Endzeit gesetzt ist.';
        msgEl.style.color = 'var(--red)';
        setTimeout(() => msgEl.textContent = '', 3000);
        return;
    }

    const startISO = startTime ? new Date(`${dateVal}T${startTime}`).toISOString() : null;
    const endISO   = endTime   ? new Date(`${dateVal}T${endTime}`).toISOString()   : null;

    const { error } = await supa.from('appointments').insert([{
        title,
        type,
        date:       new Date(dateVal).toISOString(),
        start_time: startISO,
        end_time:   endISO,
        place:      place || null,
        status:     'upcoming',
        created_by: currentUser.username
    }]);

    if (error) {
        msgEl.textContent = 'Fehler: ' + error.message;
        msgEl.style.color = 'var(--red)';
    } else {
        msgEl.textContent = 'Termin wurde hinzugefügt!';
        msgEl.style.color = 'var(--green)';
        document.getElementById('appt-title').value      = '';
        document.getElementById('appt-date').value       = '';
        document.getElementById('appt-start-time').value = '';
        document.getElementById('appt-end-time').value   = '';
        document.getElementById('appt-place').value      = '';
        loadAppointments();
    }
    setTimeout(() => msgEl.textContent = '', 3000);
}

// ── END APPOINTMENT EARLY (admin only) ──
async function endAppointmentNow(id) {
    const ok = await showConfirm('Termin beenden', 'Diesen Termin jetzt frühzeitig beenden? Die Durchschnittsstrafe wird sofort berechnet.');
    if (!ok) return;

    const now = new Date().toISOString();
    const { error } = await supa.from('appointments')
        .update({ end_time: now, status: 'past' })
        .eq('id', id);

    if (error) { showToast('Fehler: ' + error.message, 'error'); return; }

    // Reload data and trigger avg fine calculation
    const [apptRes, votesRes, usersRes] = await Promise.all([
        supa.from('appointments').select('*').eq('id', id).single(),
        supa.from('appointment_votes').select('*').eq('appointment_id', id),
        supa.from('app_users').select('id, player_id, role')
    ]);

    if (apptRes.data) {
        await applyAverageFine(apptRes.data, votesRes.data || [], usersRes.data || []);
    }

    showToast('Termin beendet.', 'success');
    loadAppointments();
}

// ── DELETE APPOINTMENT ──
async function deleteAppointment(id) {
    const ok = await showConfirm('Termin löschen', 'Diesen Termin wirklich löschen?');
    if (!ok) return;
    const { error } = await supa.from('appointments').delete().eq('id', id);
    if (error) showToast('Fehler: ' + error.message, 'error');
    else loadAppointments();
}

// ── TOGGLE PAST SECTION ──
function togglePast() {
    const section = document.getElementById('past-section');
    const icon    = document.getElementById('past-toggle-icon');
    const isOpen  = section.style.display !== 'none';
    section.style.display = isOpen ? 'none' : 'block';
    icon.textContent = isOpen ? '▼' : '▲';
}
