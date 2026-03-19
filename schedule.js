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

// All players from the players table
let allPlayers = [];
// IDs of players that have a linked app_user (i.e. NOT guests)
let memberPlayerIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
    if (currentUser && currentUser.role === 'admin') {
        document.getElementById('admin-create-section').style.display = 'block';
    }
    loadAppointments();
});

// ── LOAD ALL APPOINTMENTS ──
async function loadAppointments() {
    const [apptRes, votesRes, playersRes, usersRes] = await Promise.all([
        supa.from('appointments').select('*').order('date', { ascending: true }),
        supa.from('appointment_votes').select('*'),
        supa.from('players').select('id, name').order('name'),
        supa.from('app_users').select('player_id')
    ]);

    if (apptRes.error) {
        document.getElementById('upcoming-list').innerHTML = '<p class="muted-text">Fehler beim Laden.</p>';
        return;
    }

    // Identify guests: players whose id is NOT linked to any app_user
    allPlayers = playersRes.data || [];
    const linkedIds = (usersRes.data || []).map(u => u.player_id).filter(Boolean);
    memberPlayerIds = new Set(linkedIds);

    const allVotes = votesRes.data || [];
    const now      = new Date();
    const upcoming = apptRes.data.filter(a => new Date(a.date) >= now);
    const past     = apptRes.data.filter(a => new Date(a.date) <  now).reverse();

    renderAppointments(upcoming, allVotes, 'upcoming-list', false);
    renderAppointments(past,     allVotes, 'past-list',     true);
}

// ── RENDER APPOINTMENT CARDS ──
function renderAppointments(appointments, allVotes, containerId, isPast) {
    const container = document.getElementById(containerId);

    if (appointments.length === 0) {
        container.innerHTML = `<p class="muted-text">${isPast ? 'Keine vergangenen Termine.' : 'Keine bevorstehenden Termine.'}</p>`;
        return;
    }

    // All guests = players with no linked app_user
    const guests = allPlayers.filter(p => !memberPlayerIds.has(p.id));

    container.innerHTML = appointments.map(appt => {
        const votes     = allVotes.filter(v => v.appointment_id === appt.id);
        const attending = votes.filter(v => v.vote === 'yes');
        const declining = votes.filter(v => v.vote === 'no');
        const myVote    = currentUser ? votes.find(v => v.user_id === currentUser.id) : null;
        const typeStyle = TYPE_COLORS[appt.type] || TYPE_COLORS.Event;
        const dateObj   = new Date(appt.date);
        const dateStr   = dateObj.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr   = dateObj.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const canVote   = !isPast && currentUser && (currentUser.role === 'admin' || currentUser.role === 'member');

        // Guests already added to this appointment
        const guestVotedIds    = new Set(votes.filter(v => v.is_guest).map(v => v.user_id));
        const availableGuests  = guests.filter(g => !guestVotedIds.has(g.id));

        return `
<div class="appt-card ${isPast ? 'appt-card--past' : ''}">
    <div class="appt-card-header">
        <div class="appt-left">
            <span class="appt-type-badge" style="background:${typeStyle.bg};color:${typeStyle.color};">${typeStyle.label}</span>
            <div class="appt-title">${appt.title}</div>
        </div>
        <div class="appt-date-block">
            <div class="appt-date">${dateStr}</div>
            <div class="appt-time">${timeStr} Uhr</div>
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
                                : ''}
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
    </div>` : ''}` : ''}

    ${currentUser && currentUser.role === 'admin' ? `
    <div class="appt-admin-actions">
        <button onclick="deleteAppointment('${appt.id}')" class="btn btn-danger-outline btn-sm">Löschen</button>
    </div>` : ''}
</div>`;
    }).join('');
}

// ── CAST VOTE (member / admin voting for themselves) ──
async function castVote(appointmentId, vote) {
    if (!currentUser) return;

    const { error } = await supa.from('appointment_votes').upsert({
        appointment_id: appointmentId,
        user_id:        currentUser.id,
        username:       currentUser.username,
        vote:           vote,
        is_guest:       false
    }, { onConflict: 'appointment_id,user_id' });

    if (error) { alert('Fehler: ' + error.message); return; }
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
        user_id:        guest.id,    // player UUID used as unique key
        username:       guest.name,
        vote:           'yes',
        is_guest:       true
    }, { onConflict: 'appointment_id,user_id' });

    if (error) { alert('Fehler: ' + error.message); return; }
    loadAppointments();
}

// ── REMOVE GUEST VOTE (members + admins can remove) ──
async function removeGuestVote(appointmentId, guestId) {
    if (!currentUser) return;

    const { error } = await supa
        .from('appointment_votes')
        .delete()
        .eq('appointment_id', appointmentId)
        .eq('user_id', guestId);

    if (error) { alert('Fehler: ' + error.message); return; }
    loadAppointments();
}

// ── CREATE APPOINTMENT (admin only) ──
async function createAppointment() {
    const title = document.getElementById('appt-title').value.trim();
    const type  = document.getElementById('appt-type').value;
    const date  = document.getElementById('appt-date').value;
    const place = document.getElementById('appt-place').value.trim();
    const msgEl = document.getElementById('schedule-msg');

    if (!title || !date) {
        msgEl.textContent = 'Bitte Bezeichnung und Datum angeben.';
        msgEl.style.color = 'var(--red)';
        setTimeout(() => msgEl.textContent = '', 3000);
        return;
    }

    const { error } = await supa.from('appointments').insert([{
        title,
        type,
        date: new Date(date).toISOString(),
        place: place || null,
        created_by: currentUser.username
    }]);

    if (error) {
        msgEl.textContent = 'Fehler: ' + error.message;
        msgEl.style.color = 'var(--red)';
    } else {
        msgEl.textContent = 'Termin wurde hinzugefügt!';
        msgEl.style.color = 'var(--green)';
        document.getElementById('appt-title').value = '';
        document.getElementById('appt-date').value  = '';
        document.getElementById('appt-place').value = '';
        loadAppointments();
    }
    setTimeout(() => msgEl.textContent = '', 3000);
}

// ── DELETE APPOINTMENT (admin only) ──
async function deleteAppointment(id) {
    if (!confirm('Termin wirklich löschen?')) return;
    const { error } = await supa.from('appointments').delete().eq('id', id);
    if (error) alert('Fehler: ' + error.message);
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