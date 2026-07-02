// Tests for the catch-up controller (engine/controller.js). It's CommonJS
// (scoped by engine/package.json) so we take the default import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import controllerPkg from '../engine/controller.js';
const { createController } = controllerPkg;

const SPEED = 1.25;

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
    const near = createController().calcPlaybackRate(SPEED, 4, 12, 6, false);
    const mid = createController().calcPlaybackRate(SPEED, 6, 12, 6, false);
    const far = createController().calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(near > 1.0 && near < mid && mid < far, `expected 1.0 < ${near} < ${mid} < ${far}`);
    assert.ok(far <= SPEED + 1e-9, 'never exceeds the mode max');
});

test('far behind with a healthy buffer reaches full speed', () => {
    const c = createController();
    let rate;
    for (let i = 0; i < 10; i++) rate = c.calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(Math.abs(rate - SPEED) < 1e-9, `expected full speed, got ${rate}`);
});

test('a critically low instantaneous buffer refuses to accelerate', () => {
    const c = createController();
    for (let i = 0; i < 20; i++) c.calcPlaybackRate(SPEED, 20, 12, 6, false); // prime a fat EMA
    assert.equal(c.calcPlaybackRate(SPEED, 20, 1.0, 6, false), 1.0);          // instantaneous floor guard
});

test('buffer safety tapers the rate as the cushion shrinks (never a hard stop)', () => {
    // A thin buffer still catches up, just gently — it does not slam to 1.0 the
    // moment the cushion dips, which is what caused the slow "bursts".
    const thin = createController().calcPlaybackRate(SPEED, 20, 2.0, 6, false);
    const fat = createController().calcPlaybackRate(SPEED, 20, 12, 6, false);
    assert.ok(thin > 1.0 && thin < fat, `expected 1.0 < ${thin} < ${fat}`);
});

test('aggressive mode (smaller cushion) pushes harder than a gentle one', () => {
    // Same buffer and lag, different target: the tighter cushion accelerates more.
    const gentle = createController().calcPlaybackRate(SPEED, 20, 3.5, 5, false);
    const aggressive = createController().calcPlaybackRate(SPEED, 20, 3.5, 3, false);
    assert.ok(aggressive > gentle, `expected aggressive ${aggressive} > gentle ${gentle}`);
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
