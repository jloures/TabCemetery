# Tab Cemetery 🪦

A sleek, minimalist browser extension that automatically sweeps and closes inactive tabs to save memory and reduce visual clutter. Built using modern Manifest V3 standards.

![Tab Cemetery Icon](icons/icon128.png)

## Features
- **The Reaper (Auto-Cleanup):** Automatically purges tabs that have been inactive longer than your customized threshold.
- **Smart Guardrails:** Built-in intelligence ensures it **never** closes active tabs, pinned tabs, or any tabs actively playing audio (like Spotify or YouTube).
- **Customizable Inactivity Thresholds:** Choose when a tab is considered "dead" (options ranging from 30 minutes to 24 hours).
- **Buried Tab Counter:** A fun visual tracker built into the dark-mode popup that counts the total number of tabs the extension has successfully buried since installation.

## Installation
### For Testing & Development
1. Clone this repository or download the source code locally.
2. Open your chromium-based browser and navigate to `chrome://extensions/` (or `edge://extensions/` for Edge).
3. Toggle on **Developer Mode** in the top-right corner.
4. Click **Load unpacked** and select the folder encompassing this extension's code.
5. Click the graveyard icon on your toolbar to configure your Reaper settings!

### Production Packaging
Create a `.zip` archive containing everything in this directory (minus any `.git` files or `.gitignore`) to submit directly to the Chrome Web Store.

## Technical Details
- Built with Vanilla HTML, CSS, and JavaScript. 
- Very lightweight footprint: `0` external dependencies or frameworks.
- Relies cleanly on the Manifest V3 `chrome.alarms` API for 5-minute background sweeps to prevent constant polling.
- Data securely persists across extension reloads natively via `chrome.storage.sync`.

## License
Provided under the [MIT License](LICENSE).
