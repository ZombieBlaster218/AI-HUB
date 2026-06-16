// ═══════════════════════════════════════════════════════════════════════
// app/zoom.js — Zoom-related functions
//
// Manages per-AI zoom levels, keyboard shortcuts, IPC zoom from
// main process, and zoom wheel from webview preload.
//
// Dependencies: app/state.js (zoomLevels, activeAI, tabs, webviewElements)
// ═══════════════════════════════════════════════════════════════════════

const ZOOM_STEP = 10;
const ZOOM_MIN = 30;
const ZOOM_MAX = 300;

function applyZoom(ai, level) {
  level = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(level / ZOOM_STEP) * ZOOM_STEP));
  zoomLevels[ai] = level;
  // Apply zoom to all webviews of this AI
  tabs[ai].forEach(tab => {
    const wv = webviewElements[tab.id];
    if (wv) {
      try {
        const zoomLevel = Math.log(level / 100) / Math.log(1.2);
        wv.setZoomLevel(zoomLevel);
      } catch(e) {}
    }
  });
  // Show zoom indicator on active AI
  if (ai === activeAI) showZoomIndicator(level);
  // Debounced save
  clearTimeout(applyZoom._saveTimer);
  applyZoom._saveTimer = setTimeout(() => saveZoomLevels(), 500);
}

async function saveZoomLevels() {
  try {
    const saved = await window.electronAPI.getSettings();
    saved.zoomLevels = { ...zoomLevels };
    await window.electronAPI.saveSettings(saved);
  } catch(e) {}
}

function zoomIn() {
  applyZoom(activeAI, zoomLevels[activeAI] + ZOOM_STEP);
}

function zoomOut() {
  applyZoom(activeAI, zoomLevels[activeAI] - ZOOM_STEP);
}

function zoomReset() {
  applyZoom(activeAI, 100);
}

function showZoomIndicator(level) {
  let indicator = document.getElementById('zoom-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'zoom-indicator';
    indicator.style.cssText = 'position:absolute;bottom:40px;right:20px;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:12px;z-index:20;opacity:0;transition:opacity 0.2s;pointer-events:none;';
    document.getElementById('webview-container').appendChild(indicator);
  }
  indicator.textContent = `${level}%`;
  indicator.style.opacity = '1';
  clearTimeout(indicator._timer);
  indicator._timer = setTimeout(() => { indicator.style.opacity = '0'; }, 1500);
}

function setupZoomHotkeys() {
  // Keyboard zoom when focus is NOT in webview (e.g. on sidebar, nav bar)
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('settings-modal').classList.contains('open')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.ctrlKey && !e.altKey && !e.shiftKey) {
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); zoomIn(); }
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut(); }
      else if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); zoomReset(); }
    }
  });
}

// Zoom via IPC from main process (intercepted from webview's before-input-event)
function setupZoomIPC() {
  window.electronAPI.onZoomIn(() => zoomIn());
  window.electronAPI.onZoomOut(() => zoomOut());
  window.electronAPI.onZoomReset(() => zoomReset());
}

// Ctrl+wheel zoom via webview preload (ipc-message from webview)
function setupWebviewZoomWheel() {
  // Handled in createWebviewElement() — per-webview ipc-message listener
  // covers context-menu, zoom-wheel, and other IPC channels
}
