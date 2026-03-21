document.addEventListener('DOMContentLoaded', async () => {
    const enabledToggle = document.getElementById('enabledToggle');
    const thresholdSelect = document.getElementById('thresholdSelect');
    const buriedCountEl = document.getElementById('buriedCount');

    // Load initial settings
    const settings = await chrome.storage.sync.get(['enabled', 'threshold', 'tabsBuried']);
    
    enabledToggle.checked = settings.enabled !== false; // Default to true if undefined
    
    if (settings.threshold) {
        thresholdSelect.value = settings.threshold.toString();
    } else {
        thresholdSelect.value = "7200000"; // Default 2 hours
    }

    if (settings.tabsBuried) {
        buriedCountEl.textContent = settings.tabsBuried.toLocaleString();
    } else {
        buriedCountEl.textContent = "0";
    }

    // Save settings on changes
    enabledToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ enabled: enabledToggle.checked });
    });

    thresholdSelect.addEventListener('change', () => {
        chrome.storage.sync.set({ threshold: parseInt(thresholdSelect.value, 10) });
    });

    // Listen for storage changes to update tabs buried live if popup is open
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.tabsBuried) {
            buriedCountEl.textContent = changes.tabsBuried.newValue.toLocaleString();
        }
    });
});
