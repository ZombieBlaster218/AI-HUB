// ═══════════════════════════════════════════════════════════════════════
// app/clipboard.js — Clipboard and text injection utilities
//
// Pure utility functions with no side effects beyond clipboard/DOM.
// Used by context-menu, transfer, sidebar, and webview modules.
//
// Dependencies: none (only uses browser APIs and electronAPI)
// ═══════════════════════════════════════════════════════════════════════

// ── Inject text into webview input field ─────────────────────────────
// Same mechanism as the transfer feature (arrow button). Uses
// executeJavaScript to directly set the value of textarea/contenteditable,
// bypassing navigator.clipboard entirely.
function injectTextIntoWebview(webview, text) {
  try {
    webview.executeJavaScript(`
      (function() {
        var text = ${JSON.stringify(text)};
        // Try activeElement first (user clicked in the field)
        var el = document.activeElement;
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
          var start = el.selectionStart || 0;
          var end = el.selectionEnd || 0;
          var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (setter && setter.set) setter.set.call(el, el.value.slice(0, start) + text + el.value.slice(end));
          else el.value = el.value.slice(0, start) + text + el.value.slice(end);
          el.selectionStart = el.selectionEnd = start + text.length;
          el.dispatchEvent(new Event('input', {bubbles:true}));
          el.dispatchEvent(new Event('change', {bubbles:true}));
          return true;
        }
        if (el && el.isContentEditable) {
          el.focus();
          document.execCommand('insertText', false, text);
          return true;
        }
        // Fallback: find the chat input field
        var ta = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]') || document.querySelector('[role="textbox"]');
        if (ta) {
          if (ta.tagName === 'TEXTAREA' || ta.tagName === 'INPUT') {
            var s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (s && s.set) s.set.call(ta, text);
            else ta.value = text;
            ta.dispatchEvent(new Event('input', {bubbles:true}));
            ta.dispatchEvent(new Event('change', {bubbles:true}));
            ta.focus();
          } else {
            ta.focus();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, text);
          }
          return true;
        }
        return false;
      })()
    `).catch(() => {});
  } catch(e) {}
}

function copyToClipboard(text) {
  try {
    // Use Electron's clipboard via IPC — always works regardless of sandbox
    if (window.electronAPI && window.electronAPI.writeClipboardText) {
      window.electronAPI.writeClipboardText(text).catch(() => {
        // IPC failed, try fallback
        fallbackCopyText(text);
      });
      return;
    }
    // Fallback to navigator.clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        fallbackCopyText(text);
      });
      return;
    }
    // Final fallback: create temp textarea
    fallbackCopyText(text);
  } catch(e) {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ── HTML / URL helpers ──────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function shortUrl(url) {
  try { const u = new URL(url); return u.pathname.length > 1 ? u.hostname + u.pathname.slice(0,30) : u.hostname; }
  catch { return url; }
}
