// ── DART BOT ──
// A bot that throws single darts at a real dartboard (used by training-calc.html).
//
//  1. It picks a target the way a player would: scoring on T20, checking out along the
//     standard route (checkout.js), otherwise setting up a good double.
//  2. The dart then lands around that target with a Gaussian scatter on the real board
//     geometry. Aiming D8 hits 8, 16, 11 or their doubles now and then, but never D18
//     — neighbours only, as on a real board.
//  3. The scatter is calibrated so that aiming at T20 gives the wanted 3-dart average.
//
// Needs `checkouts` from checkout.js (optional: without it the bot just cannot find routes).

const DartBot = (() => {
    // Clockwise from the top, 18° per segment
    const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    // Board radii in mm
    const R_BULL = 6.35, R_OUTER = 15.9, R_TREBLE_IN = 99, R_TREBLE_OUT = 107, R_DOUBLE_IN = 162, R_DOUBLE_OUT = 170;
    const DOUBLE_FOCUS = 0.85;   // players are a bit more precise when they aim at a double
    const ASPECT       = 1.15;   // vertical scatter is slightly larger than the horizontal one

    const T20  = { num: 20, mult: 3 };
    const BULL = { num: 25, mult: 2 };

    // ── Board ──
    const MISS = { num: 0, mult: 0, score: 0, label: 'Daneben' };

    function segmentAt(x, y) {
        const r = Math.hypot(x, y);
        if (r > R_DOUBLE_OUT) return MISS;
        if (r <= R_BULL)  return { num: 25, mult: 2, score: 50, label: 'Bull' };
        if (r <= R_OUTER) return { num: 25, mult: 1, score: 25, label: '25' };
        let deg = Math.atan2(x, y) * 180 / Math.PI;      // clockwise from the top
        if (deg < 0) deg += 360;
        const num  = ORDER[Math.floor(((deg + 9) % 360) / 18)];
        const mult = (r >= R_TREBLE_IN && r <= R_TREBLE_OUT) ? 3 : (r >= R_DOUBLE_IN ? 2 : 1);
        return { num, mult, score: num * mult, label: mult === 3 ? 'T' + num : mult === 2 ? 'D' + num : String(num) };
    }

    // Where a player aims for a segment: middle of the ring, the broad outer part for singles
    function aimPoint(t) {
        if (t.num === 25) return t.mult === 2 ? { x: 0, y: 0 } : { x: 0, y: 11 };
        const a = ORDER.indexOf(t.num) * 18 * Math.PI / 180;
        const r = t.mult === 3 ? 103 : t.mult === 2 ? 166 : 134;
        return { x: r * Math.sin(a), y: r * Math.cos(a) };
    }

    function gauss(rng) {
        let u = 0, v = 0;
        while (u === 0) u = rng();
        while (v === 0) v = rng();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function throwAt(target, sigma, rng = Math.random) {
        const p = aimPoint(target);
        const s = target.mult === 2 ? sigma * DOUBLE_FOCUS : sigma;
        return segmentAt(p.x + gauss(rng) * s, p.y + gauss(rng) * s * ASPECT);
    }

    // ── Skill: scatter that gives the wanted 3-dart average when aiming at T20 ──
    function mulberry32(seed) {
        return () => {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function averageFor(sigma, n = 3000) {
        const rng = mulberry32(12345);      // same samples for every sigma → a smooth function
        let sum = 0;
        for (let i = 0; i < n; i++) sum += throwAt(T20, sigma, rng).score;
        return 3 * sum / n;
    }

    function sigmaForAverage(avg) {
        let lo = 2, hi = 120;               // lo = very precise, hi = very wild
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (averageFor(mid) > avg) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // Same, but measured over whole legs from `start`, because busts and missed doubles
    // pull the real average below what the bot scores on T20.
    function legAverage(sigma, start, legs) {
        const rng = mulberry32(777);
        let scored = 0, visits = 0;
        for (let l = 0; l < legs; l++) {
            let rest = start;
            for (let v = 0; v < 150 && rest > 0; v++) {
                const r = playVisit(rest, sigma, rng);
                scored += r.sum; visits++; rest = r.restAfter;
            }
        }
        return scored / visits;
    }

    // Scatter that makes the bot's average over a whole leg (points per visit) come out at `avg`
    function sigmaForLegAverage(avg, start = 501, legs = 120) {
        let hi = sigmaForAverage(avg);          // too wild: the leg average ends up below the wish
        let lo = hi * 0.3;                      // more precise: above it
        for (let i = 0; i < 9; i++) {
            const mid = (lo + hi) / 2;
            if (legAverage(mid, start, legs) > avg) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // ── Target choice ──
    function parseToken(tok) {
        if (tok === 'Bull') return BULL;
        if (tok[0] === 'T') return { num: +tok.slice(1), mult: 3 };
        if (tok[0] === 'D') return { num: +tok.slice(1), mult: 2 };
        if (tok[0] === 'S') return { num: +tok.slice(1), mult: 1 };
        return { num: +tok, mult: 1 };      // "25"
    }

    function routes() { return (typeof checkouts !== 'undefined') ? checkouts : {}; }

    // How nice is it to be left on this double (higher = better)
    const DOUBLE_RANK = { 32: 10, 16: 9, 40: 8, 24: 7, 20: 7, 8: 6, 36: 6, 12: 5, 28: 5, 4: 4, 18: 4, 30: 4,
                          6: 3, 26: 3, 22: 3, 34: 3, 14: 3, 38: 3, 10: 3, 2: 2 };

    // Odd rest up to 39: a single that leaves the best double, then that double
    // (the standard table only lists the even doubles)
    function oddSetupRoute(rest) {
        let best = null, bestRank = -1;
        for (let n = 1; n <= 20; n++) {
            const left = rest - n;
            if (left >= 2 && left <= 40 && left % 2 === 0 && DOUBLE_RANK[left] > bestRank) {
                bestRank = DOUBLE_RANK[left];
                best = [{ num: n, mult: 1 }, { num: left / 2, mult: 2 }];
            }
        }
        return best;
    }

    const routeCache = {};
    // Darts of the standard route to check out `rest`, if at most `d` darts are enough, otherwise null
    function finishRoute(rest, d) {
        let darts = routeCache[rest];
        if (darts === undefined) {
            if (rest === 50)               darts = [BULL];
            else if (routes()[rest])       darts = routes()[rest].trim().split(/\s+/).map(parseToken);
            else if (rest < 40 && rest % 2 === 1) darts = oddSetupRoute(rest);
            else                           darts = null;
            routeCache[rest] = darts;
        }
        return darts && darts.length <= d ? darts : null;
    }

    // How nice is it to be left with `left` (higher = better)?
    function leaveQuality(left, dartsLeft) {
        if (left < 2) return -100;                                  // bust
        if (dartsLeft > 0 && finishRoute(left, dartsLeft)) {         // can be finished with the darts still in hand
            const last = finishRoute(left, dartsLeft).slice(-1)[0];
            return 11 + (last.mult === 2 ? (DOUBLE_RANK[last.num * 2] || 1) / 10 : 0);
        }
        if (left <= 40) return left % 2 === 0 ? (DOUBLE_RANK[left] || 2) : 0.5;
        const r = finishRoute(left, 3);
        if (!r) return 1;
        return r.length <= 2 ? 4 : 3;
    }

    // Candidates for a setup shot: the broad singles, a few trebles and the bull (harder → weighted down)
    const SETUP_CANDIDATES = (() => {
        const list = [];
        for (let n = 1; n <= 20; n++) list.push({ t: { num: n, mult: 1 }, w: 1 });
        [20, 19, 18, 17, 16, 15].forEach(n => list.push({ t: { num: n, mult: 3 }, w: 0.6 }));
        list.push({ t: BULL, w: 0.5 });
        return list;
    })();

    // What would a player aim at with `rest` points left and `d` darts in hand?
    function chooseTarget(rest, d) {
        const route = finishRoute(rest, d);
        if (route) return route[0];
        if (rest > 110) return T20;                          // far from a finish: score
        let best = null, bestVal = -Infinity;
        for (const { t, w } of SETUP_CANDIDATES) {
            const left = rest - t.num * t.mult;
            if (left < 2) continue;
            const val = leaveQuality(left, d - 1) * w;
            if (val > bestVal) { bestVal = val; best = t; }
        }
        return best || T20;
    }

    // ── One visit (up to 3 darts) ──
    // Returns { darts:[{target, hit, restBefore}], sum, bust, bustReason, finished, restAfter }
    // sum = what the scorer has to write down (0 on a bust).
    function playVisit(rest, sigma, rng = Math.random) {
        const darts = [];
        let r = rest;
        for (let d = 3; d >= 1; d--) {
            const target = chooseTarget(r, d);
            const hit    = throwAt(target, sigma, rng);
            const after  = r - hit.score;
            darts.push({ target, hit, restBefore: r });
            let reason = null;
            if (after < 0)                           reason = 'Überworfen';
            else if (after === 1)                    reason = 'Rest 1 ist nicht auszumachen';
            else if (after === 0 && hit.mult !== 2)  reason = 'Ausgemacht ohne Double';
            if (reason) return { darts, sum: 0, bust: true, bustReason: reason, finished: false, restAfter: rest };
            r = after;
            if (r === 0) return { darts, sum: rest, bust: false, bustReason: null, finished: true, restAfter: 0 };
        }
        return { darts, sum: rest - r, bust: false, bustReason: null, finished: false, restAfter: r };
    }

    return { segmentAt, aimPoint, throwAt, sigmaForAverage, sigmaForLegAverage, legAverage, averageFor, chooseTarget, finishRoute, playVisit, ORDER };
})();

if (typeof module !== 'undefined') module.exports = DartBot;
