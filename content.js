// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)

import(chrome.runtime.getURL('common.js')).then(common => {
    // The live-chat popout is same-origin, so this script also loads there — but it
    // has no player, so we only run the engine (and the donation invite) on the real
    // watch pages, never inside the chat iframe.
    if (common.isLiveChat(location.href)) return;
    main(common);
    if (window.top === window) initDonation(common);
});

let storageListenersAttached = false;

// After the extension is reloaded/updated/disabled, content scripts from the
// OLD context keep running in already-open tabs; any chrome.* call then throws
// "Extension context invalidated". chrome.runtime.id goes undefined in that
// state, so we gate chrome.* behind this and quietly stand down (also clearing
// the orphaned timers that would otherwise keep throwing).
const extensionAlive = () => Boolean(chrome.runtime?.id);

function main(common) {
    function loadSettings() {
        if (!extensionAlive()) return;
        chrome.storage.local.get(common.storage, data => {
            sendLoadSettingsEvent(common.resolveSettings(data));
        });
    }

    function sendLoadSettingsEvent(settings) {
        const detailObject = {
            ...settings,
            copiedLabel: common.label.supportCopied,
            // Localized aria-labels shipped to the engine (page world has no chrome.i18n).
            a11yLabels: {
                playbackRate: common.label.a11yPlaybackRate,
                latency: common.label.a11yLatency,
                health: common.label.a11yHealth,
                estimation: common.label.a11yEstimation,
                current: common.label.a11yCurrent,
            },
        };
        // Firefox: without cloneInto the page world sees `detail` as null (X-ray
        // vision). Feature-detect the function — UA sniffing breaks under
        // privacy.resistFingerprinting or a user-overridden UA.
        const detail = (typeof cloneInto === 'function') ? cloneInto(detailObject, document.defaultView) : detailObject;
        document.dispatchEvent(new CustomEvent('_live_catch_up_load_settings', { detail }));
    }

    let detect_interval;

    // Reload only when an engine setting actually changed — the donation
    // counter and control keys write storage frequently, and re-sending
    // settings to every YouTube frame on each of those writes is pure churn.
    function onEngineSettingsChanged(changes, area) {
        if (area === 'local' && common.storage.some(k => k in changes)) loadSettings();
    }

    /** Tell the engine (inject.js) to jump to the live edge now. */
    function dispatchGoLive() {
        document.dispatchEvent(new CustomEvent('_live_catch_up_go_live'));
    }

    // Legacy/global signal: still forwarded for compatibility, but the "go-live"
    // shortcut no longer writes it (see background.js) — every tab reacting to
    // this key is exactly the behavior that shortcut was moved away from (PR #16).
    function onGoLiveSignalChanged(changes, area) {
        if (area === 'local' && changes[common.goLiveSignalKey]) dispatchGoLive();
    }

    // Active-tab-only path: background.js sends this directly to the tab the
    // "go-live" shortcut was pressed on (PR #16).
    function onRuntimeMessage(msg) {
        if (msg?.type === 'go-live') dispatchGoLive();
    }

    // Guard against double-registration if the content script re-inits in the
    // same page — listeners would otherwise stack up (PR #17).
    if (!storageListenersAttached) {
        storageListenersAttached = true;
        chrome.storage.onChanged.addListener(onEngineSettingsChanged);
        chrome.storage.onChanged.addListener(onGoLiveSignalChanged);
        chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }

    document.addEventListener('_live_catch_up_init', () => {
        clearInterval(detect_interval);
        let my_interval;
        my_interval = detect_interval = setInterval(() => {
            const player = document.getElementById("movie_player");
            if (!player) {
                return;
            }

            clearInterval(my_interval);
            if (detect_interval === my_interval) detect_interval = null;

            loadSettings();
        }, 500);
    });

    // Top frame only: the offer card must land on the visible page, not inside
    // an iframe's (clipped) body.
    if (window.top === window) {
        document.addEventListener('_live_catch_up_stall', () => onStallDetected(common));
        // Per-channel mode memory (opt-in): the engine reports the channel via the
        // video-meta bridge; we remember/restore the explicit mode for it — never
        // forcing a mode on a channel the user hasn't set.
        document.addEventListener('_live_catch_up_video_meta', e => onChannelIdUpdate(common, e.detail));
        // Turning the feature ON should take effect on the channel you're already on.
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[common.channelMemoryKey]?.newValue && lastChannelId) {
                onChannelIdUpdate(common, { channel_id: lastChannelId });
            }
        });
    }

    // Inject the controller/rate adapter first, then the engine. `async = false`
    // preserves execution order for dynamically-inserted scripts, so
    // window.ZeroDelay is ready by the time inject.js runs.
    const injectScript = file => {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL(file);
        s.async = false;
        s.onload = () => s.remove();
        (document.head || document.documentElement).append(s);
        return s;
    };
    injectScript('engine/controller.js');
    injectScript('engine/rate-applier.js');
    injectScript('inject.js').id = '_live_catch_up';
}

// --------------------------------------------------------------- Donation
// Accumulates active-usage time (top frame only) and shows a single, discreet,
// dismissible coffee invite over YouTube once the user has used it for a while.
// Purely optional — it never blocks or changes playback.
function initDonation(common) {
    const TICK = 60; // seconds

    common.ensureInstalledAt();

    // The engine pings while a live is actually playing; only that time counts as
    // "watching the transmission" (idle browsing on YouTube doesn't accrue usage),
    // and it also gates WHERE the invite may appear (only over a live playing now).
    document.addEventListener('_live_catch_up_active', () => { donateLastActive = Date.now(); });

    // The in-player PIX motion (BR) rides a "calm moment" pulse from the engine
    // (stream stable, healthy buffer) rather than a fictitious "reached live". It is
    // a SEPARATE surface from the usage banner below, with its own per-session slot.
    document.addEventListener('_zd_ok_moment', () => maybeShowMotion(common));

    // The usage banner is windowed-only; if the viewer goes fullscreen while it is
    // up, retract it (the in-player motion is what covers fullscreen).
    document.addEventListener('fullscreenchange', () => { if (isFullscreen() && donationBannerEl) donationBannerEl.zdRemove(); });

    // BR viewers also get the in-player PIX motion (overlay.js). Preload its QR lib
    // and module now so it renders the instant the reached-live moment fires.
    if (common.isBrazil()) {
        injectPageScript('vendor/qrcode.js');
        injectPageScript('overlay.js');
    }

    setTimeout(() => maybeShowBanner(common), 8000);
    const usageTimer = setInterval(() => {
        if (!extensionAlive()) { clearInterval(usageTimer); return; }
        if (document.hidden || Date.now() - donateLastActive > 5000) return;
        chrome.storage.local.get(['enabled', 'donateUsageSeconds', 'donateLastCountedAt'], d => {
            if (!common.value(d.enabled, common.defaultEnabled)) return;
            // Every YouTube tab runs this loop; only one may count each minute
            // of wall-clock time, or N tabs would accrue N× the real usage.
            // (5s of slack absorbs timer jitter between the tabs.)
            const now = Date.now();
            if (now - (d.donateLastCountedAt || 0) < (TICK - 5) * 1000) return;
            chrome.storage.local.set({
                donateUsageSeconds: (d.donateUsageSeconds || 0) + TICK,
                donateLastCountedAt: now,
            });
            maybeShowBanner(common);
        });
    }, TICK * 1000);
}

let donationBannerEl = null;
let donateLastActive = 0;   // last _live_catch_up_active ping — proves a live is playing NOW
const tabShown = { banner: false, motion: false };   // per-tab fallback when storage.session is unreachable

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

// Run showFn at most once per BROWSER SESSION (storage.session clears on close);
// degrade to once per tab if the session store is missing or throws. Seeing or
// ✕-closing an invite silences nothing; only the explicit buttons do ("Hoje não"
// rests until tomorrow, "Não quero apoiar" opts out).
function oncePerSession(sessionKey, tabKey, showFn) {
    const onceTab = () => { if (tabShown[tabKey]) return; tabShown[tabKey] = true; showFn(); };
    const sess = chrome.storage.session;
    if (!sess) { onceTab(); return; }
    try {
        sess.get([sessionKey], s => {
            if (chrome.runtime.lastError) { onceTab(); return; }
            if (s[sessionKey]) return;
            sess.set({ [sessionKey]: true });
            showFn();
        });
    } catch { onceTab(); }   // engines that throw instead of setting lastError
}

// The usage-based invite (everyone): a discreet card after enough watch time.
// Windowed only; never over a fullscreen video (the in-player motion covers that).
function maybeShowBanner(common) {
    if (donationBannerEl || !extensionAlive() || isFullscreen()) return;
    // Only over a live that is actually playing right now — never on a VOD or an idle tab.
    if (Date.now() - donateLastActive > 6000) return;
    chrome.storage.local.get(common.donateKeys, d => {
        if (donationBannerEl || isFullscreen()) return;
        if (!common.donateEligible(d, Date.now())) return;
        oncePerSession('donateSessionShown', 'banner',
            () => { if (!donationBannerEl && !isFullscreen()) showDonationBanner(common); });
    });
}

// The in-player PIX motion (BR only), shown once per session at a calm moment once
// the viewer is eligible. Its OWN per-session slot, independent of the banner, and
// it DOES show in fullscreen (it lives inside the player element). `motionDone`
// stops this tab re-checking after its one eligible attempt (the pulse repeats).
let motionDone = false;
function maybeShowMotion(common) {
    if (motionDone || !extensionAlive() || !common.isBrazil()) return;
    if (Date.now() - donateLastActive > 6000) return;
    chrome.storage.local.get(common.donateKeys, d => {
        if (motionDone || !common.donateEligible(d, Date.now())) return;
        motionDone = true;   // one eligible attempt per tab; oncePerSession dedups across tabs
        oncePerSession('donateMotionSessionShown', 'motion', () => showDonation(common));
    });
}

// Shared chrome for the two floating cards (donation banner / stall offer):
// same look and lifecycle — CTA + close button, fade in, auto-hide, fade out.
function buildOverlayCard({ side, maxWidth, content, ctaLabel, onCta, closeLabel, autoHideMs, onRemove }) {
    let autoHide;
    let removed = false;

    const card = document.createElement('div');
    card.style.cssText = [
        'position:fixed', 'z-index:2147483646', `${side}:16px`, 'bottom:16px', `max-width:${maxWidth}`,
        'display:flex', 'align-items:center', 'gap:12px', 'padding:13px 15px', 'border-radius:12px',
        'background:#1c1c1c', 'color:#f1f1f1', 'border:1px solid #3a3a3a',
        'box-shadow:0 10px 30px rgba(0,0,0,.45)',
        'font:500 13px/1.4 Roboto,"Segoe UI",system-ui,sans-serif',
        'opacity:0', 'transform:translateY(8px)', 'transition:opacity .25s,transform .25s',
    ].join(';');

    const cta = document.createElement('button');
    cta.textContent = ctaLabel;
    cta.style.cssText = 'flex:none;cursor:pointer;border:0;border-radius:999px;padding:8px 14px;'
        + 'font:600 12px Roboto,system-ui,sans-serif;background:#ff0033;color:#fff';

    const close = document.createElement('button');
    close.textContent = '✕';
    close.setAttribute('aria-label', closeLabel);
    close.style.cssText = 'flex:none;cursor:pointer;border:0;background:transparent;color:#aaa;font-size:14px;padding:2px 4px';

    const remove = () => {
        if (removed) return;
        removed = true;
        clearTimeout(autoHide);
        card.style.opacity = '0';
        card.style.transform = 'translateY(8px)';
        setTimeout(() => card.remove(), 250);
        onRemove();
    };

    cta.addEventListener('click', () => { onCta(); remove(); });
    close.addEventListener('click', remove);

    card.append(content, cta, close);
    document.body.append(card);
    requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; });
    autoHide = setTimeout(remove, autoHideMs);
    card.zdRemove = remove;   // for secondary actions placed inside `content`
    return card;
}

function showDonationBanner(common) {
    const L = common.label;
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    const text = document.createElement('div');
    text.textContent = L.donateBannerText;

    // The two explicit silencing choices live on the card itself: "Hoje não"
    // (quiet until tomorrow) and "Não quero apoiar" (never again). The ✕ close
    // stays neutral — the invite simply returns next session.
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:14px;margin-top:6px';
    const quietBtn = (label, onPick) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'cursor:pointer;border:0;background:transparent;padding:0;'
            + 'font:500 12px Roboto,"Segoe UI",system-ui,sans-serif;color:#aaa;text-decoration:underline';
        b.addEventListener('click', () => { onPick(); donationBannerEl?.zdRemove(); });
        return b;
    };
    actions.append(
        quietBtn(L.donateLater, () => chrome.storage.local.set({ donateSnoozeUntil: common.endOfToday(Date.now()) })),
        quietBtn(L.donateOptOut, () => chrome.storage.local.set({ donateOptOut: true })),
    );
    body.append(text, actions);

    donationBannerEl = buildOverlayCard({
        side: 'right', maxWidth: '320px', content: body,
        ctaLabel: L.donateBannerCta,
        onCta: () => chrome.runtime.sendMessage({ type: 'donate-open' }),
        closeLabel: L.donateBannerClose,
        autoHideMs: 15000,
        onRemove: () => { donationBannerEl = null; },
    });
}

// The in-player PIX motion (overlay.js, page world). BR-gated by the caller; the
// open-amount PIX code is static, so import pix.js once and memoise it.
let zdPixCode = null;
function showDonation(common) {
    const fire = () => {
        const detail = { pixCode: zdPixCode, strings: { kicker: common.label.donateOverlayKicker, pix: 'PIX', aria: common.label.donateOverlayAria } };
        // Firefox: the detail must be cloned into the page realm to survive the hop.
        const payload = (typeof cloneInto === 'function') ? cloneInto(detail, document.defaultView) : detail;
        document.dispatchEvent(new CustomEvent('_zd_donation_show', { detail: payload }));
    };
    if (zdPixCode != null) { fire(); return; }
    import(chrome.runtime.getURL('pix.js'))
        .then(pix => { zdPixCode = pix.buildPixCode(0); fire(); })
        .catch(() => {});   // if the PIX module fails, skip (the banner still asks separately)
}

// Inject an extension page-world script once (dedup) — the QR lib + overlay module
// live in the page realm so overlay.js can read the YouTube player element.
const zdInjected = new Set();
function injectPageScript(file) {
    if (zdInjected.has(file)) return;
    zdInjected.add(file);
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL(file);
    s.async = false;
    s.onload = () => s.remove();
    (document.head || document.documentElement).append(s);
}

// --------------------------------------------------------------- Stall offer
// When the engine reports repeated stalls, offer (once per page) a one-tap
// switch to a calmer mode that keeps more buffer — curbing "it keeps freezing"
// misuse of an over-aggressive mode. The extension keeps working regardless.
let stallOfferEl = null;
let stallOfferShown = false;

function onStallDetected(common) {
    if (stallOfferShown || stallOfferEl || !extensionAlive()) return;
    chrome.storage.local.get(common.storage, data => {
        const target = common.calmerMode(common.deriveMode(data));
        if (!target) return; // already on the calmest mode (or off)
        showStallOffer(common, target);
    });
}

function showStallOffer(common, target) {
    if (stallOfferEl) return;
    stallOfferShown = true;
    const L = common.label;

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0';
    const title = document.createElement('div');
    title.textContent = L.stallTitle;
    title.style.cssText = 'font-weight:700';
    const desc = document.createElement('div');
    desc.textContent = L.stallDesc;
    desc.style.cssText = 'font-size:12px;color:#bbb;margin-top:2px';
    body.append(title, desc);

    stallOfferEl = buildOverlayCard({
        side: 'left', maxWidth: '330px', content: body,
        ctaLabel: `${L.stallSwitch} ${common.modeMeta[target].title}`,
        onCta: () => chrome.storage.local.set(common.presets[target]),
        closeLabel: L.donateBannerClose,
        autoHideMs: 14000,
        onRemove: () => { stallOfferEl = null; },
    });
}

// --------------------------------------------------------- Per-channel memory
// Opt-in (channelMemory). The engine reports the channel on each change; we note
// where we are (so the popup knows where a pick lands + can show the "remembered"
// hint) and, when the feature is on and this channel has a mode the user explicitly
// saved, we reapply it. An unknown channel is left alone — the current mode stays.
let lastChannelId = null;

function onChannelIdUpdate(common, detail) {
    const channelId = detail && detail.channel_id;
    if (!channelId || !extensionAlive()) return;
    lastChannelId = channelId;
    chrome.storage.local.get([common.channelMemoryKey, common.channelModesKey, common.currentChannelIdKey, ...common.storage], data => {
        const upd = {};
        if (data[common.currentChannelIdKey] !== channelId) upd[common.currentChannelIdKey] = channelId;
        if (data[common.channelMemoryKey]) {
            const saved = common.getSuggestedModeForChannel(data, channelId);
            if (saved && common.deriveMode(data) !== saved) Object.assign(upd, common.presets[saved]);
        }
        if (Object.keys(upd).length) chrome.storage.local.set(upd);
    });
}
