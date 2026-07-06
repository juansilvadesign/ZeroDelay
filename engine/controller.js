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
    // toward real time, which REDUCES live latency. The rate is CONTINUOUS
    // (latency-proportional), but it only ever spends buffer that sits ABOVE
    // the mode's cushion: the bufferTarget is the equilibrium the buffer rests
    // at, not just a taper width. A stream whose latency floor is unreachable
    // (every real live: encoder+CDN pipeline keeps latency well above
    // MIN_LATENCY) must NOT grind the buffer down to the stall floor trying —
    // that exact regression shipped in v1.2.0 and stalled lives worldwide:
    // demand saturated forever, the only rest was STALL_FLOOR=1.5s, and the
    // engine held ~1.05x with no margin until any late segment stalled the
    // stream (then the buffer refilled behind live and the cycle repeated).
    function createController() {
        const STALL_FLOOR = 1.5;       // hard rest below this instantaneous buffer (stall protection)
        const BUFFER_BACKOFF = 2.5;    // instantaneous backoff: cut acceleration here...
        const BUFFER_RESUME = 4.0;     // ...and only allow it again once recovered to this
        const MIN_LATENCY = 2.0;       // already this close to live -> nothing to gain
        const LATENCY_FULL = 6.0;      // excess latency (s) past the floor at which we reach full speed
        const RAMP = 2.0;              // full speed once the buffer sits this far above the cushion
        const ENGAGE_BAND = 1.5;       // hysteresis: only engage this far above the cushion
        const DRAIN_BRAKE = -0.02;     // Δbuffer/tick below which we rest pre-emptively (issue #12)

        // The "brake": when the controller would rest at 1.0x but the cushion is
        // thin, play BELOW 1.0x to actively REBUILD it instead of only resting and
        // hoping the network refills. Fires only in the danger zone, so the
        // comfortable modes never feel it; it just makes the aggressive ones far
        // harder to stall (validated in scripts/sim-live.mjs).
        const BRAKE_START = 2.0;       // rebuild once the smoothed buffer dips under this
        const BRAKE_FLOOR = 0.90;      // slowest playback while rebuilding
        const BRAKE_GAIN = 0.20;       // slowdown per second of buffer below BRAKE_START
        const BRAKE_DRIFT_CEIL = 22.0; // fade the brake out as latency climbs toward here...
        const BRAKE_DRIFT_SPAN = 6.0;  // ...over this many seconds (the 30 s skip is the backstop)

        let buffer_ema = null;         // smoothed buffer health
        let last_health = null;        // previous tick's raw buffer health
        let drain_ema = 0;             // smoothed Δbuffer/tick (draining < 0, filling > 0)
        let engaged = false;           // catch-up hysteresis state
        let backoff_ok = true;         // instantaneous-buffer backoff state
        let auto_target = 6.0;         // automatic-mode buffer cushion
        let auto_cooldown = 0;         // ticks to wait after a near-stall
        let last_rate = 1.0;           // last rate we returned (diagnostics)

        function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

        // Resolve a "rest" decision: 1.0x when the cushion is healthy, or a
        // sub-1.0x rebuild rate when it's in the danger zone (the brake). Every
        // low-buffer rest below routes through here, so the brake covers them all
        // at once without touching the catch-up path (which only runs when the
        // buffer already sits comfortably above the cushion).
        function restOrBrake(latency, target) {
            const b = buffer_ema;
            // The brake line follows the mode: comfortable targets rebuild from the
            // fixed 2 s danger zone, but an aggressive (small) target lets the buffer
            // sit lower before braking, so it can actually reach near the chosen
            // cushion instead of being held above it.
            const brakeAt = Math.min(BRAKE_START, Math.max(1.2, target - 0.5));
            if (b == null || b >= brakeAt) return (last_rate = 1.0);
            const budget = clamp01((BRAKE_DRIFT_CEIL - latency) / BRAKE_DRIFT_SPAN);
            const slow = Math.min(BRAKE_GAIN * (brakeAt - b), 1.0 - BRAKE_FLOOR) * budget;
            return (last_rate = 1.0 - slow);
        }

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
            // Buffer trend (first derivative, short EMA). A steadily draining
            // buffer means the connection is losing ground even while the level
            // still looks fine — the predictive brake behind issue #12.
            if (last_health !== null) drain_ema = drain_ema * 0.8 + (health - last_health) * 0.2;
            last_health = health;
            if (latency < MIN_LATENCY) return (last_rate = 1.0);   // already at the stream's floor

            // Resolve the cushion first so automatic mode keeps adapting (a
            // near-stall must still raise the target) before any early rest.
            const target = auto ? auto_buffer_target(health) : bufferTarget;
            if (health < STALL_FLOOR) return restOrBrake(latency, target); // instantaneous stall guard -> rebuild if the cushion is thin

            // Instantaneous backoff hysteresis (the third field-proven guard):
            // a raw dip cuts acceleration NOW — no EMA, no taper — and stays cut
            // until the raw level recovers. Its band tracks the target so an
            // aggressive (small) cushion isn't forced to climb back to a fixed
            // 4.0 s before resuming; comfortable targets keep the proven 2.5/4.0.
            const backoffLo = Math.min(BUFFER_BACKOFF, Math.max(1.2, target - 0.5));
            const backoffHi = Math.min(BUFFER_RESUME, Math.max(backoffLo + 0.8, target + 0.5));
            if (health <= backoffLo) backoff_ok = false;
            else if (health >= backoffHi) backoff_ok = true;
            if (!backoff_ok) return restOrBrake(latency, target);

            // The EMA smooths upward noise, but a REAL drop must bite at once —
            // taking the min means a fast segment-sized dip can never hide
            // behind a stale, fatter average.
            const buffer_now = Math.min(health, buffer_ema);

            // Pre-emptive brake (issue #12): don't push against a connection
            // that's already losing ground — rest BEFORE the level dips toward
            // a stall. Unconditional like the field-proven original: while
            // genuinely behind, downloads outpace playback (the trend is
            // positive) and the brake never fires; at the live edge it turns
            // surplus-spending into short, safe pushes. The brake keeps the
            // hysteresis state: once the trend recovers we resume mid-band.
            if (drain_ema < DRAIN_BRAKE) return restOrBrake(latency, target);

            // Hysteresis (the old controller's field-proven CATCH_UP_BAND):
            // engage only once the buffer sits comfortably ABOVE the cushion,
            // disengage the moment it touches the cushion. Without the band the
            // engine rides pinned to the target, spending every crumb of
            // surplus, and segment jitter has no margin to land in.
            // Arming reads the SLOW ema on purpose: a momentary spike must not
            // re-arm a parked engine into sawtooth cycling at the band bottom —
            // only sustained comfort does. Resting reads the fast signal.
            // The engage band tightens for aggressive (small) targets so the buffer
            // tracks near the chosen cushion instead of floating a fixed 1.5 s above
            // it; comfortable targets keep the full field-proven band. The sub-1.0x
            // brake below is the safety net that makes tightening this safe.
            const engageBand = Math.min(ENGAGE_BAND, Math.max(0.6, target * 0.4));
            if (engaged) { if (buffer_now <= target) engaged = false; }
            else if (buffer_ema > target + engageBand) engaged = true;
            if (!engaged) return restOrBrake(latency, target);

            // 1) Linear demand from latency: 0 at the floor, ramping up to 1
            //    once we're LATENCY_FULL seconds behind it.
            const demand = clamp01((latency - MIN_LATENCY) / LATENCY_FULL);

            // 2) Buffer SURPLUS above the mode's cushion: 0 at/below the target
            //    (rest — the cushion is the equilibrium), ramping to 1 once the
            //    buffer sits RAMP seconds above it. Catch-up spends only the
            //    surplus; it never digs into the cushion itself.
            const headroom = clamp01((buffer_now - target) / RAMP);

            const rate = 1.0 + (speed - 1.0) * demand * headroom;
            return (last_rate = rate);
        }

        // Read-only snapshot of internal state — for tests and diagnostics.
        function getState() {
            return { buffer_ema, drain_ema, engaged, auto_target, auto_cooldown, rate: last_rate, catching_up: last_rate > 1.001 };
        }

        // The buffer level below which the UI should warn (red) — exported so the
        // player indicator and the controller share one source of truth.
        return { calcPlaybackRate, getState, WARN_BUFFER: STALL_FLOOR + 1.0 };
    }

    // ----------------------------------------------------------------------
    // Buffer-regulation controller — the engine of the "Personalizado" (custom) mode.
    // Same goal as the classic one (keep you close to live) but built for
    // connections that WOBBLE, and it does one thing the classic controller
    // never does: it plays BELOW 1.0x to REBUILD the buffer when it thins.
    //
    // The physics that makes that work: you can only buffer content that has
    // already been published ahead of the playhead, so
    //     buffer  <=  latency - pipeline_floor.
    // To hold `center` seconds of buffer you must sit at least that far behind
    // live. Slowing down (rate < 1) GROWS latency, which lifts that ceiling and
    // gives the buffer room to fill — "fall back a little so the cushion can
    // refill" is the mechanism, not a side effect.
    //
    // So we regulate the BUFFER around `center` (the slider) with one rule:
    //     rate = 1 + K * (buffer_ema - center)
    // surplus above the target -> play a touch faster (spend it, drift back
    // toward live, capped at 1.15x); deficit below it -> play a touch slower
    // (rebuild, floored at 0.90x). The rebuild eases out as latency climbs so a
    // weak link can't hold us slow while we drift ever further behind; the 30s
    // skip in inject.js is the final backstop. Latency is NEVER the target here
    // (its pipeline floor sits above any 3.5-6s center, so chasing it would just
    // grind the buffer down — the exact trap the classic controller's comment
    // above warns about). Validated with scripts/sim-live.mjs: 0 stalls with the
    // buffer parked on `center` at comfortable targets; very thin targets (~1-2s)
    // trade stability for closeness and can stall on jitter — the user's call.
    function createBandController(center) {
        const MAX_RATE = 1.15;     // fastest while spending buffer surplus (calmer than the aggressive modes)
        const SLOW_MIN = 0.90;     // slowest while rebuilding a thin cushion
        const K_UP = 0.08;         // rate gain per second of buffer ABOVE the target
        const K_DN = 0.15;         // rate cut per second of buffer BELOW the target
        const DRIFT_CEIL = 22.0;   // stop rebuilding (let latency hold) once this far behind
        const DRIFT_SPAN = 6.0;    // ease the rebuild out over the seconds before the ceiling

        // Clamp defensively; the popup already caps the slider to [1, 6].
        const C = Math.min(6.0, Math.max(1.0, isFinite(center) ? center : 3.0));

        let buffer_ema = null;     // smoothed buffer health (same EMA as the classic controller)
        let last_rate = 1.0;

        function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

        // Signature mirrors the classic controller (speed/bufferTarget/auto are
        // ignored) so inject.js drives both through one code path.
        function calcPlaybackRate(_speed, latency, health) {
            if (!isFinite(health)) return (last_rate = 1.0);
            buffer_ema = buffer_ema === null ? health : buffer_ema * 0.9 + health * 0.1;
            const e = buffer_ema - C;   // + = surplus above target, - = deficit below it

            if (e >= 0) {
                // Surplus: play >1.0x to consume it, which trims latency toward
                // live. Zero at the target, so the buffer settles ON center.
                return (last_rate = 1.0 + Math.min(K_UP * e, MAX_RATE - 1.0));
            }
            // Deficit: play <1.0x to rebuild the cushion (fall back behind live),
            // hardest right at the target and easing toward the 0.90 floor. But
            // fade the slowdown out as latency climbs so a weak link can't keep
            // us slow while we drift ever further behind (30s skip is the backstop).
            const budget = isFinite(latency) ? clamp((DRIFT_CEIL - latency) / DRIFT_SPAN, 0, 1) : 1;
            return (last_rate = 1.0 - Math.min(K_DN * -e, 1.0 - SLOW_MIN) * budget);
        }

        function getState() {
            return {
                buffer_ema, center: C, rate: last_rate,
                catching_up: last_rate > 1.001,
                rebuilding: last_rate < 0.999,
            };
        }

        // Share the classic red-warn threshold so the health chip's color is
        // consistent no matter which controller is driving the stream.
        return { calcPlaybackRate, getState, center: C, WARN_BUFFER: 2.5 };
    }

    const api = { createController, createBandController };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        const zd = (window.ZeroDelay = window.ZeroDelay || {});
        zd.createController = createController;
        zd.createBandController = createBandController;
    }
}());
