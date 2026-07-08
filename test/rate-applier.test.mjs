// Tests for the YouTube playback-rate adapter (engine/rate-applier.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ratePkg from '../engine/rate-applier.js';
const { createRateApplier } = ratePkg;

function fakePlayer(initial = 1.0) {
    return {
        rate: initial,
        calls: [],
        getPlaybackRate() { return this.rate; },
        setPlaybackRate(rate) {
            this.calls.push(rate);
            this.rate = rate;
        },
    };
}

function fakeVideo(initial = 1.0) {
    return { playbackRate: initial };
}

test('quantizes to the YouTube 0.05 grid and adopts the player echo', () => {
    const player = fakePlayer();
    const video = fakeVideo();
    const a = createRateApplier();

    a.apply(player, 1.0375, video, 0);
    assert.deepEqual(player.calls, [1.05]);
    assert.equal(a.getState().applied_rate, 1.05);
    assert.equal(video.playbackRate, 1.05);
});

test('yields to a manual viewer speed until the player returns to 1.0x', () => {
    const player = fakePlayer();
    const video = fakeVideo();
    const a = createRateApplier();

    a.apply(player, 1.25, video, 0);
    player.rate = 1.5; // viewer picked a speed in YouTube's own menu
    a.apply(player, 1.1, video, 250);
    assert.deepEqual(player.calls, [1.25]);
    assert.equal(a.getState().yielded_to_user, true);

    player.rate = 1.0;
    a.apply(player, 1.1, video, 500);
    assert.equal(a.getState().yielded_to_user, false);
    assert.deepEqual(player.calls, [1.25, 1.1]);
});

test('Gecko holds stepped acceleration briefly but resets to 1.0x immediately', () => {
    const player = fakePlayer();
    const video = fakeVideo();
    const a = createRateApplier({ gecko: true });

    a.apply(player, 1.05, video, 0);
    a.apply(player, 1.1, video, 250);
    a.apply(player, 1.15, video, 700);
    assert.deepEqual(player.calls, [1.05], 'rate steps are held during the Gecko settle window');
    assert.equal(video.playbackRate, 1.05);

    a.apply(player, 1.15, video, 950);
    assert.deepEqual(player.calls, [1.05, 1.15], 'next acceleration step applies after the hold');

    a.apply(player, 1.0, video, 1000);
    assert.deepEqual(player.calls, [1.05, 1.15, 1.0], 'resting at normal speed is never delayed');
    assert.equal(video.playbackRate, 1.0);
});

test('keeps the media element synced with the current player rate', () => {
    const player = fakePlayer();
    const video = fakeVideo();
    const a = createRateApplier();

    a.apply(player, 1.25, video, 0);
    assert.equal(video.playbackRate, 1.25);

    video.playbackRate = 1.0; // YouTube rebuilt/swapped media state between ticks
    a.apply(player, 1.25, video, 250);
    assert.equal(video.playbackRate, 1.25);
    assert.deepEqual(player.calls, [1.25]);
});
