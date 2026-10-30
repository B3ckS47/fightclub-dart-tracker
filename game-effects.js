// ── GAME EFFECTS ──
// Celebration for a 180 and for a High Finish (>= HIGH_FINISH_MIN in game-logic.js):
// big pop-up text with a ring, a short sound, vibration on phones, and for a
// finish confetti. Purely cosmetic and non-blocking — it never takes input or
// delays scoring, and game-logic.js calls it inside a try/catch.
//
//   gameFx.celebrate180(name)
//   gameFx.celebrateHighFinish(name, points)
//
// Sound is synthesized with Web Audio (no audio files) and can be switched off
// in the settings (getSoundFx()/setSoundFx() in ui-utils.js). The animation
// stays on; with "reduce motion" it shrinks to a plain fade.
(function () {
    // ── SOUND ──
    let ctx = null;

    // Browsers only allow audio after a user gesture, so the context is created
    // on the first tap/key press. Bot and online-opponent throws then still play.
    function unlockAudio() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) ctx = new AC();
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
    }
    ['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
        document.addEventListener(ev, unlockAudio, { passive: true }));

    // One note: soft attack, exponential decay
    function tone(freq, start, dur, type, vol) {
        const t0  = ctx.currentTime + start;
        const osc = ctx.createOscillator();
        const g   = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
    }

    const N = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E6: 1318.5, G6: 1568, C7: 2093 };

    function play(kind) {
        if (typeof getSoundFx === 'function' && !getSoundFx()) return;
        if (!ctx || ctx.state !== 'running') return; // not unlocked yet — stay silent rather than error
        if (kind === '180') {
            // quick rising arpeggio + a bright chord
            [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.09, 0.16, 'triangle', 0.2));
            [N.C6, N.E6, N.G6].forEach(f => tone(f, 0.38, 0.55, 'sine', 0.1));
        } else {
            // fanfare: run up, then a full chord with sparkle on top
            [N.G4, N.C5, N.E5, N.G5].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.2));
            [N.C5, N.E5, N.G5, N.C6].forEach(f => tone(f, 0.52, 1.0, 'triangle', 0.13));
            [N.C7, N.G6, N.E6, N.C7].forEach((f, i) => tone(f, 0.62 + i * 0.09, 0.3, 'sine', 0.07));
        }
    }

    // ── VISUAL ──
    const CONFETTI_COLORS = ['#f5c542', '#29d87c', '#ff4455', '#60a5fa', '#a855f7', '#ffffff'];

    function confetti() {
        const wrap = document.createElement('div');
        wrap.className = 'fx-confetti';
        for (let i = 0; i < 44; i++) {
            const p = document.createElement('i');
            p.style.left              = (Math.random() * 100) + '%';
            p.style.background        = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
            p.style.animationDelay    = (Math.random() * 0.5) + 's';
            p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
            p.style.setProperty('--dx',  ((Math.random() - 0.5) * 120) + 'px');
            p.style.setProperty('--rot', (360 + Math.random() * 720) + 'deg');
            wrap.appendChild(p);
        }
        document.body.appendChild(wrap);
        setTimeout(() => wrap.remove(), 3200);
    }

    function show(kind, title, name, ms) {
        const el = document.createElement('div');
        el.className = `fx-overlay fx-overlay--${kind}`;
        el.innerHTML = `
            <div class="fx-ring"></div>
            <div class="fx-title"></div>
            <div class="fx-sub"></div>`;
        el.querySelector('.fx-title').textContent = title;
        el.querySelector('.fx-sub').textContent   = name || '';
        document.body.appendChild(el);
        setTimeout(() => el.classList.add('fx-overlay--out'), ms - 350);
        setTimeout(() => el.remove(), ms);
    }

    function vibrate(pattern) {
        try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* not available */ }
    }

    window.gameFx = {
        celebrate180(name) {
            show('180', '180!', name, 1900);
            play('180');
            vibrate([70, 40, 110]);
        },
        celebrateHighFinish(name, points) {
            show('finish', `HIGH FINISH ${points}`, name, 2600);
            confetti();
            play('finish');
            vibrate([90, 50, 90, 50, 200]);
        }
    };
})();
