const DEFAULT_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours in ms
const SWEEP_INTERVAL = 1; // 1 minute

// Initialize settings and alarms on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['enabled', 'threshold', 'tabsBuried'], (result) => {
    const defaultSettings = {};
    if (result.enabled === undefined) defaultSettings.enabled = true;
    if (result.threshold === undefined) defaultSettings.threshold = DEFAULT_THRESHOLD;
    if (result.tabsBuried === undefined) defaultSettings.tabsBuried = 0;

    if (Object.keys(defaultSettings).length > 0) {
      chrome.storage.sync.set(defaultSettings);
    }
  });

  chrome.alarms.create("cemeterySweep", { periodInMinutes: SWEEP_INTERVAL });
});

// Run sweep when alarm triggers (Reliable production method)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "cemeterySweep") {
    performSweep();
  }
});

async function performSweep() {
  const { enabled, threshold, tabsBuried } = await chrome.storage.sync.get(['enabled', 'threshold', 'tabsBuried']);

  if (!enabled) return;

  const thresholdMs = threshold || DEFAULT_THRESHOLD;
  const now = Date.now();

  // Query all tabs that are not pinned and not playing audio
  const tabs = await chrome.tabs.query({ pinned: false, audible: false });
  let buriedCount = tabsBuried || 0;

  for (const tab of tabs) {
    // Never close active tabs
    if (tab.active) continue;

    const lastAccessed = tab.lastAccessed || now; // fallback if undefined
    const idleTime = now - lastAccessed;

    if (idleTime > thresholdMs) {
      await chrome.tabs.remove(tab.id);
      buriedCount++;
    }
  }

  if (buriedCount !== tabsBuried) {
    await chrome.storage.sync.set({ tabsBuried: buriedCount });
  }
}
