// ZeroDelay — decorative pixel-dissolve scatter for the mode cards.
//
// Each mode card carries a <canvas class="card-scatter">. This draws a sparse,
// subtle field of solid square "pixels" onto it (ordered Bayer 4x4 dither),
// hugging the LEFT and RIGHT edges and thinning inward — the "degraded → sharp"
// motif, kept minimal. On open the blocks WAVE in from the edges toward the
// middle, pixel row by pixel row.
//
// Purely visual: no storage, messaging, or engine state; no remote resources or
// images (MV3-safe). Block colour comes from the CSS token --scatter, so it
// follows the light/dark theme. popup.js only adds the <canvas> element.

// 4x4 ordered dither matrix, normalised to 0..1.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);

const BLOCK = 6;       // px per scatter block (small = subtle)
const BAND = 4;        // how many blocks in from each L/R edge the scatter reaches
const DENSITY = 0.5;   // scales solidity down so the field stays sparse
const WAVE_MS = 650;   // one-time reveal duration

function scatterColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--scatter').trim() || '#5f5f5f';
}

// reveal 0..1 gates how far in from the edges the blocks have appeared.
function drawCard(canvas, reveal, color) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;

    const cols = Math.ceil(w / BLOCK);
    const rows = Math.ceil(h / BLOCK);

    for (let bx = 0; bx < cols; bx++) {
        const edge = Math.min(bx, cols - 1 - bx); // distance from nearest L/R edge
        if (edge >= BAND) continue;
        if (edge / BAND > reveal) continue;        // not reached by the wave yet
        const g = (1 - edge / BAND) * DENSITY;     // solidity, sparse
        for (let by = 0; by < rows; by++) {
            if (g <= BAYER4[(by % 4) * 4 + (bx % 4)]) continue;
            ctx.fillRect(bx * BLOCK, by * BLOCK, BLOCK, BLOCK);
        }
    }
}

function drawAll(canvases, reveal, color) {
    for (const c of canvases) drawCard(c, reveal, color);
}

function run(canvases) {
    const color = scatterColor();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
        drawAll(canvases, 1, color);
    } else {
        let start = null;
        const frame = ts => {
            if (start === null) start = ts;
            const reveal = Math.min(1, (ts - start) / WAVE_MS);
            drawAll(canvases, reveal, color);
            if (reveal < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    // Keep it correct on later size / theme changes (redraw fully settled).
    const redraw = () => drawAll(canvases, 1, scatterColor());
    window.addEventListener('resize', redraw);
    try {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
    } catch { /* older engines without MediaQueryList events: ignore */ }
}

function tryInit() {
    const canvases = [...document.querySelectorAll('.card-scatter')];
    if (!canvases.length || !canvases[0].getContext) return false;
    // Wait one frame so the cards have their final layout size.
    requestAnimationFrame(() => run(canvases));
    return true;
}

function start() {
    if (tryInit()) return;
    // Mode cards render asynchronously (popup.js awaits storage first) — watch
    // for them, then initialise once and stop observing.
    const mo = new MutationObserver(() => {
        if (tryInit()) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else {
    start();
}
