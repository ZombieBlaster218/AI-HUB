// Webview preload script — intercepts Ctrl+wheel for custom zoom handling,
// forwards clicks to close context menu, and intercepts right-click for
// custom context menu.
//
// NOTE: In Electron 30+ with contextIsolation (default), this script runs in
// an ISOLATED world. Clipboard operations are handled by the renderer process
// via executeJavaScript + IPC — no navigator.clipboard polyfill needed.

const { ipcRenderer } = require('electron');

// Capture Ctrl+wheel events and forward to host renderer
document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.sendToHost('zoom-wheel', e.deltaY < 0 ? 'in' : 'out');
  }
}, { passive: false, capture: true });

// ── Forward left-clicks to host renderer ────────────────────────────
// Used to close the context menu when the user clicks inside the webview.
document.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    ipcRenderer.sendToHost('webview-clicked');
  }
}, true);

// ── Intercept right-click context menu ──────────────────────────────
// Must run in capture phase BEFORE the page can call preventDefault()
// so that our context menu always works even on sites that block right-click
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();

  const info = {
    x: e.clientX,
    y: e.clientY,
    linkURL: '',
    selectionText: window.getSelection()?.toString() || '',
    mediaType: 'none',
    srcURL: '',
    editable: false,
  };

  // Check if right-clicked in an editable field
  const tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    info.editable = true;
  } else if (e.target.isContentEditable) {
    info.editable = true;
  }

  // Walk up the DOM to find a link
  let el = e.target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.tagName === 'A' && el.href) {
      info.linkURL = el.href;
      break;
    }
    el = el.parentElement;
  }

  // Check if right-clicked on an image
  if (e.target.tagName === 'IMG' && e.target.src) {
    info.mediaType = 'image';
    info.srcURL = e.target.src;
  }

  ipcRenderer.sendToHost('context-menu', JSON.stringify(info));
}, { capture: true });

// ── Clipboard: cut ──────────────────────────────────────────────────
// Used by the context menu "Cut" action — executes document.execCommand('cut')
// which works inside the webview where we have DOM access.
ipcRenderer.on('do-cut', () => {
  document.execCommand('cut');
});
