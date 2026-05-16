// utils.js - shared constants, helpers

const TC = {
    DEFAULT_THRESHOLD_MS: 2 * 60 * 60 * 1000,
    SWEEP_MINUTES: 1,
    GRAVEYARD_LIMIT: 200,
    UNDO_WINDOW_MS: 30 * 1000,
    CEMETERY_GROUP_TITLE: "🪦 Cemetery",
    CEMETERY_GROUP_COLOR: "grey",
    AVG_TAB_RAM_MB: 80,

    MODES: {
        DISCARD: "discard",
        GROUP: "group",
        CLOSE: "close"
    },

    DEFAULTS: {
        enabled: true,
        mode: "close",
        threshold: 2 * 60 * 60 * 1000,
        respectIdle: true,
        notifyOnBury: true,
        excludePinned: true,
        excludeAudible: true,
        excludeGrouped: true,
        excludeIncognito: true,
        excludeFormInput: true,
        excludePatterns: [
            "*://mail.google.com/*",
            "*://*.slack.com/*",
            "*://*.figma.com/*"
        ],
        domainThresholds: {}
    }
};

function nowMs() { return Date.now(); }

function patternToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const re = "^" + escaped.replace(/\*/g, ".*") + "$";
    return new RegExp(re);
}

function urlMatchesAny(url, patterns) {
    if (!url || !patterns?.length) return false;
    for (const p of patterns) {
        try {
            if (patternToRegex(p).test(url)) return true;
        } catch (_) { /* skip bad pattern */ }
    }
    return false;
}

function getDomain(url) {
    try { return new URL(url).hostname; } catch (_) { return ""; }
}

function effectiveThreshold(url, settings) {
    const domain = getDomain(url);
    const map = settings.domainThresholds || {};
    for (const key in map) {
        if (domain === key || domain.endsWith("." + key)) return map[key];
    }
    return settings.threshold || TC.DEFAULT_THRESHOLD_MS;
}

function getSettings() {
    return new Promise(resolve => {
        chrome.storage.sync.get(["settings"], (data) => {
            resolve({ ...TC.DEFAULTS, ...(data.settings || {}) });
        });
    });
}

function setSettings(partial) {
    return getSettings().then(current => {
        const merged = { ...current, ...partial };
        return new Promise(resolve => chrome.storage.sync.set({ settings: merged }, () => resolve(merged)));
    });
}

function getLocal(key, fallback) {
    return new Promise(resolve => {
        chrome.storage.local.get([key], (data) => resolve(data[key] ?? fallback));
    });
}

function setLocal(key, value) {
    return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
}

function fmtBytes(mb) {
    if (mb < 1024) return `${mb} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

if (typeof module !== "undefined") {
    module.exports = { TC, urlMatchesAny, getDomain, effectiveThreshold, getSettings, setSettings, getLocal, setLocal, fmtBytes, fmtDuration };
}
