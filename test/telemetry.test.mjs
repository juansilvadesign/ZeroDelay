// Tests for the local-telemetry primitives behind "Copy diagnostics" and the
// session summary (engine/telemetry.js — loaded here through its CommonJS
// face, exactly like the controller tests do).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSampleLog, createSessionStats } = require('../engine/telemetry.js');

test('sample log records at most one sample per interval', () => {
    const log = createSampleLog(120, 1000);
    assert.equal(log.add(1000, 3.0, 5.0, 1.0), true);
    assert.equal(log.add(1400, 3.1, 5.1, 1.0), false);  // 400ms later — skipped
    assert.equal(log.add(2000, 3.2, 5.2, 1.25), true);
    assert.equal(log.size(), 2);
});

test('sample log samples are compact [t, latency, buffer, rate] arrays with t relative to the first', () => {
    const log = createSampleLog(120, 1000);
    log.add(5000, 3.456, 5.123, 1.0);
    log.add(6000, 2.987, 4.5, 1.25);
    assert.deepEqual(log.list(), [
        [0, 3.46, 5.12, 1],
        [1, 2.99, 4.5, 1.25],
    ]);
});

test('sample log trims to capacity, dropping the oldest', () => {
    const log = createSampleLog(3, 1000);
    for (let i = 0; i < 5; i++) log.add((i + 1) * 1000, i, i, 1.0);
    const t = log.list().map(s => s[0]);
    assert.deepEqual(t, [2, 3, 4]);   // first two (t=0, t=1) dropped
});

test('sample log stores null for non-finite readings instead of NaN', () => {
    const log = createSampleLog(120, 1000);
    log.add(1000, NaN, Infinity, 1.0);
    assert.deepEqual(log.list()[0], [0, null, null, 1]);
});

test('session stats integrate recovered/rebuilt seconds from the rate', () => {
    const s = createSessionStats(0);
    s.onTick(0, 1.0, 5.0);          // first tick establishes the clock (dt=0)
    s.onTick(1000, 1.25, 5.0);      // 1s at 1.25x -> 0.25s recovered
    s.onTick(2000, 1.25, 5.0);      // +0.25s
    s.onTick(3000, 0.9, 5.0);       // 1s at 0.90x -> 0.1s rebuilt
    const snap = s.snapshot();
    assert.equal(snap.recoveredSec, 0.5);
    assert.equal(snap.rebuiltSec, 0.1);
    assert.equal(snap.watchSec, 3);
});

test('session stats compute a time-weighted average latency', () => {
    const s = createSessionStats(0);
    s.onTick(0, 1.0, 4.0);
    s.onTick(1000, 1.0, 4.0);      // 1s at 4.0
    s.onTick(2000, 1.0, 2.0);      // 1s at 2.0
    assert.equal(s.snapshot().latencyAvg, 3.0);
});

test('session stats cap dt so a throttled/suspended tab cannot book unplayed time', () => {
    const s = createSessionStats(0);
    s.onTick(0, 1.0, 3.0);
    s.onTick(60000, 1.0, 3.0);      // a minute gap counts as at most 2s
    assert.equal(s.snapshot().watchSec, 2);
});

test('session stats ignore ticks without live latency', () => {
    const s = createSessionStats(0);
    s.onTick(0, 1.0, NaN);
    s.onTick(1000, 1.25, NaN);      // no live stats — nothing counts
    const snap = s.snapshot();
    assert.equal(snap.watchSec, 0);
    assert.equal(snap.recoveredSec, 0);
    assert.equal(snap.latencyAvg, null);
});

test('session stats count jumps and stalls', () => {
    const s = createSessionStats(0);
    s.onJump();
    s.onJump();
    s.onStall();
    const snap = s.snapshot();
    assert.equal(snap.jumps, 2);
    assert.equal(snap.stalls, 1);
});
