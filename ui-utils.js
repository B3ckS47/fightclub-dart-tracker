// ── FLIGHTCLUB UI UTILITIES ──
// Global toast + confirm modal used across all pages.

// ── TOAST ──
(function() {
    let _queue   = [];
    let _running = false;

    window.showToast = window.showToast || function(message, type) {
        _queue.push({ message, type: type || 'info' });
        if (!_running) _process();
    };

    function _process() {
        if (_queue.length === 0) { _running = false; return; }
        _running = true;
        const { message, type } = _queue.shift();
        const el = document.createElement('div');
        el.className = 'fc-toast fc-toast--' + type;
        el.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('fc-toast--visible'));
        setTimeout(() => {
            el.classList.remove('fc-toast--visible');
            setTimeout(() => { el.remove(); _process(); }, 350);
        }, 3000);
    }
})();

// ── UNDO TOAST ──
// A toast with a clickable "Rückgängig" button — for destructive actions that
// are cheap to reverse right after (the regular toast ignores pointer events).
// onUndo runs at most once; the toast disappears after `ms` either way.
(function() {
    window.showUndoToast = function(message, onUndo, ms) {
        const el = document.createElement('div');
        el.className = 'fc-toast fc-toast--info fc-toast--action';
        const text = document.createElement('span');
        text.textContent = message;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fc-toast-action';
        btn.textContent = 'RÜCKGÄNGIG';
        el.append(text, btn);
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('fc-toast--visible'));

        let done = false;
        const dismiss = () => {
            el.classList.remove('fc-toast--visible');
            setTimeout(() => el.remove(), 350);
        };
        btn.addEventListener('click', () => {
            if (done) return;
            done = true;
            dismiss();
            onUndo();
        });
        setTimeout(() => { if (!done) { done = true; dismiss(); } }, ms || 7000);
    };
})();

// ── CONFIRM / ALERT MODAL ──
(function() {
    let _resolve = null;

    function _ensureModal() {
        if (document.getElementById('fc-confirm-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id        = 'fc-confirm-overlay';
        overlay.className = 'fc-confirm-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML = `
            <div class="fc-confirm-modal">
                <div class="fc-confirm-icon" id="fc-confirm-icon">⚠️</div>
                <div class="fc-confirm-title" id="fc-confirm-title"></div>
                <p class="fc-confirm-msg" id="fc-confirm-msg"></p>
                <div class="fc-confirm-btns">
                    <button class="btn" id="fc-confirm-cancel">ABBRECHEN</button>
                    <button class="btn btn-primary" id="fc-confirm-ok">BESTÄTIGEN</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        document.getElementById('fc-confirm-ok').addEventListener('click', () => _close(true));
        document.getElementById('fc-confirm-cancel').addEventListener('click', () => _close(false));
    }

    function _close(result) {
        document.getElementById('fc-confirm-overlay').style.display = 'none';
        document.getElementById('fc-confirm-cancel').style.display = '';
        document.getElementById('fc-confirm-ok').textContent = 'BESTÄTIGEN';
        if (_resolve) { _resolve(result); _resolve = null; }
    }

    window.showConfirm = function(title, message, icon) {
        _ensureModal();
        document.getElementById('fc-confirm-icon').textContent  = icon || '⚠️';
        document.getElementById('fc-confirm-title').textContent = title;
        document.getElementById('fc-confirm-msg').textContent   = message;
        document.getElementById('fc-confirm-overlay').style.display = 'flex';
        return new Promise(resolve => { _resolve = resolve; });
    };

    window.showAlert = function(title, message, icon) {
        _ensureModal();
        document.getElementById('fc-confirm-icon').textContent  = icon || 'ℹ️';
        document.getElementById('fc-confirm-title').textContent = title;
        document.getElementById('fc-confirm-msg').textContent   = message;
        document.getElementById('fc-confirm-cancel').style.display = 'none';
        document.getElementById('fc-confirm-ok').textContent    = 'OK';
        document.getElementById('fc-confirm-overlay').style.display = 'flex';
        return new Promise(resolve => { _resolve = () => resolve(); });
    };
})();

// ── SHARED HELPERS ──
// Previously copy-pasted per page (fines.html, fines-detail.html, punkte.html,
// schedule.js) and drifting apart — one version here keeps them identical.
(function () {
    window.escHtml = function (str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    // Always absolute value, no sign: callers decide whether to prefix +/–.
    window.formatEur = function (amount) {
        return Math.abs(amount).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    };

    // Supabase/PostgREST caps a single select() at 1000 rows by default and
    // silently truncates beyond that. Pass a function that returns a FRESH
    // query builder each call (builders are single-use) with its own stable
    // .order() — without one, Postgres doesn't guarantee row order across
    // separate range() calls and pages could skip or repeat rows.
    // Throws on error: for sums/balances a silently partial result is worse
    // than a visible failure.
    window.fetchAllRows = async function (makeQuery) {
        const pageSize = 1000;
        let all = [], from = 0;
        while (true) {
            const { data, error } = await makeQuery().range(from, from + pageSize - 1);
            if (error) throw error;
            all = all.concat(data || []);
            if (!data || data.length < pageSize) break;
            from += pageSize;
        }
        return all;
    };

    // Bottom sheet (.entry-sheet) open/close with the slide-in animation.
    window.openSheet = function (sheetId, overlayId) {
        document.getElementById(overlayId).style.display = 'block';
        const sheet = document.getElementById(sheetId);
        sheet.style.display = 'block';
        requestAnimationFrame(() => sheet.classList.add('entry-sheet--open'));
    };

    window.closeSheet = function (sheetId, overlayId) {
        const sheet = document.getElementById(sheetId);
        sheet.classList.remove('entry-sheet--open');
        setTimeout(() => {
            sheet.style.display = 'none';
            document.getElementById(overlayId).style.display = 'none';
        }, 300);
    };
})();

// ── THEME MANAGER ──
(function () {
    const THEME_KEY = 'fc47_theme';

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme || 'dark');
        // Update meta theme-color for PWA chrome
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'light' ? '#e4e7ef' : '#0d0d0f';
    }

    // Apply immediately on script load (before paint)
    const saved = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(saved);

    window.getTheme    = () => localStorage.getItem(THEME_KEY) || 'dark';
    window.setTheme    = (theme) => {
        localStorage.setItem(THEME_KEY, theme);
        applyTheme(theme);
    };
})();

// ── GAME SOUND EFFECTS (180 / High Finish) — on unless switched off in the settings ──
(function () {
    const KEY = 'fc47_sound_fx';
    window.getSoundFx = () => {
        try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; }
    };
    window.setSoundFx = (on) => {
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* storage blocked — keeps default */ }
    };
})();

// ── SESSION STORAGE HELPER ──
// Transparently uses localStorage or sessionStorage based on user preference
(function () {
    const STAY_KEY = 'fc47_stay_logged_in';

    function getStore() {
        return localStorage.getItem(STAY_KEY) === '1' ? localStorage : sessionStorage;
    }

    // Drop-in replacements used everywhere instead of sessionStorage directly
    window.fcGetUser = function () {
        // Check both storages — migration: if only in sessionStorage, keep it there
        return localStorage.getItem('fc47_user') || sessionStorage.getItem('fc47_user');
    };

    window.fcSetUser = function (value) {
        // Always write to the active store; clear the other
        if (localStorage.getItem(STAY_KEY) === '1') {
            localStorage.setItem('fc47_user', value);
            sessionStorage.removeItem('fc47_user');
        } else {
            sessionStorage.setItem('fc47_user', value);
            localStorage.removeItem('fc47_user');
        }
    };

    window.fcRemoveUser = function () {
        localStorage.removeItem('fc47_user');
        sessionStorage.removeItem('fc47_user');
    };

    window.getStayLoggedIn  = () => localStorage.getItem(STAY_KEY) === '1';
    window.setStayLoggedIn  = function (val) {
        if (val) {
            localStorage.setItem(STAY_KEY, '1');
            // Migrate session → local if currently logged in
            const u = sessionStorage.getItem('fc47_user');
            if (u) { localStorage.setItem('fc47_user', u); sessionStorage.removeItem('fc47_user'); }
        } else {
            localStorage.removeItem(STAY_KEY);
            // Migrate local → session
            const u = localStorage.getItem('fc47_user');
            if (u) { sessionStorage.setItem('fc47_user', u); localStorage.removeItem('fc47_user'); }
        }
    };
})();
