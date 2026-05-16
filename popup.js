// popup.js - UI controller

const $ = (id) => document.getElementById(id);

const els = {
    enabled: $("enabledToggle"),
    mode: $("modeSelect"),
    threshold: $("thresholdSelect"),
    respectIdle: $("respectIdle"),
    notify: $("notifyOnBury"),
    excludePinned: $("excludePinned"),
    excludeAudible: $("excludeAudible"),
    excludeGrouped: $("excludeGrouped"),
    excludeIncognito: $("excludeIncognito"),
    buryNow: $("buryNowBtn"),
    restoreLast: $("restoreLastBtn"),
    graveCount: $("graveCount"),
    graveList: $("graveList"),
    graveSearch: $("graveSearch"),
    restoreAll: $("restoreAllBtn"),
    emptyGrave: $("emptyGraveBtn"),
    ruleInput: $("ruleInput"),
    addRule: $("addRuleBtn"),
    ruleList: $("ruleList"),
    totalBuried: $("totalBuried"),
    todayBuried: $("todayBuried"),
    ramSaved: $("ramSaved"),
    resetStats: $("resetStatsBtn"),
    toast: $("toast")
};

let settings = { ...TC.DEFAULTS };
let graveyard = [];

document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    await loadSettings();
    bindSettingsEvents();
    bindActions();
    await refreshGraveyard();
    await refreshStats();
    renderRules();
});

function setupTabs() {
    document.querySelectorAll(".tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            $("tab-" + btn.dataset.tab).classList.add("active");
            if (btn.dataset.tab === "graveyard") refreshGraveyard();
            if (btn.dataset.tab === "stats") refreshStats();
        });
    });
}

async function loadSettings() {
    settings = await getSettings();
    els.enabled.checked = settings.enabled;
    els.mode.value = settings.mode;
    els.threshold.value = String(settings.threshold);
    els.respectIdle.checked = settings.respectIdle;
    els.notify.checked = settings.notifyOnBury;
    els.excludePinned.checked = settings.excludePinned;
    els.excludeAudible.checked = settings.excludeAudible;
    els.excludeGrouped.checked = settings.excludeGrouped;
    els.excludeIncognito.checked = settings.excludeIncognito;
}

function bindSettingsEvents() {
    els.enabled.addEventListener("change", () => save({ enabled: els.enabled.checked }));
    els.mode.addEventListener("change", () => save({ mode: els.mode.value }));
    els.threshold.addEventListener("change", () => save({ threshold: parseInt(els.threshold.value, 10) }));
    [
        ["respectIdle", "respectIdle"],
        ["notify", "notifyOnBury"],
        ["excludePinned", "excludePinned"],
        ["excludeAudible", "excludeAudible"],
        ["excludeGrouped", "excludeGrouped"],
        ["excludeIncognito", "excludeIncognito"]
    ].forEach(([elKey, settingKey]) => {
        els[elKey].addEventListener("change", () => save({ [settingKey]: els[elKey].checked }));
    });
}

async function save(partial) {
    settings = await setSettings(partial);
    toast("Saved");
}

function bindActions() {
    els.buryNow.addEventListener("click", async () => {
        const r = await sendMessage({ type: "buryIdleNow" });
        toast(`Buried ${r?.count || 0} tab${r?.count === 1 ? "" : "s"}`);
        await refreshGraveyard();
        await refreshStats();
    });

    els.restoreLast.addEventListener("click", async () => {
        const r = await sendMessage({ type: "restoreLast" });
        toast(r?.restored ? "Restored" : "Nothing to restore");
        await refreshGraveyard();
    });

    els.restoreAll.addEventListener("click", async () => {
        const r = await sendMessage({ type: "restoreAll" });
        toast(`Restored ${r?.count || 0}`);
        await refreshGraveyard();
    });

    els.emptyGrave.addEventListener("click", async () => {
        const r = await sendMessage({ type: "emptyGraveyard" });
        toast(`Emptied ${r?.count || 0}`);
        await refreshGraveyard();
    });

    els.graveSearch.addEventListener("input", () => renderGraveyard());

    els.addRule.addEventListener("click", async () => {
        const v = els.ruleInput.value.trim();
        if (!v) return;
        await sendMessage({ type: "addAllowPattern", pattern: v });
        els.ruleInput.value = "";
        settings = await getSettings();
        renderRules();
        toast("Rule added");
    });

    els.ruleInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") els.addRule.click();
    });

    els.resetStats.addEventListener("click", async () => {
        await sendMessage({ type: "resetStats" });
        await refreshStats();
        toast("Stats reset");
    });
}

async function refreshGraveyard() {
    const r = await sendMessage({ type: "getGraveyard" });
    graveyard = r?.graveyard || [];
    renderGraveyard();
}

function renderGraveyard() {
    const q = els.graveSearch.value.trim().toLowerCase();
    const filtered = q
        ? graveyard.filter(x => (x.title || "").toLowerCase().includes(q) || (x.url || "").toLowerCase().includes(q))
        : graveyard;
    els.graveCount.textContent = graveyard.length;
    clearChildren(els.graveList);
    if (!filtered.length) {
        els.graveList.appendChild(empty(q ? "No matches" : "Graveyard empty"));
        return;
    }
    filtered.forEach(item => els.graveList.appendChild(graveRow(item)));
}

function graveRow(item) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.className = "favicon";
    img.src = item.favicon || faviconFallback(item.url);
    img.alt = "";
    img.onerror = () => { img.src = faviconFallback(item.url); };

    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = item.title || item.url;
    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = `${getDomain(item.url)} · ${fmtDuration(Date.now() - item.buriedAt)} ago`;
    meta.appendChild(title);
    meta.appendChild(sub);

    const restoreBtn = iconBtn("Restore", svgArrow(), async () => {
        await sendMessage({ type: "restoreOne", id: item.id });
        toast("Restored");
        await refreshGraveyard();
    });

    li.appendChild(img);
    li.appendChild(meta);
    li.appendChild(restoreBtn);
    return li;
}

function faviconFallback(url) {
    const d = getDomain(url);
    if (!d) return "icons/icon16.png";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=32`;
}

function renderRules() {
    clearChildren(els.ruleList);
    const list = settings.excludePatterns || [];
    if (!list.length) {
        els.ruleList.appendChild(empty("No exclusion rules"));
        return;
    }
    list.forEach(pattern => {
        const li = document.createElement("li");
        const txt = document.createElement("div");
        txt.className = "meta";
        const t = document.createElement("div");
        t.className = "title";
        t.textContent = pattern;
        txt.appendChild(t);
        const del = iconBtn("Remove", svgX(), async () => {
            await sendMessage({ type: "removeAllowPattern", pattern });
            settings = await getSettings();
            renderRules();
            toast("Removed");
        });
        li.appendChild(txt);
        li.appendChild(del);
        els.ruleList.appendChild(li);
    });
}

async function refreshStats() {
    const r = await sendMessage({ type: "getStats" });
    const stats = r?.stats || { total: 0, byDay: {}, ramSavedMb: 0 };
    els.totalBuried.textContent = stats.total.toLocaleString();
    const today = new Date().toISOString().slice(0, 10);
    els.todayBuried.textContent = (stats.byDay[today] || 0).toLocaleString();
    els.ramSaved.textContent = fmtBytes(stats.ramSavedMb || 0);
}

function iconBtn(title, svgEl, onClick) {
    const b = document.createElement("button");
    b.className = "icon-btn";
    b.title = title;
    b.appendChild(svgEl);
    b.addEventListener("click", onClick);
    return b;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgBase() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    return svg;
}
function svgChild(parent, tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    parent.appendChild(el);
}
function svgArrow() {
    const s = svgBase();
    svgChild(s, "path", { d: "M3 12a9 9 0 1 0 3-6.7" });
    svgChild(s, "polyline", { points: "3 4 3 10 9 10" });
    return s;
}
function svgX() {
    const s = svgBase();
    svgChild(s, "line", { x1: 18, y1: 6, x2: 6, y2: 18 });
    svgChild(s, "line", { x1: 6, y1: 6, x2: 18, y2: 18 });
    return s;
}

function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function empty(text) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    return li;
}

function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 1500);
}

function sendMessage(msg) {
    return new Promise(resolve => {
        try { chrome.runtime.sendMessage(msg, (r) => resolve(r)); }
        catch (_) { resolve(null); }
    });
}
