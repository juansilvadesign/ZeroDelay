// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Pure catch-up controller — the core "how fast should we play to trim latency"
// math, extracted from inject.js so it can be unit-tested without a browser.
//
// Dual-loaded on purpose:
//   • Browser: loaded as a CLASSIC script (before inject.js) and exposes
//     `window.ZeroDelay.createController`. `module` is undefined there, so the
//     CommonJS branch is skipped.
//   • Node/tests: the sibling `engine/package.json` ({"type":"commonjs"}) makes
//     Node treat this file as CommonJS even though the root package is ESM, so
//     `module.exports` works and `window` is undefined.
'use strict';
(function () {
    // Speeding up consumes the buffered-ahead content, pulling the playhead
    // toward real time, which REDUCES live latency. So the rate should track how
    // far behind live we are: play faster when the lag is large, ease off as we
    // approach the floor. This is a CONTINUOUS, latency-proportional (linear)
    // controller — not the old on/off model that produced short "bursts" of full
    // speed with long rests in between (which trimmed latency painfully slowly).
    //
    // The buffer is only a SAFETY term here: as the cushion shrinks toward the
    // stall floor we taper the rate back down smoothly, so we never fully stop
    // while there is still buffer to spend, and never stall by draining it dry.
    function createController() {
        const STALL_FLOOR = 1.5;       // hard rest below this instantaneous buffer (stall protection)
        const MIN_LATENCY = 2.0;       // already this close to live -> nothing to gain
        const LATENCY_FULL = 6.0;      // excess latency (s) past the floor at which we reach full speed

        let buffer_ema = null;         // smoothed buffer health
        let auto_target = 6.0;         // automatic-mode buffer cushion
        let auto_cooldown = 0;         // ticks to wait after a near-stall
        let last_rate = 1.0;           // last rate we returned (diagnostics)

        function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

        // Automatic mode: adapt the buffer cushion to the connection over time.
        function auto_buffer_target(health) {
            if (isFinite(health) && health < 1.0) {              // a near-stall just happened
                auto_target = Math.min(9.0, auto_target + 1.0);    // back off: keep more buffer
                auto_cooldown = 240;                               // ~60s at 250ms
            } else if (auto_cooldown > 0) {
                auto_cooldown--;
            } else if (buffer_ema !== null && buffer_ema > auto_target + 2.0) {
                auto_target = Math.max(4.0, auto_target - 0.01);   // calm -> creep closer to live
            }
            return auto_target;
        }

        // Returns the playback rate to apply this tick — a continuous value
        // between 1.0 (rest) and `speed` (the mode's max, e.g. 1.25).
        function calcPlaybackRate(speed, latency, health, bufferTarget, auto) {
            if (!isFinite(health) || !isFinite(latency)) return (last_rate = 1.0);
            buffer_ema = buffer_ema === null ? health : buffer_ema * 0.9 + health * 0.1;
            if (latency < MIN_LATENCY) return (last_rate = 1.0);   // already at the stream's floor

            // Resolve the cushion first so automatic mode keeps adapting (a
            // near-stall must still raise the target) before any early rest.
            const target = auto ? auto_buffer_target(health) : bufferTarget;
            if (health < STALL_FLOOR) return (last_rate = 1.0);    // instantaneous stall guard

            // 1) Linear demand from latency: 0 at the floor, ramping up to 1 once
            //    we're LATENCY_FULL seconds behind it. This is the "linear speed
            //    increase" — the further behind, the faster, continuously.
            const demand = clamp01((latency - MIN_LATENCY) / LATENCY_FULL);

            // 2) Buffer headroom (safety): 1 at/above the mode's cushion, easing
            //    smoothly to 0 at the absolute stall floor. Aggressive modes (small
            //    cushion) push harder for longer; gentle modes ease off sooner.
            const headroom = clamp01((buffer_ema - STALL_FLOOR) / Math.max(0.5, target - STALL_FLOOR));

            const rate = 1.0 + (speed - 1.0) * demand * headroom;
            return (last_rate = rate);
        }

        // Read-only snapshot of internal state — for tests and diagnostics.
        function getState() {
            return { buffer_ema, auto_target, auto_cooldown, rate: last_rate, catching_up: last_rate > 1.001 };
        }

        // The buffer level below which the UI should warn (red) — exported so the
        // player indicator and the controller share one source of truth.
        return { calcPlaybackRate, getState, WARN_BUFFER: STALL_FLOOR + 1.0 };
    }

    const api = { createController };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') (window.ZeroDelay = window.ZeroDelay || {}).createController = createController;
}());
