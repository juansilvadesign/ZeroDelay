// ZeroDelay — YouTube live stream latency mitigator
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)

import(chrome.runtime.getURL('common.js')).then(common => {
    if (!common.isLiveChat(location.href)) {
        main(common);
        if (window.top === window) initDonation(common);
    }
});

function main(common) {
    function loadSettings() {
        chrome.storage.local.get(common.storage, data => {
            const enabled = common.value(data.enabled, common.defaultEnabled);
            const playbackRate = common.limitValue(data.playbackRate, common.defaultPlaybackRate, common.minPlaybackRate, common.maxPlaybackRate, common.stepPlaybackRate);
            const showPlaybackRate = common.value(data.showPlaybackRate, common.defaultShowPlaybackRate);
            const showLatency = common.value(data.showLatency, common.defaultShowLatency);
            const showHealth = common.value(data.showHealth, common.defaultShowHealth);
            const showEstimation = common.value(data.showEstimation, common.defaultShowEstimation);
            const showCurrent = common.value(data.showCurrent, common.defaultShowCurrent);
            const bufferTarget = common.limitValue(data.bufferTarget, common.defaultBufferTarget, common.minBufferTarget, common.maxBufferTarget, common.stepBufferTarget);
            const auto = common.value(data.auto, common.defaultAuto);
            const skip = common.value(data.skip, common.defaultSkip);
            const skipThreathold = common.value(data.skipThreathold, common.defaultSkipThreathold);

            sendLoadSettingsEvent(enabled, playbackRate, showPlaybackRate, showLatency, showHealth, showEstimation, showCurrent, bufferTarget, auto, skip, skipThreathold);
        });
    }

    function sendLoadSettingsEvent(enabled, playbackRate, showPlaybackRate, showLatency, showHealth, showEstimation, showCurrent, bufferTarget, auto, skip, skipThreathold) {
        const detailObject = {
            enabled,
            playbackRate,
            showPlaybackRate,
            showLatency,
            showHealth,
            showEstimation,
            showCurrent,
            bufferTarget,
            auto,
            skip,
            skipThreathold,
        };
        const detail = navigator.userAgent.includes('Firefox') ? cloneInto(detailObject, document.defaultView) : detailObject;
        document.dispatchEvent(new CustomEvent('_live_catch_up_load_settings', { detail }));
    }

    let detect_interval;

    chrome.storage.onChanged.addListener(loadSettings);

    document.addEventListener('_live_catch_up_init', () => {
        clearInterval(detect_interval);
        detect_interval = setInterval(() => {
            const player = document.getElementById("movie_player");
            if (!player) {
                return;
            }

            clearInterval(detect_interval);

            loadSettings();
        }, 500);
    });

    const s = document.createElement('script');
    s.id = '_live_catch_up';
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = () => s.remove();
    (document.head || document.documentElement).append(s);
}

// --------------------------------------------------------------- Donation
// Accumulates active-usage time (top frame only) and shows a single, discreet,
// dismissible coffee invite over YouTube once the user has used it for a while.
// Purely optional — it never blocks or changes playback.
function initDonation(common) {
    const TICK = 60; // seconds

    chrome.storage.local.get(['donateInstalledAt'], d => {
        if (!d.donateInstalledAt) chrome.storage.local.set({ donateInstalledAt: Date.now() });
    });

    // Check soon after load (covers the "days since install" trigger), then on a
    // slow heartbeat that also accrues usage time while the tab is visible.
    setTimeout(() => maybeShowBanner(common), 8000);
    setInterval(() => {
        if (document.hidden) return;
        chrome.storage.local.get(['enabled', 'donateUsageSeconds'], d => {
            if (!common.value(d.enabled, common.defaultEnabled)) return;
            chrome.storage.local.set({ donateUsageSeconds: (d.donateUsageSeconds || 0) + TICK });
            maybeShowBanner(common);
        });
    }, TICK * 1000);
}

let donationBannerEl = null;

function maybeShowBanner(common) {
    if (donationBannerEl) return;
    chrome.storage.local.get(common.donateKeys, d => {
        if (donationBannerEl || d.donateBannerShown) return;
        if (!common.donateEligible(d, Date.now())) return;
        chrome.storage.local.set({ donateBannerShown: true });
        showDonationBanner(common);
    });
}

function showDonationBanner(common) {
    const L = common.label;
    let autoHide;

    const card = document.createElement('div');
    card.style.cssText = [
        'position:fixed', 'z-index:2147483646', 'right:16px', 'bottom:16px', 'max-width:300px',
        'display:flex', 'align-items:center', 'gap:10px', 'padding:12px 14px', 'border-radius:12px',
        'background:#1c1c1c', 'color:#f1f1f1', 'border:1px solid #3a3a3a',
        'box-shadow:0 10px 30px rgba(0,0,0,.45)',
        'font:500 13px/1.4 Roboto,"Segoe UI",system-ui,sans-serif',
        'opacity:0', 'transform:translateY(8px)', 'transition:opacity .25s,transform .25s',
    ].join(';');

    const cup = document.createElement('span');
    cup.textContent = '☕';
    cup.style.cssText = 'font-size:20px;flex:none';

    const text = document.createElement('span');
    text.textContent = L.donateBannerText;
    text.style.cssText = 'flex:1;min-width:0';

    const cta = document.createElement('button');
    cta.textContent = L.donateBannerCta;
    cta.style.cssText = 'flex:none;cursor:pointer;border:0;border-radius:999px;padding:7px 14px;'
        + 'font:600 12px Roboto,system-ui,sans-serif;background:#ff0033;color:#fff';

    const close = document.createElement('button');
    close.textContent = '✕';
    close.setAttribute('aria-label', L.donateBannerClose);
    close.style.cssText = 'flex:none;cursor:pointer;border:0;background:transparent;color:#aaa;font-size:14px;padding:2px 4px';

    const remove = () => {
        if (!donationBannerEl) return;
        donationBannerEl = null;
        clearTimeout(autoHide);
        card.style.opacity = '0';
        card.style.transform = 'translateY(8px)';
        setTimeout(() => card.remove(), 250);
    };

    cta.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'donate-open' }); remove(); });
    close.addEventListener('click', remove);

    card.append(cup, text, cta, close);
    document.body.append(card);
    donationBannerEl = card;
    requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; });
    autoHide = setTimeout(remove, 15000);
}