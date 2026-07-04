#!/usr/bin/env node
// sim-live.mjs — simulate the ZeroDelay controller under CazeTV-like live conditions
// (2s segments, head-of-line jitter, pipeline latency floor). Born from the jul/2026
// "1.05x with a dying buffer" investigation; acceptance bar: suave/balanced/auto with
// ZERO stalls and median buffer ~ the mode's target. Compare against the old
// controller with: git show 5f0f420:engine/controller.js > /tmp/old.cjs
//
// Usage: node scripts/sim-live.mjs [path-to-controller.js]   (default: the repo's)
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

const controllerPath = resolve(
    process.cwd(),
    process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), '../engine/controller.js'),
);
const { createController } = require(controllerPath);

// ---- fixed simulation model (per spec, identical across agents) ----
const DT = 0.25;            // s per tick (engine setInterval 250ms)
const TICKS = 7200;         // 30 minutes
const PF = 6.5;             // pipeline floor: encoder+CDN latency, L can never go below
const SEG = 2.0;            // media arrives in 2.0s segments
const DLX = 6;              // download speed = 6x real time
const JITTER_P = 0.08;      // 8% of segments delayed
const JITTER_MIN = 1.0, JITTER_MAX = 2.5;
const WARMUP = 480;         // ignore first 2 minutes (ticks)
const SPEED = 1.25;         // mode max rate handed to the controller

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sortedArr, q) {
  if (!sortedArr.length) return NaN;
  const pos = (sortedArr.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (pos - lo);
}

function simulate({ name, target, auto, jitterProb }) {
  const rand = mulberry32(42);           // fresh PRNG per mode: identical network trace
  const ctrl = createController();       // fresh controller per mode: independent state
  let L = 12.0;                          // latency (s)
  let B = 6.0;                           // buffer health (s downloaded ahead of playhead)
  // U (published, not yet downloaded) = max(0, L - PF - B) = max(0, -0.5) = 0 at init.
  let pubAcc = 0;                        // partial segment still being published
  const queue = [];                      // released segments: {remaining, ready}
  let stalled = false;
  const stalls = [];                     // {startTick, endTick|null}
  const hist = new Array(TICKS);         // {t, L(pre-playback), B(as controller sees it), r, stalled}

  for (let i = 0; i < TICKS; i++) {
    const t = i * DT;

    // 1) live edge publishes new media
    pubAcc += DT;
    while (pubAcc >= SEG - 1e-9) {       // release fully-published 2.0s segments
      pubAcc -= SEG;
      let delay = 0;
      if (rand() < jitterProb) delay = JITTER_MIN + rand() * (JITTER_MAX - JITTER_MIN);
      queue.push({ remaining: SEG, ready: t + delay });
    }

    // 2) network downloads U -> B at up to 6x real time, head-of-line:
    //    while the head segment is delayed, nothing is downloaded.
    let budget = DLX * DT;
    while (budget > 1e-9 && queue.length && queue[0].ready <= t + 1e-9) {
      const take = Math.min(budget, queue[0].remaining);
      queue[0].remaining -= take;
      B += take;
      budget -= take;
      if (queue[0].remaining <= 1e-9) queue.shift();
    }

    const bIn = B, lIn = L;              // what the controller sees this tick

    // 3) controller decides the rate (called every tick, like the real engine loop)
    const r = ctrl.calcPlaybackRate(SPEED, L, B, target, auto);

    // 4) stall / playback
    if (stalled && B >= 1.0) {           // stall ends once 1.0s of buffer is back
      stalled = false;
      stalls[stalls.length - 1].endTick = i;
    }
    if (stalled) {
      L += DT;                           // playhead frozen, live edge advances
    } else {
      B -= r * DT;
      L -= (r - 1) * DT;
      if (B <= 0) {
        B = 0;
        stalled = true;
        stalls.push({ startTick: i, endTick: null });
      }
    }
    if (L < PF) L = PF;

    hist[i] = { t, L: lIn, B: bIn, r, stalled };
  }

  // ---- metrics (post-warmup) ----
  const post = hist.slice(WARMUP);
  const Bs = post.map(h => h.B).sort((a, b) => a - b);
  const Ls = post.map(h => h.L).sort((a, b) => a - b);
  const n = post.length;
  const grindTicks = post.filter(h => h.r > 1.001 && h.r <= 1.08).length;
  const fastTicks = post.filter(h => h.r > 1.15).length;

  const postStalls = stalls.filter(s => s.startTick >= WARMUP);
  // max B reached within 60s (240 ticks) after each stall's end
  const postStallMaxB = [];
  const stallDurs = [];
  for (const s of stalls) {
    if (s.endTick === null) continue;
    stallDurs.push((s.endTick - s.startTick) * DT);
    let mx = 0;
    for (let j = s.endTick; j < Math.min(TICKS, s.endTick + 240); j++) {
      if (hist[j].B > mx) mx = hist[j].B;
    }
    postStallMaxB.push(mx);
  }

  // distribution of r when the controller saw B between 1.5 and 2.5
  const band = post.filter(h => h.B > 1.5 && h.B < 2.5).map(h => h.r).sort((a, b) => a - b);
  const buckets = {
    'r<=1.001': 0, '1.001-1.02': 0, '1.02-1.04': 0, '1.04-1.06': 0,
    '1.06-1.08': 0, '1.08-1.15': 0, 'r>1.15': 0,
  };
  for (const r of band) {
    if (r <= 1.001) buckets['r<=1.001']++;
    else if (r <= 1.02) buckets['1.001-1.02']++;
    else if (r <= 1.04) buckets['1.02-1.04']++;
    else if (r <= 1.06) buckets['1.04-1.06']++;
    else if (r <= 1.08) buckets['1.06-1.08']++;
    else if (r <= 1.15) buckets['1.08-1.15']++;
    else buckets['r>1.15']++;
  }
  const bucketPct = {};
  for (const k of Object.keys(buckets)) {
    bucketPct[k] = band.length ? +(100 * buckets[k] / band.length).toFixed(1) : 0;
  }

  const round = x => +x.toFixed(3);
  const metrics = {
    mode: name,
    stall_count: postStalls.length,
    stall_count_total_incl_warmup: stalls.length,
    mean_stall_duration_s: stallDurs.length ? round(stallDurs.reduce((a, b) => a + b, 0) / stallDurs.length) : null,
    median_B: round(quantile(Bs, 0.5)),
    p10_B: round(quantile(Bs, 0.1)),
    min_B: round(Bs[0]),
    pct_ticks_r_1p001_to_1p08: round(100 * grindTicks / n),
    pct_ticks_r_gt_1p15: round(100 * fastTicks / n),
    median_L: round(quantile(Ls, 0.5)),
    mean_max_B_within_60s_after_stall: postStallMaxB.length
      ? round(postStallMaxB.reduce((a, b) => a + b, 0) / postStallMaxB.length) : null,
    r_dist_when_B_1p5_to_2p5: {
      ticks_in_band: band.length,
      pct_of_post_warmup_ticks: round(100 * band.length / n),
      median_r: band.length ? round(quantile(band, 0.5)) : null,
      p90_r: band.length ? round(quantile(band, 0.9)) : null,
      histogram_pct: bucketPct,
    },
  };
  return { metrics, hist, stalls };
}

// ---- runs ----
const runs = [
  { name: 'suave',         target: 5, auto: false, jitterProb: JITTER_P },
  { name: 'balanced',      target: 4, auto: false, jitterProb: JITTER_P },
  { name: 'aggressive',    target: 3, auto: false, jitterProb: JITTER_P },
  { name: 'extreme',       target: 2, auto: false, jitterProb: JITTER_P },
  { name: 'auto',          target: 6, auto: true,  jitterProb: JITTER_P },
  { name: 'suave_perfect', target: 5, auto: false, jitterProb: 0.0 },
];

const results = {};
let suaveRun = null;
for (const cfg of runs) {
  const out = simulate(cfg);
  results[cfg.name] = out.metrics;
  if (cfg.name === 'suave') suaveRun = out;
}

console.log('=== ZeroDelay controller simulation (' + controllerPath + ') ===');
console.log(JSON.stringify(results, null, 2));

// ---- excerpt: ~60 ticks around the first stall of the suave mode ----
const firstStall = suaveRun.stalls[0];
if (firstStall) {
  const s = firstStall.startTick;
  const from = Math.max(0, s - 40), to = Math.min(TICKS - 1, s + 19);
  console.log('\n=== suave: first stall excerpt (stall starts at t=' + (s * DT).toFixed(2) + 's) ===');
  console.log('t(s)\tL\tB\tr\tstalled');
  for (let i = from; i <= to; i++) {
    const h = suaveRun.hist[i];
    console.log(
      h.t.toFixed(2) + '\t' + h.L.toFixed(3) + '\t' + h.B.toFixed(3) + '\t' +
      h.r.toFixed(4) + '\t' + (h.stalled ? 'STALL' : '')
    );
  }
} else {
  console.log('\n(suave mode never stalled)');
}
