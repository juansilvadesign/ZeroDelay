// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Canary: loads the UNPACKED extension on a real 24/7 live stream and checks
// the two things user bug reports can only tell us AFTER the damage is done:
//
//   1. YouTube's PRIVATE player APIs the engine depends on still exist
//      (the same list inject.js probes into `caps` — the project's single
//      biggest existential risk is YouTube renaming one of them);
//   2. the engine actually comes alive on the stream: the diagnostics bridge
//      (engine/telemetry.js) answers with ok + live samples and no degraded
//      flag.
//
// Runs nightly in CI (.github/workflows/canary.yml) and on demand locally:
//   npm run canary                 # headless
//   CANARY_HEADED=1 npm run canary # watch it happen
//   CANARY_VIDEO=<id> npm run canary
//
// Honest caveat: YouTube behaves differently toward datacenter IPs (consent
// walls, robot checks, regional ads). The script retries with a fresh browser
// and the workflow only *files an issue*, never fails a build — treat a red
// canary as "verify locally", not "the sky fell".
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('..', import.meta.url));

// Lofi Girl's "beats to relax/study to" — streaming 24/7 for years, the
// closest thing YouTube has to a live-stream test fixture. Overridable when
// it finally sleeps: CANARY_VIDEO=<videoId>.
const VIDEO_ID = process.env.CANARY_VIDEO || 'jfKfPfyJRdk';
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;

const ATTEMPTS = 2;                 // fresh browser per attempt
const PLAYER_TIMEOUT_MS = 90_000;   // #movie_player appearing
const ENGINE_DEADLINE_MS = 150_000; // engine alive + sampling (pre-roll ads eat time)
const MIN_SAMPLES = 5;              // ~5s of real live ticking

// The exact private-API surface inject.js probes into `caps` — keep in sync.
const REQUIRED_APIS = [
    'getStatsForNerds', 'getProgressState', 'getVideoData', 'setPlaybackRate',
    'getPlaybackRate', 'seekToLiveHead', 'playVideo', 'getPlayerStateObject',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
    return puppeteer.launch({
        // Chrome's new headless supports extensions; set CANARY_HEADED=1 to watch.
        headless: !process.env.CANARY_HEADED,
        args: [
            `--disable-extensions-except=${root}`,
            `--load-extension=${root}`,
            '--autoplay-policy=no-user-gesture-required',
            '--mute-audio',
            '--window-size=1280,800',
            ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
        ],
    });
}

// EU consent wall: the SOCS cookie skips it; the click is the fallback when
// YouTube ships a variant the cookie doesn't cover.
async function dodgeConsent(browser, page) {
    await browser.setCookie({
        name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/',
        secure: true, sameSite: 'None', expires: Math.floor(Date.now() / 1000) + 3600 * 24 * 30,
    }).catch(() => { });
    const clickConsent = async () => {
        for (const label of ['Accept all', 'Aceitar tudo', 'Reject all']) {
            const clicked = await page.evaluate(text => {
                const btn = [...document.querySelectorAll('button')]
                    .find(b => (b.textContent || '').trim().toLowerCase().includes(text.toLowerCase()));
                if (btn) { btn.click(); return true; }
                return false;
            }, label).catch(() => false);
            if (clicked) return true;
        }
        return false;
    };
    if (page.url().includes('consent.')) {
        await clickConsent();
        await sleep(3000);
    }
}

// Probe the private player APIs in the page's MAIN world (same surface as
// inject.js's probe_caps) plus live-stats and playability sanity reads —
// `playability` tells a human whether a red run means "stream is down" or
// "YouTube served this network a degraded page" (datacenter IPs get those).
function probePlayer(page) {
    return page.evaluate(apis => {
        const p = document.getElementById('movie_player');
        if (!p) return null;
        const caps = {};
        for (const name of apis) caps[name] = typeof p[name] === 'function';
        let liveLatency = null, isLive = null, playability = null;
        try {
            const s = typeof p.getStatsForNerds === 'function' ? p.getStatsForNerds() : null;
            if (s) liveLatency = parseFloat(s.live_latency_secs);
        } catch { /* probed as missing below */ }
        try {
            const vd = typeof p.getVideoData === 'function' ? p.getVideoData() : null;
            if (vd) isLive = vd.isLive === true;
        } catch { /* ditto */ }
        try {
            const pr = typeof p.getPlayerResponse === 'function' ? p.getPlayerResponse() : null;
            playability = pr?.playabilityStatus?.status || null;   // e.g. OK / UNPLAYABLE / LOGIN_REQUIRED
        } catch { /* informational only */ }
        return { caps, liveLatency: Number.isFinite(liveLatency) ? liveLatency : null, isLive, playability };
    }, REQUIRED_APIS).catch(() => null);
}

// Round-trip the extension's own diagnostics bridge: proves content script +
// engine + telemetry are alive on this stream, and returns real engine data.
function requestDiagnostics(page) {
    return page.evaluate(() => new Promise(resolve => {
        const onResp = e => {
            document.removeEventListener('_zd_diag_response', onResp);
            resolve(e.detail || null);
        };
        document.addEventListener('_zd_diag_response', onResp);
        document.dispatchEvent(new CustomEvent('_zd_diag_request'));
        setTimeout(() => {
            document.removeEventListener('_zd_diag_response', onResp);
            resolve(null);
        }, 2000);
    })).catch(() => null);
}

async function attempt(n) {
    const browser = await launch();
    const failures = [];
    let probe = null, diag = null;
    try {
        const page = await browser.newPage();
        await dodgeConsent(browser, page);
        await page.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await dodgeConsent(browser, page);

        await page.waitForSelector('#movie_player', { timeout: PLAYER_TIMEOUT_MS });

        // Nudge playback: stats only flow while the video plays.
        await page.evaluate(() => {
            const p = document.getElementById('movie_player');
            if (p && typeof p.playVideo === 'function') p.playVideo();
        }).catch(() => { });

        // Give the page a moment to hydrate the player methods, then probe.
        await sleep(5000);
        probe = await probePlayer(page);
        if (!probe) {
            failures.push('#movie_player exists but could not be probed');
        } else {
            for (const [name, ok] of Object.entries(probe.caps)) {
                if (!ok) failures.push(`private player API missing: ${name}()`);
            }
        }

        // Engine liveness: poll the diagnostics bridge until it reports live
        // samples (pre-roll ads and slow CI machines legitimately delay this).
        // Keep re-probing the player so the report reflects the FINAL state,
        // not the five-second snapshot.
        const deadline = Date.now() + ENGINE_DEADLINE_MS;
        while (Date.now() < deadline) {
            diag = await requestDiagnostics(page);
            if (diag && diag.ok && !diag.degraded && (diag.samples?.length || 0) >= MIN_SAMPLES) break;
            const again = await probePlayer(page);
            if (again) probe = again;
            await sleep(5000);
        }
        if (probe && probe.isLive === false) {
            failures.push(`video ${VIDEO_ID} did not play as LIVE here (playability: ${probe.playability || 'unknown'}) — `
                + 'either the stream is down (repoint CANARY_VIDEO) or YouTube served this network a degraded page (verify locally)');
        }
        if (!diag) {
            failures.push('engine never answered the diagnostics bridge (content script dead, or stream never ticked as live)');
        } else if (diag.degraded) {
            failures.push('engine reports DEGRADED — the player API surface changed under it');
        } else if ((diag.samples?.length || 0) < MIN_SAMPLES) {
            failures.push(`engine answered but sampled only ${diag.samples?.length || 0} live ticks (< ${MIN_SAMPLES})`);
        }
        if (diag && diag.ok && probe && probe.liveLatency == null) {
            failures.push('getStatsForNerds().live_latency_secs no longer parses as a number');
        }
    } catch (e) {
        failures.push(`attempt crashed: ${e?.message || e}`);
    } finally {
        await browser.close().catch(() => { });
    }
    return { attempt: n, failures, probe, diag };
}

const runs = [];
let verdict = null;
for (let n = 1; n <= ATTEMPTS; n++) {
    console.log(`canary — attempt ${n}/${ATTEMPTS} on ${WATCH_URL}`);
    const result = await attempt(n);
    runs.push(result);
    if (result.failures.length === 0) { verdict = 'pass'; break; }
    console.error(`  attempt ${n} failed:\n    - ${result.failures.join('\n    - ')}`);
}
verdict = verdict || 'fail';

const report = {
    verdict,
    video: VIDEO_ID,
    at: new Date().toISOString(),
    runs: runs.map(r => ({
        attempt: r.attempt,
        failures: r.failures,
        caps: r.probe?.caps || null,
        isLive: r.probe?.isLive ?? null,
        playability: r.probe?.playability ?? null,
        liveLatency: r.probe?.liveLatency ?? null,
        engine: r.diag ? {
            degraded: !!r.diag.degraded,
            samples: r.diag.samples?.length || 0,
            appliedRate: r.diag.appliedRate ?? null,
            session: r.diag.session || null,
        } : null,
    })),
};
writeFileSync(join(root, 'canary-report.json'), JSON.stringify(report, null, 2));
console.log(`canary — ${verdict.toUpperCase()} (report: canary-report.json)`);
if (verdict !== 'pass') process.exit(1);
