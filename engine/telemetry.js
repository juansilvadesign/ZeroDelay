// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Local telemetry behind "Copy diagnostics" and the session summary: a bounded
// sample log of the engine's recent behavior plus per-stream session counters.
// Everything lives in the page's memory and dies with the tab — nothing is
// persisted or sent anywhere; the only way any of it leaves the browser is the
// viewer explicitly copying it from the popup.
//
// Dual-loaded on purpose, exactly like engine/controller.js:
//   • Browser: classic script injected before inject.js, exposing
//     `window.ZeroDelay.createSampleLog` / `createSessionStats`.
//   • Node/tests: the sibling engine/package.json ({"type":"commonjs"}) makes
//     `module.exports` work (see test/telemetry.test.mjs).
'use strict';
(function () {
    // Round to `p` decimals (null for non-finite) — keeps the copied JSON
    // compact and byte-stable so two reports of the same stream diff cleanly.
    function round(v, p = 2) {
        if (!isFinite(v)) return null;
        const f = Math.pow(10, p);
        return Math.round(v * f) / f;
    }

    // Fixed-capacity sample log: one sample per second, two minutes deep by
    // default. Samples are compact arrays — [tSec, latency, buffer, rate] —
    // not objects, so 120 of them paste comfortably into a GitHub issue while
    // still showing exactly how a catch-up or a stall developed.
    function createSampleLog(capacity = 120, minIntervalMs = 1000) {
        const samples = [];
        let started = null;   // first sample's timestamp = t0 of the log
        let last_at = 0;

        // Called from the engine's hot loop every tick; only actually records
        // once per `minIntervalMs`. Returns whether the sample was taken.
        function add(nowMs, latency, buffer, rate) {
            if (nowMs - last_at < minIntervalMs) return false;
            last_at = nowMs;
            if (started === null) started = nowMs;
            samples.push([round((nowMs - started) / 1000, 0), round(latency), round(buffer), round(rate)]);
            if (samples.length > capacity) samples.splice(0, samples.length - capacity);
            return true;
        }

        return { add, list: () => samples.slice(), size: () => samples.length };
    }

    // Per-stream session counters (a fresh one is created per attach, like the
    // controller, so numbers never mix two lives). `recovered` integrates
    // (rate − 1)·dt — the seconds of live delay the catch-up actually ate —
    // and `rebuilt` its sub-1.0x mirror (the band mode / conservative brake).
    function createSessionStats(nowMs = Date.now()) {
        const started_at = nowMs;
        let watch = 0;          // seconds of live actually watched
        let recovered = 0;      // seconds of delay removed by rate > 1.0
        let rebuilt = 0;        // seconds given back by rate < 1.0 (cushion rebuilds)
        let latency_sum = 0;    // time-weighted, for the average
        let jumps = 0;          // seekToLiveHead calls (skip + manual)
        let stalls = 0;         // real live 'waiting' events (as the watchdog counts them)
        let last = null;        // previous tick's timestamp

        // dt is capped at 2s: a background-throttled tab or a suspended laptop
        // must not book watch-minutes that never played.
        function onTick(nowMs2, rate, latency) {
            const dt = last === null ? 0 : Math.min(Math.max((nowMs2 - last) / 1000, 0), 2);
            last = nowMs2;
            if (!isFinite(latency)) return;   // not live stats — don't count
            watch += dt;
            latency_sum += latency * dt;
            if (isFinite(rate)) {
                if (rate > 1.001) recovered += (rate - 1.0) * dt;
                else if (rate < 0.999) rebuilt += (1.0 - rate) * dt;
            }
        }

        function onJump() { jumps++; }
        function onStall() { stalls++; }

        function snapshot() {
            return {
                startedAt: started_at,
                watchSec: round(watch, 0),
                recoveredSec: round(recovered, 1),
                rebuiltSec: round(rebuilt, 1),
                jumps,
                stalls,
                latencyAvg: watch > 0 ? round(latency_sum / watch, 1) : null,
            };
        }

        return { onTick, onJump, onStall, snapshot };
    }

    const api = { createSampleLog, createSessionStats };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        const zd = (window.ZeroDelay = window.ZeroDelay || {});
        zd.createSampleLog = createSampleLog;
        zd.createSessionStats = createSessionStats;
    }
}());
