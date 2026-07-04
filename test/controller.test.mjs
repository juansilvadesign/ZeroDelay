// Tests for the catch-up controller (engine/controller.js). It's CommonJS
// (scoped by engine/package.json) so we take the default import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import controllerPkg from '../engine/controller.js';
const { createController } = controllerPkg;

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
    // The reported scenario: stream floor ~8s (demand saturated), Suave mode
    // (target 5s), buffer ground down to ~2.2s. The buggy controller returned
    // exactly 1.05x here; the cushion semantics demand a full rest.
    const c = primed(2.2, 8, 5);
    for (let i = 0; i < 5; i++) {
        assert.equal(c.calcPlaybackRate(SPEED, 8, 2.2, 5, false), 1.0);
    }
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
