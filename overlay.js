// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// In-player donation MOTION (PAGE WORLD, injected by content.js with the engine).
// NOT a modal — a small broadcast-style graphic: a "live seal" ball bounces into
// the corner and blooms into a ZeroDelay card, holds a few seconds, and retracts on
// its own. Clearly ZeroDelay's own (never disguised as the stream). content.js owns
// the gating (it has chrome.storage) and only fires this for an engaged,
// non-opted-out viewer at a calm moment, once per session:
//   in:  document event `_zd_donation_show`  { pixCode, strings:{kicker,pix,aria} }
//   out: document event `_zd_donation_close` { reason: 'auto'|'dismiss' }
(() => {
    'use strict';
    const NS = 'zd-tip';
    let el = null, hideT = 0, outT = 0, player = null, dodge = null;

    // QR generator (Kazuhiko Arase, vendor/qrcode.js) — a page-world global,
    // injected just before this. Build the SVG with DOM APIs (createElementNS),
    // NEVER by parsing a markup string: this runs inside YouTube's page, whose
    // Trusted Types CSP blocks string-to-DOM sinks (DOMParser/innerHTML). We use
    // only the library's pure math (getModuleCount/isDark) and lay out the modules
    // in module units, letting CSS scale the viewBox to the tile.
    function qrNode(code) {
        if (typeof window.qrcode !== 'function' || !code) return null;
        try {
            const q = window.qrcode(0, 'M');
            q.addData(code); q.make();
            const n = q.getModuleCount();
            const M = 2;                 // quiet-zone modules (scanners need clear margin)
            const size = n + M * 2;
            const NSVG = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NSVG, 'svg');
            svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
            svg.setAttribute('shape-rendering', 'crispEdges');
            const bg = document.createElementNS(NSVG, 'rect');
            bg.setAttribute('width', String(size));
            bg.setAttribute('height', String(size));
            bg.setAttribute('fill', '#fff');
            svg.appendChild(bg);
            let d = '';
            for (let r = 0; r < n; r += 1) {
                for (let c = 0; c < n; c += 1) {
                    if (q.isDark(r, c)) d += 'M' + (c + M) + ',' + (r + M) + 'h1v1h-1z';
                }
            }
            const path = document.createElementNS(NSVG, 'path');
            path.setAttribute('d', d);
            path.setAttribute('fill', '#000');
            svg.appendChild(path);
            return svg;
        } catch { return null; }
    }

    // A little soccer ball (SVG, DOM-built so it clears YouTube's Trusted Types):
    // a shaded white sphere with the classic centre pentagon, five rim patches
    // (clipped by the silhouette like a real ball), seams, and a gloss highlight.
    function soccerBall() {
        const NSVG = 'http://www.w3.org/2000/svg';
        const rad = a => a * Math.PI / 180;
        const mk = (tag, attrs) => { const e = document.createElementNS(NSVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
        const pent = (px, py, r, rot) => {
            let p = '';
            for (let k = 0; k < 5; k += 1) {
                const a = rad(rot + k * 72);
                p += (k ? 'L' : 'M') + (px + r * Math.cos(a)).toFixed(1) + ',' + (py + r * Math.sin(a)).toFixed(1);
            }
            return p + 'Z';
        };
        const dirs = [-90, -18, 54, 126, 198];
        let patchD = pent(50, 50, 15, -90);   // centre pentagon (a vertex pointing up)
        let seamD = '';
        dirs.forEach(dir => {
            const a = rad(dir);
            patchD += pent(50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a), 12, dir + 180);   // rim patch (flat edge out), clipped
            seamD += 'M' + (50 + 15 * Math.cos(a)).toFixed(1) + ',' + (50 + 15 * Math.sin(a)).toFixed(1)
                   + 'L' + (50 + 33 * Math.cos(a)).toFixed(1) + ',' + (50 + 33 * Math.sin(a)).toFixed(1);
        });
        const svg = mk('svg', { viewBox: '0 0 100 100' });
        const defs = mk('defs', {});
        const grad = mk('radialGradient', { id: 'zd-ball-grad', cx: '38%', cy: '32%', r: '72%' });
        grad.appendChild(mk('stop', { offset: '0%', 'stop-color': '#ffffff' }));
        grad.appendChild(mk('stop', { offset: '68%', 'stop-color': '#e9eaec' }));
        grad.appendChild(mk('stop', { offset: '100%', 'stop-color': '#b7bbc2' }));
        defs.appendChild(grad);
        const clip = mk('clipPath', { id: 'zd-ball-clip' });
        clip.appendChild(mk('circle', { cx: 50, cy: 50, r: 47 }));
        defs.appendChild(clip);
        svg.appendChild(defs);
        svg.appendChild(mk('circle', { cx: 50, cy: 50, r: 47, fill: 'url(#zd-ball-grad)', stroke: '#0c0c0c', 'stroke-width': 2 }));
        const g = mk('g', { 'clip-path': 'url(#zd-ball-clip)' });
        g.appendChild(mk('path', { d: patchD, fill: '#161616' }));
        g.appendChild(mk('path', { d: seamD, stroke: '#161616', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }));
        svg.appendChild(g);
        svg.appendChild(mk('ellipse', { cx: 35, cy: 29, rx: 15, ry: 9, fill: '#ffffff', opacity: '0.35', transform: 'rotate(-35 35 29)' }));
        return svg;
    }

    function styleOnce() {
        if (document.getElementById(NS + '-css')) return;
        const s = document.createElement('style');
        s.id = NS + '-css';
        s.textContent = `
.${NS}{
  position:absolute; right:16px; bottom:16px; z-index:40; width:92px;
  font-family:"Roboto","Segoe UI",system-ui,sans-serif; cursor:pointer;
  transition:opacity .3s ease;
}
.${NS}.out{ opacity:0; transform:scale(.5); transform-origin:100% 100%;
  transition:opacity .3s ease, transform .3s ease; }

/* Phase 1: a soccer ball rolls in from the SIDE, bounces, and bursts. */
.${NS}-ball{
  position:absolute; right:6px; bottom:8px; width:26px; height:26px;
  filter:drop-shadow(0 4px 6px rgba(0,0,0,.5)); opacity:0;
  animation:${NS}-roll 1.15s cubic-bezier(.33,.66,.4,1) forwards;
}
.${NS}-ball svg{ display:block; width:100%; height:100%; }
@keyframes ${NS}-roll{
  0%{ transform:translate(135px,0) rotate(0deg); opacity:0; }
  8%{ opacity:1; }
  38%{ transform:translate(16px,0) rotate(-470deg); }
  48%{ transform:translate(5px,-14px) rotate(-545deg); }
  60%{ transform:translate(0,0) rotate(-620deg); }
  69%{ transform:translate(0,-6px) rotate(-660deg); }
  78%{ transform:translate(0,0) rotate(-690deg); }
  87%{ transform:translate(0,0) rotate(-700deg) scale(1.45); opacity:1; }
  100%{ transform:translate(0,0) rotate(-712deg) scale(2.7); opacity:0; }
}

/* Phase 2: the card blooms out of the burst, from the corner. */
.${NS}-card{
  border-radius:7px; overflow:hidden; filter:drop-shadow(0 5px 13px rgba(0,0,0,.5));
  transform-origin:100% 100%;
  animation:${NS}-bloom .5s cubic-bezier(.2,.9,.25,1.3) .82s backwards;
}
@keyframes ${NS}-bloom{
  0%{ transform:scale(.15); opacity:0; }
  55%{ opacity:1; }
  78%{ transform:scale(1.07); }
  100%{ transform:scale(1); opacity:1; }
}
.${NS}-card:hover{ transform:translateY(-1px); }

/* header = WHO you're supporting: "Apoie o" + the ZeroDelay wordmark (o = seal). */
.${NS}-hd{
  background:linear-gradient(90deg,#ff0033,#c4002a); color:#fff;
  padding:4px 5px 5px; text-align:center; position:relative; overflow:hidden;
}
.${NS}-kicker{ font-size:6.5px; font-weight:700; letter-spacing:1px;
  text-transform:uppercase; opacity:.85; }
.${NS}-brand{ display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:800; letter-spacing:.2px; line-height:1.15; }
.${NS}-o{ width:6px; height:6px; border-radius:50%; background:#fff; margin:0 .5px;
  box-shadow:0 0 4px rgba(255,255,255,.95); animation:${NS}-pulse 2s ease infinite; }
@keyframes ${NS}-pulse{ 0%,100%{opacity:1} 50%{opacity:.45} }
/* QR + the HOW: PIX. */
.${NS}-qr{ background:#fff; padding:5px 5px 2px; }
.${NS}-qr svg{ display:block; width:100%; height:100%; }
.${NS}-pix{ background:#fff; color:#0b0b0b; text-align:center;
  font-size:7px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase; padding:0 0 4px; }
`;
        (document.head || document.documentElement).appendChild(s);
    }

    function close(reason) {
        if (!el) return;
        clearTimeout(hideT); clearTimeout(outT);
        if (dodge) { dodge.disconnect(); dodge = null; }
        const node = el; el = null;
        node.classList.add('out');
        outT = setTimeout(() => node.remove(), 340);
        document.dispatchEvent(new CustomEvent('_zd_donation_close', { detail: { reason } }));
    }

    // Get out of the way while the YouTube controls are up (never sit over them).
    function sync() {
        if (!el || !player) return;
        const up = !player.classList.contains('ytp-autohide');
        el.style.opacity = up ? '0' : '';
        el.style.pointerEvents = up ? 'none' : 'auto';
    }

    // Fullscreen: keep the motion inside whatever element went fullscreen so it
    // renders there too. On YouTube that IS #movie_player (our host), so this is a
    // no-op in the common case and a safety net otherwise.
    function place() {
        if (!el) return;
        const host = document.fullscreenElement || player;
        if (host && !host.contains(el)) host.appendChild(el);
    }

    function show(detail) {
        player = document.getElementById('movie_player');
        if (!player || el) return;
        const qr = qrNode(detail && detail.pixCode);
        if (!qr) return; // no lib / no code -> skip silently (engine unaffected)
        const str = (detail && detail.strings) || {};
        styleOnce();

        el = document.createElement('div');
        el.className = NS;
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        el.setAttribute('aria-label', str.aria || 'Apoie o ZeroDelay via PIX');

        const ball = document.createElement('div');
        ball.className = NS + '-ball';
        ball.appendChild(soccerBall());

        const card = document.createElement('div');
        card.className = NS + '-card';

        const hd = document.createElement('div');
        hd.className = NS + '-hd';
        const kicker = document.createElement('div');
        kicker.className = NS + '-kicker';
        kicker.textContent = str.kicker || 'Apoie o';
        const brand = document.createElement('div');
        brand.className = NS + '-brand';
        const seal = document.createElement('span'); seal.className = NS + '-o';
        brand.append('Zer', seal, 'Delay');   // ZeroDelay wordmark: the "o" is the live seal
        hd.append(kicker, brand);

        const box = document.createElement('div');
        box.className = NS + '-qr';
        box.appendChild(qr);

        const pix = document.createElement('div');
        pix.className = NS + '-pix';
        pix.textContent = str.pix || 'PIX';

        card.append(hd, box, pix);
        el.append(ball, card);
        el.addEventListener('click', () => close('dismiss'));
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close('dismiss'); } });
        player.appendChild(el);
        place();   // if we're already fullscreen on a non-player element, ride it

        hideT = setTimeout(() => close('auto'), 9000);  // motion retires on its own
        sync();
        dodge = new MutationObserver(sync);
        dodge.observe(player, { attributes: true, attributeFilter: ['class'] });
    }

    document.addEventListener('_zd_donation_show', e => show(e.detail || {}));
    document.addEventListener('_zd_donation_hide', () => close('auto'));
    // Follow the player in and out of fullscreen (and re-sync the controls dodge).
    document.addEventListener('fullscreenchange', () => { place(); sync(); });
})();
