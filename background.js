// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Minimal MV3 service worker: records the install time and, once the user has
// used the extension for a while, shows a tiny optional "support available" dot
// on the toolbar icon. It never changes how the extension works.

import * as common from './common.js';

const BADGE_TEXT = '•';
const BADGE_COLOR = '#ff2d52';

function evalBadge() {
    chrome.storage.local.get(common.donateKeys, d => {
        if (common.donateEligible(d, Date.now())) {
            chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
            chrome.action.setBadgeText({ text: BADGE_TEXT });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    });
}

function boot() {
    common.ensureInstalledAt();
    common.ensureSettingsMigrated();   // one-time local→sync move (idempotent)
    chrome.alarms.create('donate-eval', { periodInMinutes: 30 });
    evalBadge();
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);

// The donation invite dedupes itself per BROWSER SESSION via storage.session,
// which content scripts can't touch by default (trusted contexts only). Grant
// it at every worker start; the content script degrades to per-tab dedup when
// the grant/API is unavailable. Top-level on purpose: the worker restarts often
// and the access level must be re-granted each time.
try {
    chrome.storage.session?.setAccessLevel?.({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
} catch { /* older engines: content script falls back to per-tab dedup */ }


chrome.alarms.onAlarm.addListener(a => {
    if (a.name === 'donate-eval') evalBadge();
});

// Usage time / snooze / opt-out changes should update the dot promptly.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && common.donateKeys.some(k => k in changes)) evalBadge();
});

// The latency badge is neutral (dark gray) on purpose: red is the donation
// dot's voice, and a number that updates every second must not read as alert.
const LATENCY_BADGE_COLOR = '#424242';

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (!msg) return;
    if (msg.type === 'donate-open') {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?donate=1') });
    } else if (msg.type === 'donate-seen') {
        chrome.action.setBadgeText({ text: '' });
    } else if (msg.type === 'zd-badge' && sender?.tab?.id != null) {
        // Tab-scoped: it never collides with the global donation dot on other
        // tabs, and it dies with its tab (or on a full navigation).
        const text = typeof msg.text === 'string' ? msg.text.slice(0, 4) : '';
        chrome.action.setBadgeText({ tabId: sender.tab.id, text });
        if (text) chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: LATENCY_BADGE_COLOR });
    }
});

/**
 * Send a one-off message to the active tab only. Any failure (no active tab,
 * not a YouTube tab, no content script listening) is swallowed — the shortcut
 * simply does nothing rather than falling back to a global signal.
 * @param {string} type - Message type the content script listens for.
 */
function messageActiveTab(type) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs?.[0];
        if (!tab?.id) return;
        chrome.tabs.sendMessage(tab.id, { type }, () => {
            void chrome.runtime.lastError; // no listener on that tab — ignore
        });
    });
}

/**
 * Handle a keyboard command. `toggle-enabled` writes storage, which every open
 * tab's content script reacts to. `go-live` is scoped to the active tab only,
 * sent directly via chrome.tabs.sendMessage (see messageActiveTab).
 * @param {'toggle-enabled'|'go-live'} command - Command id from the manifest.
 */
function onCommand(command) {
    if (command === 'toggle-enabled') {
        common.getSettings([...common.storage, common.lastModeKey], data => {
            const { apply, remember } = common.toggleEnabledAction(data, data[common.lastModeKey]);
            const patch = { ...apply };
            if (remember) patch[common.lastModeKey] = remember;
            common.setSettings(patch);
        });
    } else if (command === 'go-live') {
        messageActiveTab('go-live');
    }
}

if (chrome.commands?.onCommand) chrome.commands.onCommand.addListener(onCommand);
