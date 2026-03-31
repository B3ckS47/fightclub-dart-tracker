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
