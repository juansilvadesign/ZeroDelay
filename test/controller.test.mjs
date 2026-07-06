// Tests for the catch-up controller (engine/controller.js). It's CommonJS
// (scoped by engine/package.json) so we take the default import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import controllerPkg from '../engine/controller.js';
const { createController, createBandController } = controllerPkg;

const SPEED = 1.25;

// Prime the buffer EMA at a level (the EMA converges toward `health`).
function primed(health, latency = 20, target = 6, n = 40) {
    const c = createController();
    for (let i = 0; i < n; i++) c.calcPlaybackRate(SPEED, latency, health, target, false);
    return c;
}

// Engage catch-up (buffer well above the cushion), then WALK the buffer down
// to `health` slowly (0.015s/tick, under the drain brake's threshold) so the
// reading isolates the taper, not the brake. Returns the rate at `health`.
function engagedRateAt(health, latency, target) {
    const c = createController();
    const start = target + 4.0;
    for (let i = 0; i < 40; i++) c.calcPlaybackRate(SPEED, latency, start, target, false);
    for (let b = start; b >= health; b -= 0.015) {
        c.calcPlaybackRate(SPEED, latency, Math.max(b, health), target, false);
    }
    // Final reading at exactly `health` (the walk-down stops on a float above it).
    return c.calcPlaybackRate(SPEED, latency, health, target, false);
}

test('exposes WARN_BUFFER for the UI to share one threshold', () => {
    const c = createController();
    assert.equal(typeof c.WARN_BUFFER, 'number');
});

test('non-finite latency or health is safe (1.0x)', () => {
    const c = createController();
    assert.equal(c.calcPlaybackRate(SPEED, NaN, 5, 6, false), 1.0);
    assert.equal(c.calcPlaybackRate(SPEED, 10, NaN, 6, false), 1.0);
});

test('at/under the live floor (latency < 2s) it rests at 1.0x', () => {
    const c = createController();
    // Even with a fat buffer, there is nothing to gain this close to live.
    assert.equal(c.calcPlaybackRate(SPEED, 1.5, 12, 6, false), 1.0);
});

test('the rate rises CONTINUOUSLY with latency (linear ramp, not on/off)', () => {
    // Same fat buffer, three different lags -> three DIFFERENT intermediate
    // rates. The old bang-bang model could only ever return 1.0 or 1.25.
    const near = primed(12, 4).calcPlaybackRate(SPEED, 4, 12, 6, false);
    const mid = primed(12, 6).calcPlaybackRate(SPEED, 6, 12, 6, false);
    const far = primed(12, 20).calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(near > 1.0 && near < mid && mid < far, `expected 1.0 < ${near} < ${mid} < ${far}`);
    assert.ok(far <= SPEED + 1e-9, 'never exceeds the mode max');
});

test('far behind with a healthy buffer reaches full speed', () => {
    const c = createController();
    let rate;
    for (let i = 0; i < 40; i++) rate = c.calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(Math.abs(rate - SPEED) < 1e-9, `expected full speed, got ${rate}`);
});

test('a critically low instantaneous buffer refuses to accelerate', () => {
    const c = primed(12);
    assert.equal(c.calcPlaybackRate(SPEED, 20, 1.0, 6, false), 1.0); // instantaneous floor guard
});

// --- The v1.2.0 regression (the "1.05x with a dying buffer" bug) -------------
// A live stream's latency floor (encoder+CDN pipeline, ~6-10s) sits far above
// MIN_LATENCY, so latency demand never turns off. The cushion must therefore be
// the resting point — the buggy continuous controller only rested at the stall
// floor (1.5s), ground the buffer down to it and held ~1.05x with no margin.

test('CazeTV regression: rests at 1.0x below the cushion even with permanent latency demand', () => {
    // The reported scenario: stream floor ~8s (demand saturated), a high-buffer
    // mode (target 5s), buffer ground down to ~2.2s. The buggy controller returned
    // exactly 1.05x here; the cushion semantics demand a full rest. (2.2s sits just
    // above the 2.0s brake line, so it rests at 1.0x rather than rebuilding.)
    const c = primed(2.2, 8, 5);
    for (let i = 0; i < 5; i++) {
        assert.equal(c.calcPlaybackRate(SPEED, 8, 2.2, 5, false), 1.0);
    }
});

test('classic brake: rebuilds below 1.0x when the cushion is thin, rests at 1.0x above the danger line', () => {
    // The brake fires only in the danger zone (smoothed buffer under ~2 s): there
    // the controller plays BELOW 1.0x to rebuild instead of only resting at 1.0x.
    const r = primed(1.0, 12, 4).getState().rate;
    assert.ok(r < 1.0 && r >= 0.90 - 1e-9, `thin cushion rebuilds below 1.0x (>=0.90), got ${r}`);

    // Comfortably above the danger line (still below the catch-up cushion): a plain
    // 1.0x rest — the brake never touches the comfortable modes.
    assert.equal(primed(3.5, 12, 4).getState().rate, 1.0);

    // Far behind live the brake fades out — don't slow forever while drifting
    // (the 30 s skip is the backstop).
    assert.equal(primed(1.0, 25, 4).getState().rate, 1.0);
});

test('below the cushion the engine rests — the cushion is the equilibrium', () => {
    // Thin buffer (2.0) under a 6s cushion: the buggy taper returned >1.0 and
    // kept draining; the cushion is not ours to spend.
    const c = primed(2.0, 20);
    assert.equal(c.calcPlaybackRate(SPEED, 20, 2.0, 6, false), 1.0);
});

test('hysteresis: does not engage inside the band above the cushion', () => {
    // Sitting at target+0.5 without ever having been comfortably above: rest.
    // (Prevents riding pinned to the cushion, spending every crumb of surplus.)
    const c = primed(4.5, 20, 4);
    assert.equal(c.calcPlaybackRate(SPEED, 20, 4.5, 4, false), 1.0);
});

test('engaged catch-up tapers continuously and rests AT the cushion', () => {
    // target 4, engaged from above: stronger push at 6.4 than 5.4 than 4.6,
    // and a full rest by the time the buffer touches the target.
    const high = engagedRateAt(6.4, 20, 4);
    const mid = engagedRateAt(5.4, 20, 4);
    const low = engagedRateAt(4.6, 20, 4);
    const atTarget = engagedRateAt(4.0, 20, 4);
    assert.ok(low > 1.0 && low < mid && mid < high, `expected 1.0 < ${low} < ${mid} < ${high}`);
    assert.equal(atTarget, 1.0, `expected rest at the cushion, got ${atTarget}`);
});

test('a real buffer drop bites immediately — the EMA cannot hide it', () => {
    // EMA primed fat (12s), then the real buffer plunges to 3s (segment-sized
    // dip). min(health, ema) must rest at once; the buggy version kept pushing
    // on the stale average for seconds.
    const c = primed(12, 20);
    assert.equal(c.calcPlaybackRate(SPEED, 20, 3.0, 6, false), 1.0);
});

test('a draining buffer trend forces rest near the cushion (predictive brake, issue #12)', () => {
    // Engaged and above the cushion, but draining fast: the connection is
    // losing ground, so pushing would dig into the cushion — rest pre-emptively.
    const c = primed(7.0, 20, 3);   // engaged (7.0 > 3+1.5), fat EMA
    let rate = null;
    for (const health of [4.9, 4.75, 4.6, 4.45, 4.3]) {
        rate = c.calcPlaybackRate(SPEED, 20, health, 3, false);
    }
    assert.equal(rate, 1.0, `expected the drain brake to rest, got ${rate}`);
});

test('aggressive mode (smaller cushion) pushes harder than a gentle one', () => {
    // Same buffer (3.5) and lag: gentle (target 5) is below its cushion and
    // must REST; aggressive (target 3) walked down from surplus still pushes.
    const gentle = primed(3.5, 20, 5).calcPlaybackRate(SPEED, 20, 3.5, 5, false);
    const aggressive = engagedRateAt(3.5, 20, 3);
    assert.equal(gentle, 1.0);
    assert.ok(aggressive > gentle, `expected aggressive ${aggressive} > gentle ${gentle}`);
});

test('instantaneous backoff: a raw dip to 2.5s cuts acceleration until recovery', () => {
    // Extreme mode (target 2, below the backoff line): a raw trough at 2.4s
    // must cut NOW. During the climb back, the drain brake keeps resting until
    // the trend turns; only a recovered level AND trend accelerate again.
    const c = createController();
    for (let i = 0; i < 40; i++) c.calcPlaybackRate(SPEED, 20, 8, 2, false); // engaged, fat
    assert.equal(c.calcPlaybackRate(SPEED, 20, 2.4, 2, false), 1.0);  // backoff cuts now
    assert.equal(c.calcPlaybackRate(SPEED, 20, 3.5, 2, false), 1.0);  // below resume: still cut
    assert.equal(c.calcPlaybackRate(SPEED, 20, 4.4, 2, false), 1.0);  // level ok, trend still negative
    c.calcPlaybackRate(SPEED, 20, 5.0, 2, false);
    c.calcPlaybackRate(SPEED, 20, 5.5, 2, false);
    assert.ok(c.calcPlaybackRate(SPEED, 20, 5.9, 2, false) > 1.0,
        'should accelerate again once level AND trend have recovered');
});

test('automatic mode raises the cushion after a near-stall', () => {
    const c = createController();
    for (let i = 0; i < 50; i++) c.calcPlaybackRate(SPEED, 20, 12, 6, true); // calm -> target creeps down
    const before = c.getState().auto_target;
    c.calcPlaybackRate(SPEED, 20, 0.5, 6, true);                             // near-stall
    assert.ok(c.getState().auto_target > before,
        `target should rise after a near-stall (${before} -> ${c.getState().auto_target})`);
});

test('each controller instance keeps independent state', () => {
    const a = createController();
    const b = createController();
    for (let i = 0; i < 20; i++) a.calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(a.getState().catching_up, 'a is catching up');
    assert.equal(b.getState().buffer_ema, null); // untouched
    assert.equal(b.getState().catching_up, false);
});

// --------------------------------------------------------------------------
// Buffer-regulation controller (the "Personalizado" mode). One rule:
//   rate = 1 + K*(buffer_ema - center) — surplus above the target speeds up
//   (capped 1.15x), deficit slows BELOW 1.0x to rebuild (floored 0.90x), eased
//   out as latency climbs so we never drift behind live forever.
// --------------------------------------------------------------------------

// Same 0.9/0.1 buffer EMA as the classic controller, so one sample barely moves
// it: feed a level until the EMA settles, then read the steady-state rate — what
// the viewer actually experiences.
function settle(c, { latency = 12, health, times = 120 } = {}) {
    let rate;
    for (let i = 0; i < times; i++) rate = c.calcPlaybackRate(SPEED, latency, health);
    return rate;
}

test('band: exposes WARN_BUFFER and clamps the center to [1, 6]', () => {
    assert.equal(typeof createBandController(3).WARN_BUFFER, 'number');
    assert.equal(createBandController(2).center, 2);     // in range
    assert.equal(createBandController(0.5).center, 1);   // clamped up to the min
    assert.equal(createBandController(99).center, 6);    // clamped down to the max
    assert.equal(createBandController(NaN).center, 3);   // safe default (3.0)
});

test('band: non-finite buffer is safe (1.0x)', () => {
    assert.equal(createBandController(5).calcPlaybackRate(SPEED, 12, NaN), 1.0);
});

test('band: parks at the target — ~1.0x at center, slows below it', () => {
    assert.ok(Math.abs(settle(createBandController(5), { health: 5 }) - 1.0) < 1e-9, 'dead center rests at 1.0x');
    assert.ok(settle(createBandController(5), { health: 4.5 }) < 1.0, 'below the target it slows to rebuild');
});

test('band: surplus above the target speeds up, capped at 1.15x', () => {
    const mild = settle(createBandController(5), { health: 5.8 });   // small surplus
    const big = settle(createBandController(5), { health: 9 });      // large surplus
    assert.ok(mild > 1.0 && mild < big, `speedup grows with surplus: ${mild} < ${big}`);
    assert.ok(big > 1.14 && big <= 1.15 + 1e-9, `capped at 1.15, got ${big}`);
});

test('band: deficit rebuilds below 1.0x, harder the thinner the cushion, floored at 0.90', () => {
    const mild = settle(createBandController(5), { health: 4.7 });   // small deficit
    const deep = settle(createBandController(5), { health: 3.0 });   // big deficit
    assert.ok(mild < 1.0 && mild > deep, `deeper deficit rebuilds harder: ${mild} vs ${deep}`);
    assert.ok(Math.abs(deep - 0.90) < 1e-9, `bottoms at the 0.90 floor, got ${deep}`);
});

test('band: rebuild eases back to 1.0x as latency climbs (no infinite drift)', () => {
    const near = settle(createBandController(5), { latency: 8, health: 3.5 });
    const far = settle(createBandController(5), { latency: 25, health: 3.5 });
    assert.ok(near < 0.95, `close to live it rebuilds hard, got ${near}`);
    assert.ok(far > 0.99, `far behind it stops slowing (~1.0x), got ${far}`);
});

test('band: instances keep independent state', () => {
    const a = createBandController(5);
    const b = createBandController(5);
    for (let i = 0; i < 30; i++) a.calcPlaybackRate(SPEED, 12, 9);
    assert.ok(a.getState().catching_up, 'a is catching up');
    assert.equal(b.getState().buffer_ema, null); // untouched
});
