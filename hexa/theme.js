// ZeroDelay — MODO HEXA
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// A green/yellow World Cup theme that reskins the YouTube page while a live
// Brazil match is on screen. Imported by content.js (isolated world) via
// chrome.runtime.getURL — so it is pure DOM with NO chrome.* APIs.
//
// The whole theme lives in ONE <style> whose rules are scoped under a single
// root class `html.zd-hexa`. Applying/removing the theme is therefore just
// `document.documentElement.classList.toggle('zd-hexa', on)` — atomic, instant,
// fully reversible, and it survives YouTube's SPA re-renders (YouTube never
// tears down <html>). The style node is inserted once (dormant) at install().
//
// It NEVER recolors the video itself — only the page chrome (masthead, page
// background, buttons, chat, and the player's control-bar accents). The
// decorative nodes (the masthead badge, the GOL! button, the activation toast)
// are created in JS with textContent only (no innerHTML → TrustedTypes-safe,
// same reason the donation banners avoid it) and removed on deactivate.

const STYLE_ID = '_modo_hexa';
const ROOT_CLASS = 'zd-hexa';
// Optional "full theme" sub-toggle: the broad green repaint of the whole page.
// OFF by default — the base theme stays narrow (player + masthead accent + the
// branded nodes) to avoid noise and impersonating YouTube.
const FULL_CLASS = 'zd-hexa-full';
// Overshoot spring, same feel as the extension's popup (--spring).
const SPRING = 'cubic-bezier(.2,.9,.25,1.18)';

// Brazil flag palette. Yellow is used for FILLS/graphics only (never body text
// — #FFDF00 on light is unreadable); accent text uses the softer canary #FFE44D.
const CSS = `
/* ===== CORE (always on with .zd-hexa): a NARROW accent, not a repaint ==========
   It dresses the user's page (player + a masthead accent + the branded nodes); it
   does not recolor YouTube's chrome. Less noise, and no "is this the real
   YouTube?" ambiguity — the badge keeps it attributed to ZeroDelay. */
/* Progress bar: a slow tricolor gradient that shimmers along, so it reads as the
   selecao's colors flowing, not a flat yellow "ad" bar. The LIVE badge is left
   untouched on purpose — its red = "you're at the live edge", which is exactly
   what the extension delivers; tinting it yellow would fight the whole product. */
html.${ROOT_CLASS} .ytp-play-progress{
  background-image:linear-gradient(90deg,#00A63F,#FFE14D,#2f7bff,#FFE14D,#00A63F)!important;
  background-size:300% 100%!important;
  animation:zd-hexa-bar 5s linear infinite!important;
}
html.${ROOT_CLASS} .ytp-scrubber-button{background:#FFE14D!important;box-shadow:0 0 0 2px rgba(0,39,118,.5)!important;}
html.${ROOT_CLASS} .ytp-load-progress{background:rgba(0,39,118,.85)!important;}
@keyframes zd-hexa-bar{from{background-position:0 0;}to{background-position:300% 0;}}
/* Masthead accent = the bunting garland below (no coloured border line, which
   clashed with the flags' own string). */
/* Bunting garland (varal de bandeirinhas) hanging from the masthead — the flags
   are pennants cycling green/yellow/blue, swaying gently; it drops in on boot. */
.zd-hexa-bunting{
  position:fixed;left:0;right:0;top:55px;height:40px;z-index:1800;pointer-events:none;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='132' height='44' viewBox='0 0 132 44'%3E%3Cpath d='M0 5Q66 22 132 5' fill='none' stroke='%230b3b22' stroke-width='2'/%3E%3Cpolygon points='10,9 34,9 34,32 22,21 10,32' fill='%2300A63F'/%3E%3Cpolygon points='54,14 78,14 78,28 66,38 54,28' fill='%23FFDF00'/%3E%3Cpolygon points='98,9 122,9 122,32 110,21 98,32' fill='%23002776'/%3E%3C/svg%3E") repeat-x left top;
  background-size:132px 44px;animation:zd-hexa-drop .5s ${SPRING} both;
}
@keyframes zd-hexa-drop{from{transform:translateY(-22px);opacity:0;}to{transform:translateY(0);opacity:1;}}

/* ===== FULL THEME (opt-in sub-toggle .zd-hexa-full, OFF by default) =============
   The broad green repaint of the whole page (backgrounds, buttons, chips, chat).
   Behind a flag so it never applies by default — it is the loudest, most
   "YouTube-looking" part, so it stays a deliberate choice. */
html.${ROOT_CLASS}.${FULL_CLASS}{
  --yt-spec-base-background:#04140A!important;
  --yt-spec-raised-background:#0A2414!important;
  --yt-spec-menu-background:#0A2414!important;
  --yt-spec-general-background-a:#0A2414!important;
  --yt-spec-general-background-b:#071B0F!important;
  --yt-spec-general-background-c:#02100A!important;
  --yt-spec-additive-background:#0F3018!important;
  --yt-spec-brand-background-primary:#02391C!important;
  --yt-spec-brand-background-solid:#02391C!important;
  --yt-spec-text-primary:#FFF6D5!important;
  --yt-spec-text-secondary:#CFE3C9!important;
  --yt-spec-call-to-action:#FFE44D!important;
  --yt-spec-themed-blue:#FFE44D!important;
  --yt-spec-static-brand-red:#009C3B!important;
  --yt-spec-brand-button-background:#009C3B!important;
  --yt-spec-icon-active-other:#FFDF00!important;
  --yt-spec-badge-chip-background:#0F3018!important;
  --yt-spec-10-percent-layer:#1A4028!important;
  --yt-brand-youtube-red:#009C3B!important;
}
html.${ROOT_CLASS}.${FULL_CLASS},html.${ROOT_CLASS}.${FULL_CLASS} body,html.${ROOT_CLASS}.${FULL_CLASS} ytd-app{
  background:#04140A!important;transition:background-color .3s ease;
}
html.${ROOT_CLASS}.${FULL_CLASS} #masthead-container,html.${ROOT_CLASS}.${FULL_CLASS} ytd-masthead{
  background:#02391C!important;transition:background-color .3s ease;
}
html.${ROOT_CLASS}.${FULL_CLASS} .yt-spec-button-shape-next--filled,
html.${ROOT_CLASS}.${FULL_CLASS} #subscribe-button button,
html.${ROOT_CLASS}.${FULL_CLASS} #subscribe-button tp-yt-paper-button{background:#009C3B!important;color:#FFF6D5!important;}
html.${ROOT_CLASS}.${FULL_CLASS} yt-chip-cloud-chip-renderer[selected],
html.${ROOT_CLASS}.${FULL_CLASS} yt-chip-cloud-chip-renderer[aria-selected="true"]{background:#009C3B!important;color:#04140A!important;}
html.${ROOT_CLASS}.${FULL_CLASS} yt-live-chat-text-message-renderer #author-name,
html.${ROOT_CLASS}.${FULL_CLASS} yt-live-chat-author-chip #author-name{color:#FFE44D!important;}

/* ===== Decorative nodes (injected by this module while active) ===== */
/* Shaped like YouTube's own masthead buttons (e.g. +Criar): 36px pill, so it
   sits coherently next to them — branded by content, not by mimicking chrome. */
.zd-hexa-badge{
  display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 15px;box-sizing:border-box;
  border-radius:20px;border:1px solid rgba(255,223,0,.3);
  background:rgba(0,156,59,.18);color:#FFF6D5;
  font:600 14px/1 Roboto,"Segoe UI",system-ui,sans-serif;letter-spacing:.2px;
  white-space:nowrap;vertical-align:middle;animation:zd-hexa-pop .34s ${SPRING} both;
}
.zd-hexa-badge .zd-hexa-stars{display:inline-flex;gap:1px;font-size:12px;letter-spacing:1px;}
.zd-hexa-badge .zd-hexa-star-on{color:#FFDF00;}
.zd-hexa-badge .zd-hexa-star-6{color:#5b8cff;}
.zd-hexa-badge--masthead{margin:0 8px;align-self:center;}
/* Sits in the watch action row, to the LEFT of Like — same 36px pill as the
   native action buttons, gold so it still pops (and pulses) among the grey ones. */
.zd-hexa-gol{
  display:inline-flex;align-items:center;gap:6px;flex:none;vertical-align:middle;box-sizing:border-box;
  height:36px;padding:0 15px;margin-right:8px;cursor:pointer;border:0;border-radius:18px;
  background:linear-gradient(#FFE44D,#FFC400);color:#04140A;
  font:600 14px/1 Roboto,system-ui,sans-serif;letter-spacing:.2px;
  box-shadow:0 2px 10px rgba(255,223,0,.35);
  transition:transform .18s ${SPRING},box-shadow .2s ease;
  animation:zd-hexa-pop .34s ${SPRING} both,zd-hexa-golpulse 1.9s ease-in-out .5s infinite;
}
.zd-hexa-gol:hover{transform:translateY(-1px);box-shadow:0 2px 14px rgba(255,223,0,.55);}
.zd-hexa-gol:active{transform:scale(.96);}
.zd-hexa-gol:focus-visible{outline:3px solid #FFF6D5;outline-offset:2px;}
@keyframes zd-hexa-golpulse{0%,100%{box-shadow:0 2px 10px rgba(255,223,0,.3);}50%{box-shadow:0 2px 16px rgba(255,223,0,.6);}}
.zd-hexa-toast{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);
  z-index:2147483646;display:flex;align-items:center;gap:8px;padding:11px 17px;
  border-radius:999px;background:#02391C;border:1px solid #FFDF00;color:#FFF6D5;
  font:700 13px/1 Roboto,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);
  opacity:0;transition:opacity .3s ease,transform .38s ${SPRING};
}
.zd-hexa-toast.zd-hexa-in{opacity:1;transform:translateX(-50%) translateY(0);}
.zd-hexa-confetti{position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden;animation:zd-hexa-resolve .4s ease both;}
.zd-hexa-confetti i{position:absolute;top:-24px;width:8px;height:14px;border-radius:2px;animation:zd-hexa-fall linear forwards;}
/* Some pieces are tricolor pennants; others are little Brazil flags. */
.zd-hexa-confetti i.zd-hexa-flag{width:13px;height:9px;border-radius:1px;}
.zd-hexa-confetti i.zd-hexa-bandeira{width:15px;height:11px;border-radius:1px;background:#009C3B;overflow:hidden;}
.zd-hexa-confetti i.zd-hexa-bandeira::before{content:'';position:absolute;left:50%;top:50%;width:8px;height:8px;transform:translate(-50%,-50%) rotate(45deg);background:#FFDF00;}
.zd-hexa-confetti i.zd-hexa-bandeira::after{content:'';position:absolute;left:50%;top:50%;width:3.6px;height:3.6px;transform:translate(-50%,-50%);border-radius:50%;background:#002776;}
@keyframes zd-hexa-fall{to{transform:translateY(110vh) rotate(600deg);opacity:.85;}}
/* The burst materializes from a degraded blur to sharp before it falls. */
@keyframes zd-hexa-resolve{from{filter:blur(7px);opacity:0;}to{filter:blur(0);opacity:1;}}
/* Nodes resolve from a degraded (blurred) state to sharp — the product's
   degraded -> nitido signature, wearing the jersey. */
@keyframes zd-hexa-pop{from{opacity:0;transform:scale(.9);filter:blur(4px);}to{opacity:1;filter:blur(0);}}

/* Activation "boot": a full-screen tricolor that resolves from blurred + scanline
   (degraded) to sharp, then clears — the page putting on the shirt in the same
   pixel -> nitido gesture the extension uses on the stream. One-shot; removed by JS. */
.zd-hexa-boot{
  position:fixed;inset:0;z-index:2147483644;pointer-events:none;
  background:linear-gradient(180deg,#009C3B 0 34%,#FFDF00 34% 67%,#002776 67% 100%);
  animation:zd-hexa-boot .8s ease forwards;
}
.zd-hexa-boot::after{
  content:'';position:absolute;inset:0;mix-blend-mode:multiply;
  background:repeating-linear-gradient(0deg,rgba(0,0,0,.22) 0 2px,transparent 2px 5px);
}
@keyframes zd-hexa-boot{
  0%{opacity:0;filter:blur(11px) saturate(1.6);transform:scale(1.06);}
  22%{opacity:.92;}
  55%{filter:blur(0) saturate(1);transform:scale(1);}
  100%{opacity:0;filter:blur(0);transform:scale(1);}
}

/* Opt-in invite: shown (theme still OFF) when a live Brazil game is detected.
   Clearly ZeroDelay's (carries the badge), never posing as YouTube. */
.zd-hexa-invite{
  position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(10px);
  z-index:2147483646;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  max-width:min(92vw,460px);padding:12px 14px;border-radius:14px;
  background:#02391C;border:1px solid #FFDF00;color:#FFF6D5;
  font:600 13px/1.35 Roboto,"Segoe UI",system-ui,sans-serif;
  box-shadow:0 10px 30px rgba(0,0,0,.55);
  opacity:0;transition:opacity .3s ease,transform .38s ${SPRING};
}
.zd-hexa-invite.zd-hexa-in{opacity:1;transform:translateX(-50%) translateY(0);}
.zd-hexa-invite-msg{flex:1 1 170px;min-width:0;}
.zd-hexa-invite-cta{
  flex:none;border:0;border-radius:999px;padding:8px 16px;cursor:pointer;
  background:linear-gradient(#FFDF00,#F5C400);color:#04140A;
  font:800 13px/1 Roboto,system-ui,sans-serif;letter-spacing:.3px;
}
.zd-hexa-invite-no{
  flex:none;border:0;background:transparent;color:#CFE3C9;cursor:pointer;
  padding:8px 6px;font:600 12px/1 Roboto,system-ui,sans-serif;
  text-decoration:underline;text-underline-offset:2px;
}
.zd-hexa-invite-cta:focus-visible,.zd-hexa-invite-no:focus-visible{
  outline:2px solid #FFF6D5;outline-offset:2px;
}

/* NEVER cover a fullscreen video. The fixed overlays live under the page root, so
   when YouTube makes html/ytd-app the fullscreen element they'd render on top of
   the game — hide them entirely while fullscreen (two rules so an unknown pseudo
   can't invalidate the other). */
:fullscreen :is(.zd-hexa-bunting,.zd-hexa-boot,.zd-hexa-confetti,.zd-hexa-toast,.zd-hexa-invite){display:none!important;}
:-webkit-full-screen :is(.zd-hexa-bunting,.zd-hexa-boot,.zd-hexa-confetti,.zd-hexa-toast,.zd-hexa-invite){display:none!important;}

/* ===== Accessibility: honor reduced motion & forced colors ===== */
@media (prefers-reduced-motion: reduce){
  html.${ROOT_CLASS}.${FULL_CLASS},html.${ROOT_CLASS}.${FULL_CLASS} body,html.${ROOT_CLASS}.${FULL_CLASS} ytd-app,
  html.${ROOT_CLASS}.${FULL_CLASS} #masthead-container,html.${ROOT_CLASS}.${FULL_CLASS} ytd-masthead{transition:none!important;}
  .zd-hexa-badge,.zd-hexa-gol,.zd-hexa-toast{animation:none!important;}
  .zd-hexa-bunting{animation:none!important;}
  html.${ROOT_CLASS} .ytp-play-progress{animation:none!important;}
  .zd-hexa-toast{transition:none!important;}
  .zd-hexa-invite{transition:none!important;opacity:1!important;transform:translateX(-50%)!important;}
  .zd-hexa-gol,.zd-hexa-confetti,.zd-hexa-boot{display:none!important;} /* no confetti/boot -> hide trigger */
}
@media (forced-colors: active){
  .zd-hexa-bunting,.zd-hexa-confetti,.zd-hexa-boot{display:none!important;}
}
`;

const reduceMotion = () =>
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let installed = false;
let active = false;
let keepAlive = null;              // re-attaches decorative nodes after re-renders
let inviteTimer = null;            // auto-dismiss timer for the opt-in invite
const nodes = { badgeMast: null, bunting: null, gol: null, invite: null };

/** Insert the dormant <style> once. Cheap; does nothing on repeat calls. */
export function install() {
    if (installed) return;
    installed = true;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
}

/**
 * Turn the theme on/off by toggling the single root class + managing nodes.
 * @param {boolean} on
 * @param {string} [activatedLabel] - Localized "activated" toast text (page world has no chrome.i18n).
 */
export function setActive(on, activatedLabel) {
    on = !!on;
    if (on === active) return;
    active = on;
    document.documentElement.classList.toggle(ROOT_CLASS, on);
    if (on) {
        hideInvite();
        playBoot();
        ensureNodes();
        keepAlive = setInterval(ensureNodes, 1000);
        showToast(activatedLabel);
    } else {
        clearInterval(keepAlive);
        keepAlive = null;
        document.documentElement.classList.remove(FULL_CLASS);
        removeNodes();
    }
}

/**
 * Toggle the optional "full theme" (broad page repaint). No-op unless the base
 * theme is on. Off by default; a popup sub-toggle drives it.
 * @param {boolean} on
 */
export function setFull(on) {
    document.documentElement.classList.toggle(FULL_CLASS, !!on);
}

/**
 * Show the opt-in invite (theme stays OFF until the user accepts). Content.js
 * passes localized strings and the callbacks; this module owns only the DOM.
 * @param {{message:string, cta:string, dismiss:string, onAccept:Function, onDismiss:Function}} opts
 */
export function showInvite({ message, cta, dismiss, onAccept, onDismiss } = {}) {
    if (active) return;               // already on — nothing to offer
    hideInvite();
    const card = make('div', 'zd-hexa-invite');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', message || 'Modo Hexa');
    const yes = make('button', 'zd-hexa-invite-cta', cta || 'Ativar');
    yes.type = 'button';
    const no = make('button', 'zd-hexa-invite-no', dismiss || 'Agora não');
    no.type = 'button';
    yes.addEventListener('click', () => { hideInvite(); if (onAccept) onAccept(); });
    no.addEventListener('click', () => { hideInvite(); if (onDismiss) onDismiss(); });
    card.append(buildBadge(), make('span', 'zd-hexa-invite-msg', message), yes, no);
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add('zd-hexa-in'));
    nodes.invite = card;
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(hideInvite, 15000);   // an offer, not a nag
}

/** Dismiss the invite (no-op if none is showing). */
export function hideInvite() {
    clearTimeout(inviteTimer);
    inviteTimer = null;
    const card = nodes.invite;
    if (!card) return;
    nodes.invite = null;
    card.classList.remove('zd-hexa-in');
    setTimeout(() => card.remove(), 300);
}

// --- DOM helpers (textContent only — no innerHTML) --------------------------
function make(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
}

function buildBadge() {
    const b = make('span', 'zd-hexa-badge');
    b.append(make('span', 'zd-hexa-badge-label', 'RUMO AO HEXA'));
    const stars = make('span', 'zd-hexa-stars');
    stars.append(make('span', 'zd-hexa-star-on', '★★★★★'));         // 5 titles, gold
    stars.append(make('span', 'zd-hexa-star-6', '★'));             // the aspirational 6th, in blue
    b.append(stars);
    return b;
}

// Re-inserts any decorative node YouTube's re-render may have detached. Called
// on activate and once per second while active; each check is a cheap
// isConnected test, re-adding only when needed.
function ensureNodes() {
    ensureMastheadBadge();
    ensureBunting();
    ensureGolButton();
}

function buildBunting() {
    return make('div', 'zd-hexa-bunting');   // shape lives in the tiled SVG background
}

function ensureBunting() {
    if (nodes.bunting && nodes.bunting.isConnected) return;
    if (!document.getElementById('masthead-container')) return; // wait for the masthead
    nodes.bunting = buildBunting();
    document.body.appendChild(nodes.bunting);                    // fixed; on body so nothing clips it
}

function ensureMastheadBadge() {
    if (nodes.badgeMast && nodes.badgeMast.isConnected) return;
    const host = document.querySelector('ytd-masthead #end');
    if (!host) return;
    nodes.badgeMast = buildBadge();
    nodes.badgeMast.classList.add('zd-hexa-badge--masthead');
    host.insertBefore(nodes.badgeMast, host.firstChild);
}

function ensureGolButton() {
    if (nodes.gol && nodes.gol.isConnected) return;
    // Watch action row (Like/Share/Save). GOL goes first, to the left of Like.
    const host = document.querySelector('#top-level-buttons-computed');
    if (!host) return;
    const btn = make('button', 'zd-hexa-gol', '⚽ GOL!');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Comemorar gol do Brasil');
    btn.addEventListener('click', fireConfetti);
    nodes.gol = btn;
    host.insertBefore(btn, host.firstChild);
}

function removeNodes() {
    for (const k of Object.keys(nodes)) {
        if (nodes[k]) { nodes[k].remove(); nodes[k] = null; }
    }
    clearTimeout(inviteTimer);
    inviteTimer = null;
    document.querySelectorAll('.zd-hexa-confetti,.zd-hexa-toast,.zd-hexa-invite').forEach(n => n.remove());
}

// Goal celebration — explicit, user-triggered via the GOL! button. Skipped
// entirely under reduced-motion (and the button is CSS-hidden there too).
function fireConfetti() {
    if (reduceMotion()) return;
    const layer = make('div', 'zd-hexa-confetti');
    const colors = ['#009C3B', '#FFDF00', '#002776'];   // flag colors, no ivory
    const TRICOLOR = 'linear-gradient(#009C3B 0 33%,#FFDF00 33% 66%,#002776 66% 100%)';
    for (let i = 0; i < 46; i++) {
        const p = document.createElement('i');
        p.style.left = Math.random() * 100 + 'vw';
        const r = i % 5;
        if (r === 0) {                                  // little Brazil flag
            p.className = 'zd-hexa-bandeira';
        } else if (r === 1) {                           // tricolor pennant
            p.className = 'zd-hexa-flag';
            p.style.background = TRICOLOR;
        } else {                                        // flat confetti
            p.style.background = colors[i % colors.length];
        }
        p.style.animationDuration = (1.4 + Math.random() * 1.0) + 's';
        p.style.animationDelay = (Math.random() * 0.25) + 's';
        layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2800);
}

// One-shot "boot" flash on activation: a tricolor that resolves blur -> sharp,
// then clears (the page putting on the jersey). Skipped under reduced motion.
function playBoot() {
    if (reduceMotion()) return;
    const b = make('div', 'zd-hexa-boot');
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 850);
}

function showToast(text) {
    const t = make('div', 'zd-hexa-toast', '🇧🇷 ' + (text || 'Modo Hexa ativado'));
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('zd-hexa-in'));
    setTimeout(() => {
        t.classList.remove('zd-hexa-in');
        setTimeout(() => t.remove(), 350);
    }, 3000);
}
