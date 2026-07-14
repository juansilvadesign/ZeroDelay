// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Playback-rate adapter for the YouTube player API.
//
// The controller returns a continuous desired rate. This module owns the
// browser/player edge: quantizing to YouTube's accepted grid, respecting manual
// viewer speed changes, and keeping Gecko from receiving a rapid stream of
// tiny rate changes that can knock A/V sync out of phase.
'use strict';
(function () {
    const RATE_STEP = 0.05;
    const DIVERGENCE = 0.01;
    const GECKO_HOLD_MS = 900;

    function createRateApplier(options = {}) {
        const rateStep = Number.isFinite(options.rateStep) ? options.rateStep : RATE_STEP;
        const minHoldMs = Number.isFinite(options.minHoldMs)
            ? options.minHoldMs
            : (options.gecko ? GECKO_HOLD_MS : 0);
        const nowFn = typeof options.now === 'function' ? options.now : () => Date.now();

        let applied_rate = 1.0;
        let yielded_to_user = false;
        let last_write_ms = -Infinity;

        function quantizeRate(rate) {
            return Number((Math.round(rate / rateStep) * rateStep).toFixed(2));
        }

        function readPlayerRate(player) {
            const rate = Number(player?.getPlaybackRate?.());
            return Number.isFinite(rate) ? rate : applied_rate;
        }

        function syncVideoRate(video, rate) {
            if (!video || !Number.isFinite(rate)) return;
            try {
                if (Math.abs(video.playbackRate - rate) > DIVERGENCE) {
                    video.playbackRate = rate;
                }
            } catch {
                // Some media elements can reject a transient rate while YouTube is
                // rebuilding the player. The next tick will retry from the player
                // echo, so this should stay silent.
            }
        }

        function shouldHoldStep(grid, now) {
            if (!minHoldMs) return false;
            if (grid === 1.0 || applied_rate === 1.0) return false;
            if (Math.abs(grid - applied_rate) <= DIVERGENCE) return false;
            return now - last_write_ms < minHoldMs;
        }

        function adoptViewerRate(cur) {
            if (Math.abs(cur - applied_rate) <= DIVERGENCE) return;
            if (Math.abs(cur - 1.0) < DIVERGENCE) {
                applied_rate = 1.0;
                yielded_to_user = false;
            } else {
                yielded_to_user = true;
                applied_rate = cur;
            }
        }

        function apply(player, desired, video, now = nowFn()) {
            if (!player?.setPlaybackRate || !player?.getPlaybackRate) return false;

            adoptViewerRate(readPlayerRate(player));
            if (yielded_to_user) {
                syncVideoRate(video, applied_rate);
                return false;
            }

            const grid = quantizeRate(desired);
            if (shouldHoldStep(grid, now)) {
                syncVideoRate(video, applied_rate);
                return false;
            }

            if (Math.abs(grid - applied_rate) > DIVERGENCE) {
                player.setPlaybackRate(grid);
                applied_rate = readPlayerRate(player);
                last_write_ms = now;
            }

            syncVideoRate(video, applied_rate);
            return Math.abs(grid - applied_rate) <= DIVERGENCE;
        }

        function reset(player, video, now = nowFn()) {
            if (applied_rate === 1.0 || yielded_to_user) return false;
            return apply(player, 1.0, video, now);
        }

        function getState() {
            return { applied_rate, yielded_to_user, last_write_ms, minHoldMs };
        }

        return { apply, reset, getState, quantizeRate };
    }

    const api = { createRateApplier };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        const zd = (window.ZeroDelay = window.ZeroDelay || {});
        zd.createRateApplier = createRateApplier;
    }
}());
