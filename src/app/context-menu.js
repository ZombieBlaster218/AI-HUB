// ═══════════════════════════════════════════════════════════════════════
// app/context-menu.js — Webview context menu
//
// Shows a right-click context menu in webviews with options for
// navigation, clipboard, pin/unpin, smart copy (extract last response/
// prompt), paste-into-chat, and zoom controls. Also provides the
// shared closeContextMenu() function used by all context menus.
//
// Dependencies: app/state.js, app/clipboard.js (copyToClipboard, injectTextIntoWebview, escapeHtml),
//   app/zoom.js (applyZoom, zoomIn, zoomOut), app/sidebar.js (renderSidebar, updateSidebarTabCounts)
// ═══════════════════════════════════════════════════════════════════════

// ── Webview context menu ────────────────────────────────────────────
function showWebviewContextMenu(params, ai, profileId, wv) {
  closeContextMenu();

  const menu = document.createElement('div');
  menu.id = 'webview-context-menu';
  menu.className = 'context-menu';

  let html = '';

  // Navigation section
  const canBack = wv.canGoBack();
  const canForward = wv.canGoForward();
  if (canBack)  html += `<div class="ctx-item" data-action="back">◀ Назад</div>`;
  if (canForward) html += `<div class="ctx-item" data-action="forward">Вперёд ▶</div>`;
  html += `<div class="ctx-item" data-action="reload">⟳ Перезагрузить</div>`;

  if (canBack || canForward) html += `<div class="ctx-sep"></div>`;

  // Copy / Clipboard section
  if (params.selectionText) {
    html += `<div class="ctx-item" data-action="copy-selection">📋 Копировать выделенное</div>`;
  }
  if (params.editable) {
    html += `<div class="ctx-item" data-action="cut">✂ Вырезать</div>`;
    html += `<div class="ctx-item" data-action="paste">📄 Вставить</div>`;
  }

  html += `<div class="ctx-sep"></div>`;

  // Smart copy section: extract from chat
  html += `<div class="ctx-item" data-action="copy-last-response">🤖 Копировать последний ответ</div>`;
  html += `<div class="ctx-item" data-action="copy-last-prompt">💬 Копировать последний промпт</div>`;

  // Paste into chat input
  html += `<div class="ctx-item" data-action="paste-into-chat">📝 Вставить в поле ввода</div>`;

  html += `<div class="ctx-sep"></div>`;

  // Link section
  if (params.linkURL) {
    html += `<div class="ctx-item" data-action="copy-link">🔗 Копировать ссылку</div>`;
    html += `<div class="ctx-sep"></div>`;
  }

  // Pin current page
  const currentUrl = wv.getURL();
  const currentTitle = wv.getTitle() || '';
  const pk = pinKey(ai, profileId);
  const pins = pinnedChats[pk] || [];
  const isAlreadyPinned = pins.some(p => p.url === currentUrl);
  if (!isAlreadyPinned && currentUrl) {
    html += `<div class="ctx-item" data-action="pin">📌 Закрепить страницу</div>`;
  } else if (isAlreadyPinned) {
    html += `<div class="ctx-item ctx-danger" data-action="unpin">📌 Открепить</div>`;
  }

  // Copy page URL
  html += `<div class="ctx-item" data-action="copy-url">📋 Скопировать URL</div>`;

  // Zoom section
  html += `<div class="ctx-sep"></div>`;
  const currentZoom = zoomLevels[ai] || 100;
  html += `<div class="ctx-item" data-action="zoom-in">🔍+ Увеличить (${currentZoom}%)</div>`;
  html += `<div class="ctx-item" data-action="zoom-out">🔍− Уменьшить</div>`;
  if (currentZoom !== 100) {
    html += `<div class="ctx-item" data-action="zoom-reset">🔍 Сбросить зум</div>`;
  }

  menu.innerHTML = html;
  document.body.appendChild(menu);

  // ── Detect clicks inside webview to close context menu ──
  // Webview content is a separate process — clicks inside it don't bubble to
  // the renderer DOM.  We rely on the webview-preload script forwarding left-
  // click (mousedown) events to us via IPC.  This is the only reliable way
  // because: (1) overlay elements are painted over by the webview compositor,
  // (2) window.blur doesn't fire when the webview already had focus, and
  // (3) polling document.activeElement causes the menu to close immediately
  // (the webview is already focused at the time the right-click happens).
  //
  // The IPC listener for 'webview-clicked' is registered once in
  // createWebviewTab() and simply calls closeContextMenu().

  // As a secondary mechanism, also close on window blur (handles the case
  // where the main renderer had focus and then the user clicked the webview).
  // Delay activation by 150ms to avoid the menu closing immediately when
  // the blur event fires as a side-effect of the right-click that opened it.
  let blurEnabled = false;
  setTimeout(() => { blurEnabled = true; }, 150);
  const blurHandler = () => { if (blurEnabled) closeContextMenu(); };
  window.addEventListener('blur', blurHandler);

  // Store cleanup info so closeContextMenu can tear down our listeners
  const prevCleanup = window._ctxMenuCleanup || null;
  window._ctxMenuCleanup = () => {
    window.removeEventListener('blur', blurHandler);
    if (prevCleanup) prevCleanup();
  };

  // Position menu at click location
  const wvRect = wv.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = (params.x || 0) + wvRect.left;
  let top = (params.y || 0) + wvRect.top;
  if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight) top = window.innerHeight - menuRect.height - 8;
  if (left < 0) left = 8;
  if (top < 0) top = 8;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  // Bind actions
  menu.querySelectorAll('.ctx-item[data-action]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      switch (action) {
        case 'back':
          if (wv.canGoBack()) wv.goBack();
          break;
        case 'forward':
          if (wv.canGoForward()) wv.goForward();
          break;
        case 'reload':
          wv.reload();
          break;
        case 'copy-selection':
          if (params.selectionText) {
            copyToClipboard(params.selectionText);
            showToast('Скопировано');
          }
          break;
        case 'cut':
          wv.send('do-cut');
          break;
        case 'paste':
          (async () => {
            try {
              let clipText = '';
              // Read clipboard via IPC to main process
              if (window.electronAPI && window.electronAPI.readClipboardText) {
                try { clipText = await window.electronAPI.readClipboardText(); }
                catch(e) { clipText = ''; }
              }
              if (!clipText) {
                showToast('Буфер обмена пуст');
                return;
              }
              showToast('Вставка...');
              // Inject text via executeJavaScript (same as transfer feature)
              injectTextIntoWebview(wv, clipText);
            } catch(err) {
              showToast('Ошибка вставки: ' + err.message);
            }
          })();
          break;
        case 'copy-last-response':
          wv.executeJavaScript(`
            (function() {
              function trySelectors(selectors) {
                for (var i = 0; i < selectors.length; i++) {
                  try {
                    var els = document.querySelectorAll(selectors[i]);
                    if (els.length) {
                      var t = els[els.length - 1].innerText.trim();
                      if (t) return t;
                    }
                  } catch(e) {}
                }
                return '';
              }
              var text = '';
              var hostname = location.hostname;

              // ── DeepSeek ──
              if (hostname.includes('deepseek.com')) {
                text = trySelectors(['.ds-assistant-message-main-content']);
                if (!text) {
                  var mainContent = document.querySelectorAll('.ds-assistant-message-main-content');
                  if (mainContent.length) {
                    var md = mainContent[mainContent.length - 1].querySelector('.ds-markdown');
                    text = md ? md.innerText.trim() : mainContent[mainContent.length - 1].innerText.trim();
                  }
                }
                if (!text) {
                  var mds = document.querySelectorAll('.ds-markdown, .ds-markdown--block');
                  if (mds.length) text = mds[mds.length - 1].innerText.trim();
                }
              }
              // ── Qwen ──
              else if (hostname.includes('qwen.ai')) {
                text = trySelectors([
                  '.qwen-chat-message-assistant .response-message-content',
                  '.qwen-chat-message-assistant .chat-response-message',
                  '.qwen-chat-message-assistant',
                  '.chat-response-message'
                ]);
                if (!text) {
                  var mds = document.querySelectorAll('.qwen-chat-message-assistant .markdown-body');
                  if (mds.length) text = mds[mds.length - 1].innerText.trim();
                }
              }
              // ── Z.ai / GLM ──
              else if (hostname.includes('z.ai')) {
                var allProse = document.querySelectorAll('.markdown-prose');
                var assistantProse = [];
                allProse.forEach(function(el) {
                  if (!el.closest('.user-message')) assistantProse.push(el);
                });
                if (assistantProse.length) {
                  var lastProse = assistantProse[assistantProse.length - 1];
                  // Clone and remove thinking content before extracting text
                  var clone = lastProse.cloneNode(true);
                  clone.querySelectorAll('.thinking-chain-container, .thinking-block, details[type="reasoning"]')
                    .forEach(function(el) { el.remove(); });
                  text = clone.innerText.trim();
                }
                if (!text) {
                  text = trySelectors([
                    '.chat-assistant',
                    '.chat-assistant.markdown-prose'
                  ]);
                }
              }

              // ── Generic fallback: any element that looks like AI response ──
              if (!text) {
                text = trySelectors([
                  '[data-role="assistant"]',
                  '[data-author="assistant"]',
                  '[data-message-role="assistant"]',
                  '[class*="assistant"], [class*="Assistant"]',
                  '[class*="botMessage"], [class*="BotMessage"]',
                  '[class*="aiMessage"], [class*="AiMessage"]'
                ]);
              }

              // ── Structural fallback: last message-like container is usually AI ──
              if (!text) {
                var containers = document.querySelectorAll('[class*="message"], [class*="Message"]');
                if (containers.length >= 1) {
                  text = containers[containers.length - 1].innerText.trim();
                }
              }
              return text;
            })()
          `).then(text => {
            if (text) {
              copyToClipboard(text);
              showToast('Ответ скопирован');
            } else {
              showToast('Не удалось извлечь ответ');
            }
          }).catch(() => showToast('Не удалось извлечь ответ'));
          break;
        case 'copy-last-prompt':
          wv.executeJavaScript(`
            (function() {
              function trySelectors(selectors) {
                for (var i = 0; i < selectors.length; i++) {
                  try {
                    var els = document.querySelectorAll(selectors[i]);
                    if (els.length) {
                      var t = els[els.length - 1].innerText.trim();
                      if (t) return t;
                    }
                  } catch(e) {}
                }
                return '';
              }
              var text = '';
              var hostname = location.hostname;

              // ── DeepSeek ──
              if (hostname.includes('deepseek.com')) {
                // No unique class for user msgs — filter by absence of assistant markers
                var allMsgs = document.querySelectorAll('.ds-message');
                var userMsgs = [];
                allMsgs.forEach(function(el) {
                  if (!el.querySelector('.ds-assistant-message-main-content') &&
                      !el.querySelector('.ds-think-content')) {
                    userMsgs.push(el);
                  }
                });
                if (userMsgs.length) {
                  var last = userMsgs[userMsgs.length - 1];
                  text = last.innerText.trim();
                }
                if (!text) {
                  text = trySelectors([
                    '.ds-chat-message--user',
                    '[class*="ChatMessage"][class*="user"]',
                    '[data-role="user"]'
                  ]);
                }
              }
              // ── Qwen ──
              else if (hostname.includes('qwen.ai')) {
                text = trySelectors([
                  '.qwen-chat-message-user .chat-user-message',
                  '.qwen-chat-message-user .user-message-content',
                  '.qwen-chat-message-user',
                  '.chat-user-message'
                ]);
                if (!text) {
                  var qMsgs = document.querySelectorAll('.qwen-chat-message-user');
                  if (qMsgs.length) text = qMsgs[qMsgs.length - 1].innerText.trim();
                }
              }
              // ── Z.ai / GLM ──
              else if (hostname.includes('z.ai')) {
                var zMsgs = document.querySelectorAll('.user-message');
                if (zMsgs.length) {
                  var lastZ = zMsgs[zMsgs.length - 1];
                  var proseEl = lastZ.querySelector('.chat-user') || lastZ;
                  text = proseEl.innerText.trim();
                }
                if (!text) {
                  text = trySelectors(['.user-message', '.chat-user']);
                }
              }

              // ── Generic fallback ──
              if (!text) {
                text = trySelectors([
                  '[data-role="user"]',
                  '[data-author="user"]',
                  '[data-message-role="user"]',
                  '[class*="userMessage"]',
                  '[class*="UserMessage"]',
                  '[class*="user-message"]',
                  '[class*="humanMessage"]',
                  '[class*="HumanMessage"]'
                ]);
              }

              // ── Structural fallback: user msg is usually 2nd-to-last message ──
              if (!text) {
                var containers = document.querySelectorAll('[class*="message"], [class*="Message"]');
                if (containers.length >= 2) {
                  text = containers[containers.length - 2].innerText.trim();
                }
              }
              return text;
            })()
          `).then(text => {
            if (text) {
              copyToClipboard(text);
              showToast('Промпт скопирован');
            } else {
              showToast('Не удалось извлечь промпт');
            }
          }).catch(() => showToast('Не удалось извлечь промпт'));
          break;
        case 'paste-into-chat':
          (async () => {
            try {
              let clipText = '';
              // Read clipboard via IPC to main process
              if (window.electronAPI && window.electronAPI.readClipboardText) {
                try { clipText = await window.electronAPI.readClipboardText(); }
                catch(e) { clipText = ''; }
              }
              if (!clipText) {
                showToast('Буфер обмена пуст');
                return;
              }
              showToast('Вставка в поле ввода...');
              // Inject text via executeJavaScript (same as transfer feature)
              injectTextIntoWebview(wv, clipText);
            } catch(err) {
              showToast('Ошибка вставки: ' + err.message);
            }
          })();
          break;
        case 'copy-link':
          if (params.linkURL) {
            copyToClipboard(params.linkURL);
            showToast('Ссылка скопирована');
          }
          break;
        case 'pin':
          pinnedChats[pk] = pinnedChats[pk] || [];
          pinnedChats[pk].push({ title: currentTitle, url: currentUrl, group: '' });
          savePins();
          renderSidebar();
          updateSidebarTabCounts();
          showToast('Закреплено');
          break;
        case 'unpin': {
          const idx = pinnedChats[pk].findIndex(p => p.url === currentUrl);
          if (idx !== -1) {
            pinnedChats[pk].splice(idx, 1);
            savePins();
            renderSidebar();
            updateSidebarTabCounts();
            showToast('Откреплено');
          }
          break;
        }
        case 'copy-url':
          copyToClipboard(currentUrl);
          showToast('URL скопирован');
          break;
        case 'zoom-in':
          applyZoom(ai, Math.min(300, (zoomLevels[ai] || 100) + 10));
          break;
        case 'zoom-out':
          applyZoom(ai, Math.max(30, (zoomLevels[ai] || 100) - 10));
          break;
        case 'zoom-reset':
          applyZoom(ai, 100);
          break;
      }
      closeContextMenu();
    });
  });

  // Close on click outside
  const closeHandler = (e) => {
    if (!menu.contains(e.target)) {
      closeContextMenu();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('keydown', escHandler);
    }
  };
  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeContextMenu();
      document.removeEventListener('click', closeHandler);
      document.removeEventListener('keydown', escHandler);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeHandler);
    document.addEventListener('keydown', escHandler);
  }, 50);
}

function closeContextMenu() {
  // Tear down webview-focus detection listeners (Bug 1 fix)
  if (window._ctxMenuCleanup) {
    window._ctxMenuCleanup();
    window._ctxMenuCleanup = null;
  }
  const existing = document.getElementById('pin-context-menu');
  if (existing) existing.remove();
  const existingGroup = document.getElementById('group-context-menu');
  if (existingGroup) existingGroup.remove();
  const existingWv = document.getElementById('webview-context-menu');
  if (existingWv) existingWv.remove();
  const overlay = document.getElementById('ctx-menu-overlay');
  if (overlay) overlay.remove();
}
