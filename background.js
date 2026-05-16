// background.js - Tab Cemetery worker

if (typeof importScripts === "function" && typeof TC === "undefined") {
    try { importScripts("utils.js"); } catch (_) { /* scripts fallback already loaded utils.js */ }
}

const ALARM_SWEEP = "cemeterySweep";
const STORAGE_KEYS = {
    graveyard: "graveyard",        // array of {url,title,favicon,buriedAt,reason}
    stats: "stats",                // { total, byDay: { "YYYY-MM-DD": n }, ramSavedMb }
    undoStack: "undoStack",        // [{tabId|null, restoreInfo, expires}]
    lastActivity: "lastActivity"   // { [tabId]: timestamp }
};

chrome.runtime.onInstalled.addListener(async () => {
    const data = await new Promise(r => chrome.storage.sync.get(["settings"], r));
    if (!data.settings) await new Promise(r => chrome.storage.sync.set({ settings: TC.DEFAULTS }, r));
    else await new Promise(r => chrome.storage.sync.set({ settings: { ...TC.DEFAULTS, ...data.settings } }, r));

    chrome.alarms.create(ALARM_SWEEP, { periodInMinutes: TC.SWEEP_MINUTES });
    setupContextMenus();
});

chrome.runtime.onStartup?.addListener(() => {
    chrome.alarms.create(ALARM_SWEEP, { periodInMinutes: TC.SWEEP_MINUTES });
    setupContextMenus();
});

function setupContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: "tc-bury", title: "Bury this tab", contexts: ["action", "page"] });
        chrome.contextMenus.create({ id: "tc-allow-domain", title: "Never bury this site", contexts: ["action", "page"] });
        chrome.contextMenus.create({ id: "tc-bury-idle-now", title: "Bury all idle tabs now", contexts: ["action"] });
        chrome.contextMenus.create({ id: "tc-restore-last", title: "Restore last buried", contexts: ["action"] });
    });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "tc-bury" && tab) await buryTab(tab, "manual");
    else if (info.menuItemId === "tc-allow-domain" && tab?.url) await addDomainToAllowlist(tab.url);
    else if (info.menuItemId === "tc-bury-idle-now") await performSweep(true);
    else if (info.menuItemId === "tc-restore-last") await restoreLast();
});

chrome.commands.onCommand.addListener(async (cmd) => {
    if (cmd === "bury-active") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await buryTab(tab, "shortcut");
    } else if (cmd === "restore-last") {
        await restoreLast();
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_SWEEP) performSweep(false);
});

// Track tab activity to refine "idle" beyond lastAccessed (which some browsers omit).
chrome.tabs.onActivated.addListener(({ tabId }) => bumpActivity(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete" || info.audible !== undefined) bumpActivity(tabId);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const map = await getLocal(STORAGE_KEYS.lastActivity, {});
    delete map[tabId];
    await setLocal(STORAGE_KEYS.lastActivity, map);
});

async function bumpActivity(tabId) {
    const map = await getLocal(STORAGE_KEYS.lastActivity, {});
    map[tabId] = nowMs();
    await setLocal(STORAGE_KEYS.lastActivity, map);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg).then(sendResponse).catch(err => sendResponse({ error: String(err) }));
    return true;
});

async function handleMessage(msg) {
    switch (msg?.type) {
        case "buryActive": {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return { ok: false };
            await buryTab(tab, "manual");
            return { ok: true };
        }
        case "buryIdleNow": return { ok: true, count: await performSweep(true) };
        case "restoreOne": return { ok: true, restored: await restoreById(msg.id) };
        case "restoreLast": return { ok: true, restored: await restoreLast() };
        case "restoreAll": return { ok: true, count: await restoreAll() };
        case "emptyGraveyard": return { ok: true, count: await emptyGraveyard() };
        case "getGraveyard": return { graveyard: await getLocal(STORAGE_KEYS.graveyard, []) };
        case "getStats": return { stats: await getLocal(STORAGE_KEYS.stats, defaultStats()) };
        case "resetStats": await setLocal(STORAGE_KEYS.stats, defaultStats()); return { ok: true };
        case "addAllowDomain": await addDomainToAllowlist(msg.url); return { ok: true };
        case "removeAllowPattern": return { ok: true, settings: await removeAllowPattern(msg.pattern) };
        case "addAllowPattern": return { ok: true, settings: await addAllowPattern(msg.pattern) };
    }
    return { ok: false };
}

function defaultStats() {
    return { total: 0, byDay: {}, ramSavedMb: 0 };
}

async function performSweep(force) {
    const settings = await getSettings();
    if (!settings.enabled && !force) return 0;

    if (settings.respectIdle && !force) {
        const state = await new Promise(r => chrome.idle.queryState(60, r));
        if (state === "active") return 0;
    }

    const tabs = await chrome.tabs.query({});
    const now = nowMs();
    const activity = await getLocal(STORAGE_KEYS.lastActivity, {});
    let count = 0;

    for (const tab of tabs) {
        if (!await isBuryable(tab, settings)) continue;

        const seen = Math.max(tab.lastAccessed || 0, activity[tab.id] || 0);
        const idle = seen ? now - seen : 0;
        const limit = effectiveThreshold(tab.url, settings);
        if (idle < limit) continue;

        try {
            await buryTab(tab, "auto");
            count++;
        } catch (e) { /* ignore */ }
    }
    return count;
}

async function isBuryable(tab, settings) {
    if (!tab || tab.active) return false;
    if (settings.excludePinned && tab.pinned) return false;
    if (settings.excludeAudible && tab.audible) return false;
    if (settings.excludeIncognito && tab.incognito) return false;
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("about:") || tab.url.startsWith("edge://") || tab.url.startsWith("moz-extension://") || tab.url.startsWith("chrome-extension://")) return false;
    if (urlMatchesAny(tab.url, settings.excludePatterns)) return false;
    if (settings.excludeGrouped && tab.groupId !== undefined && tab.groupId !== -1) {
        try {
            const group = await chrome.tabGroups.get(tab.groupId);
            if (group && group.title && group.title !== TC.CEMETERY_GROUP_TITLE) return false;
        } catch (_) { /* group api unavailable */ }
    }
    return true;
}

async function buryTab(tab, reason) {
    const settings = await getSettings();
    const snapshot = {
        url: tab.url,
        title: tab.title || tab.url,
        favicon: tab.favIconUrl || "",
        windowId: tab.windowId,
        buriedAt: nowMs(),
        reason
    };

    if (settings.mode === TC.MODES.DISCARD) {
        try { await chrome.tabs.discard(tab.id); } catch (_) { return; }
        await recordBury(snapshot, false);
        notify(`Discarded: ${snapshot.title}`);
        return;
    }

    if (settings.mode === TC.MODES.GROUP) {
        try {
            const groupId = await ensureCemeteryGroup(tab.windowId);
            if (groupId !== null) {
                await chrome.tabs.group({ groupIds: [tab.id], tabIds: [tab.id], groupId });
                try { await chrome.tabs.discard(tab.id); } catch (_) {}
                await recordBury(snapshot, false);
                notify(`Moved to Cemetery: ${snapshot.title}`);
                return;
            }
        } catch (_) { /* fall through to close */ }
    }

    // CLOSE mode
    await recordBury(snapshot, true);
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
    await pushUndo(snapshot);
    notify(`Buried: ${snapshot.title}`, snapshot);
}

async function ensureCemeteryGroup(windowId) {
    try {
        const groups = await chrome.tabGroups.query({ windowId });
        const existing = groups.find(g => g.title === TC.CEMETERY_GROUP_TITLE);
        if (existing) return existing.id;
        const [anyTab] = await chrome.tabs.query({ windowId, active: false });
        if (!anyTab) return null;
        const id = await chrome.tabs.group({ tabIds: [anyTab.id] });
        await chrome.tabGroups.update(id, { title: TC.CEMETERY_GROUP_TITLE, color: TC.CEMETERY_GROUP_COLOR, collapsed: true });
        return id;
    } catch (_) { return null; }
}

async function recordBury(snapshot, addToGraveyard) {
    const stats = await getLocal(STORAGE_KEYS.stats, defaultStats());
    stats.total = (stats.total || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;
    stats.ramSavedMb = (stats.ramSavedMb || 0) + TC.AVG_TAB_RAM_MB;
    await setLocal(STORAGE_KEYS.stats, stats);

    if (addToGraveyard) {
        const list = await getLocal(STORAGE_KEYS.graveyard, []);
        list.unshift({ id: cryptoId(), ...snapshot });
        await setLocal(STORAGE_KEYS.graveyard, list.slice(0, TC.GRAVEYARD_LIMIT));
    }
    updateBadge();
}

function cryptoId() {
    const a = new Uint32Array(2);
    crypto.getRandomValues(a);
    return a[0].toString(36) + a[1].toString(36);
}

async function pushUndo(snapshot) {
    const stack = await getLocal(STORAGE_KEYS.undoStack, []);
    stack.unshift({ snapshot, expires: nowMs() + TC.UNDO_WINDOW_MS });
    await setLocal(STORAGE_KEYS.undoStack, stack.slice(0, 10));
}

async function restoreLast() {
    const stack = await getLocal(STORAGE_KEYS.undoStack, []);
    const fresh = stack.filter(x => x.expires > nowMs());
    const next = fresh.shift();
    await setLocal(STORAGE_KEYS.undoStack, fresh);
    if (next) {
        await chrome.tabs.create({ url: next.snapshot.url, active: false });
        await removeFromGraveyardByUrl(next.snapshot.url);
        return true;
    }
    // Fallback: pop newest grave entry
    const list = await getLocal(STORAGE_KEYS.graveyard, []);
    if (!list.length) return false;
    const top = list.shift();
    await setLocal(STORAGE_KEYS.graveyard, list);
    await chrome.tabs.create({ url: top.url, active: false });
    return true;
}

async function restoreById(id) {
    const list = await getLocal(STORAGE_KEYS.graveyard, []);
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) return false;
    const [item] = list.splice(idx, 1);
    await setLocal(STORAGE_KEYS.graveyard, list);
    await chrome.tabs.create({ url: item.url, active: true });
    return true;
}

async function restoreAll() {
    const list = await getLocal(STORAGE_KEYS.graveyard, []);
    if (!list.length) return 0;
    for (const item of list) await chrome.tabs.create({ url: item.url, active: false });
    await setLocal(STORAGE_KEYS.graveyard, []);
    return list.length;
}

async function emptyGraveyard() {
    const list = await getLocal(STORAGE_KEYS.graveyard, []);
    await setLocal(STORAGE_KEYS.graveyard, []);
    return list.length;
}

async function removeFromGraveyardByUrl(url) {
    const list = await getLocal(STORAGE_KEYS.graveyard, []);
    const next = list.filter(x => x.url !== url);
    if (next.length !== list.length) await setLocal(STORAGE_KEYS.graveyard, next);
}

async function addDomainToAllowlist(url) {
    const domain = getDomain(url);
    if (!domain) return;
    const pattern = `*://*.${domain}/*`;
    return addAllowPattern(pattern);
}

async function addAllowPattern(pattern) {
    const s = await getSettings();
    const set = new Set(s.excludePatterns || []);
    set.add(pattern);
    return setSettings({ excludePatterns: [...set] });
}

async function removeAllowPattern(pattern) {
    const s = await getSettings();
    const next = (s.excludePatterns || []).filter(p => p !== pattern);
    return setSettings({ excludePatterns: next });
}

async function updateBadge() {
    try {
        const stats = await getLocal(STORAGE_KEYS.stats, defaultStats());
        const text = stats.total > 999 ? "999+" : String(stats.total || 0);
        await chrome.action.setBadgeText({ text: stats.total ? text : "" });
        await chrome.action.setBadgeBackgroundColor({ color: "#4a3461" });
    } catch (_) {}
}

function notify(message, snapshot) {
    getSettings().then(s => {
        if (!s.notifyOnBury) return;
        try {
            const id = "tc-" + Math.random().toString(36).slice(2);
            chrome.notifications.create(id, {
                type: "basic",
                iconUrl: "icons/icon128.png",
                title: "Tab Cemetery",
                message,
                priority: 0
            });
            setTimeout(() => chrome.notifications.clear(id), 4000);
        } catch (_) {}
    });
}

updateBadge();
