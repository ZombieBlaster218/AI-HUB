// ═══════════════════════════════════════════════════════════════════════
// app/webview.js — Webview creation and management
//
// Creates, destroys, and manages webview elements. Handles webview
// events (loading, navigation, IPC from preload, context menu triggers).
//
// Dependencies: app/state.js, app/clipboard.js, app/zoom.js,
//   app/context-menu.js (showWebviewContextMenu, closeContextMenu),
//   app/transfer.js (closeTransferPopup)
// ═══════════════════════════════════════════════════════════════════════

// ── WebView events ──────────────────────────────────────────────────
function setupWebviewEvents() {
  // Events are attached per-webview in createWebviewElement()
  // This function sets up the + sub-tab button
  document.getElementById('sub-tab-add').addEventListener('click', () => {
    showNewTabMenu();
  });
}

function createWebviewElement(tabId, ai, profileId, url) {
  const container = document.getElementById('webview-container');
  const profile = getProfile(ai, profileId);

  const wv = document.createElement('webview');
  wv.id = 'wv-' + tabId;
  wv.dataset.tabId = tabId;
  wv.dataset.ai = ai;
  wv.dataset.profileId = profileId;
  wv.src = url;
  wv.partition = profile.partition;
  wv.useragent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  wv.allowpopups = true;
  wv.preload = 'webview-preload.js';

  container.appendChild(wv);
  webviewElements[tabId] = wv;

  // Attach event listeners
  wv.addEventListener('did-start-loading', () => {
    if (activeTabId[activeAI] === tabId) showLoading(true);
  });
  wv.addEventListener('did-stop-loading', () => {
    if (activeTabId[activeAI] === tabId) { showLoading(false); updateUrlDisplay(); }
    // Update tab title from page (only re-render subtabs for active AI)
    try {
      const title = wv.getTitle();
      if (title) {
        const tab = tabs[ai].find(t => t.id === tabId);
        if (tab) {
          tab.title = title;
          if (ai === activeAI) renderSubTabs(ai);
        }
      }
    } catch(e) {}
    // Mark webview as loaded for welcome page auto-hide
    if (typeof markWebviewLoaded === 'function') markWebviewLoaded(ai);
  });
  wv.addEventListener('did-navigate', () => {
    if (activeTabId[activeAI] === tabId) updateUrlDisplay();
    // Update tab URL
    try {
      const newUrl = wv.getURL();
      const tab = tabs[ai].find(t => t.id === tabId);
      if (tab) tab.url = newUrl;
    } catch(e) {}
  });
  wv.addEventListener('did-navigate-in-page', () => {
    if (activeTabId[activeAI] === tabId) updateUrlDisplay();
    // Update tab URL for in-page navigation too
    try {
      const newUrl = wv.getURL();
      const tab = tabs[ai].find(t => t.id === tabId);
      if (tab) tab.url = newUrl;
    } catch(e) {}
  });
  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3 && activeTabId[activeAI] === tabId) showLoading(false);
  });

  // Close popups when webview gets focus (user clicked on webview area)
  wv.addEventListener('focus', () => {
    closeAllPopups();
  });
  // Also close on mousedown/pointerdown — focus doesn't re-fire if already focused
  wv.addEventListener('mousedown', () => {
    closeContextMenu();
  });
  wv.addEventListener('pointerdown', () => {
    closeContextMenu();
  });

  // Right-click context menu via preload IPC (more reliable than webview context-menu event)
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'context-menu') {
      try {
        const params = JSON.parse(e.args[0]);
        showWebviewContextMenu(params, ai, profileId, wv);
      } catch(err) {}
    }
    if (e.channel === 'webview-clicked') {
      // Left-click inside webview — close any open context menu
      closeContextMenu();
    }
    if (e.channel === 'zoom-wheel') {
      const direction = e.args[0];
      if (direction === 'in') zoomIn();
      else if (direction === 'out') zoomOut();
    }

  });

  return wv;
}

// ── Close all open popups ────────────────────────────────────────────
function closeAllPopups() {
  closeTransferPopup();
  // Close new tab menu if open
  const menu = document.getElementById('new-tab-menu');
  const overlay = document.getElementById('new-tab-overlay');
  if (menu) menu.remove();
  if (overlay) overlay.style.display = 'none';
  // Close context menus
  closeContextMenu();
}

function destroyWebviewElement(tabId) {
  const wv = webviewElements[tabId];
  if (wv) {
    wv.remove();
    delete webviewElements[tabId];
  }
}

function showLoading(show) { loadingOverlay.classList.toggle('visible', show); }

function updateUrlDisplay() {
  const wv = getActiveWebview();
  try { urlDisplay.textContent = (wv ? wv.getURL() : null) || AI_CONFIG[activeAI].home; }
  catch(e) { urlDisplay.textContent = AI_CONFIG[activeAI].home; }
  updateActivePin();
}
