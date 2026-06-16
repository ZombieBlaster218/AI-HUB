// ═══════════════════════════════════════════════════════════════════════
// app/transfer.js — Transfer popup
//
// Manages the transfer feature: extract text from the current AI's
// webview, display a popup to choose a target AI/profile/pin, and
// inject the text into the target's input field.
//
// Dependencies: app/state.js, app/clipboard.js (copyToClipboard, escapeHtml),
//   app/webview.js (getActiveWebview, updateUrlDisplay)
// ═══════════════════════════════════════════════════════════════════════

function setupTransfer() {
  const btn   = document.getElementById('transfer-btn');
  const popup = document.getElementById('transfer-popup');

  if (!btn || !popup) {
    console.warn('[Transfer] Button or popup not found!', { btn, popup });
    return;
  }

  // Build target list
  buildTransferTargets();

  // Toggle popup on click
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (transferPopupOpen) {
      closeTransferPopup();
    } else {
      openTransferPopup();
    }
  });

  // "Ask all" button
  document.getElementById('transfer-all-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    transferToAll();
  });

  // Close popup when clicking outside — overlay catches clicks over webview too
  document.addEventListener('click', (e) => {
    if (transferPopupOpen && !popup.contains(e.target) && e.target !== btn) {
      closeTransferPopup();
    }
  });


}

function buildTransferTargets() {
  const container = document.getElementById('transfer-targets');
  if (!container) return;

  let html = '';
  Object.keys(AI_CONFIG).forEach(ai => {
    const name = AI_CONFIG[ai].name;
    const color = AI_COLORS[ai] || 'var(--accent)';
    const isCurrent = (ai === activeAI);
    const aiProfiles = profiles[ai] || [];

    html += `<div class="transfer-ai-group">`;

    // AI header (click = current chat of that AI, uses active profile)
    html += `<div class="transfer-target${isCurrent ? ' disabled' : ''}" data-ai="${ai}" data-profile-id="" data-url="">
      <span class="transfer-dot" style="background:${color}"></span>
      <span>${escapeHtml(name)}</span>
    </div>`;

    // Show each profile as a collapsible section with its pins
    aiProfiles.forEach(prof => {
      const pk = pinKey(ai, prof.id);
      const profPins = pinnedChats[pk] || [];
      const profileColor = prof.color || '#6c8ef5';

      // Profile folder (collapsed by default)
      html += `<div class="transfer-folder collapsed" data-ai="${ai}" data-profile-id="${prof.id}" data-group="${escapeHtml(prof.name)}">`;
      html += `<div class="transfer-folder-header">`;
      html += `<span class="transfer-folder-color-dot" style="background:${profileColor}"></span>`;
      html += `<span class="transfer-folder-name">${escapeHtml(prof.name)}</span>`;
      html += `<span class="transfer-folder-count">${profPins.length}</span>`;
      html += `</div>`;
      html += `<div class="transfer-folder-pins">`;

      // Split pins into groups (same logic as sidebar)
      if (profPins.length > 0) {
        const groups = new Set();
        profPins.forEach(p => { if (p.group) groups.add(p.group); });
        const ungrouped = profPins.filter(p => !p.group);
        const grouped = {};
        groups.forEach(g => { grouped[g] = profPins.filter(p => p.group === g); });

        // Ungrouped pins
        ungrouped.forEach(pin => {
          html += `<div class="transfer-pin${isCurrent ? ' disabled' : ''}" data-ai="${ai}" data-profile-id="${prof.id}" data-url="${escapeHtml(pin.url)}">
            <span class="transfer-pin-icon">📌</span>
            <span class="transfer-pin-title">${escapeHtml(pin.title || 'Чат')}</span>
          </div>`;
        });

        // Grouped pins — nested folders
        groups.forEach(group => {
          const gPins = grouped[group];
          const gkey = `${ai}:${group}`;
          const gColor = groupColors[gkey] || '';
          const colorStyle = gColor ? ` style="color:${gColor};border-color:${gColor}44"` : '';
          const countBadge = gColor ? `<span class="transfer-folder-count" style="background:${gColor}22;color:${gColor}">${gPins.length}</span>` : `<span class="transfer-folder-count">${gPins.length}</span>`;

          html += `<div class="transfer-folder collapsed" data-ai="${ai}" data-profile-id="${prof.id}" data-group="${escapeHtml(group)}">`;
          html += `<div class="transfer-folder-header"${colorStyle}>`;
          html += `<span class="transfer-folder-icon">📁</span>`;
          html += `<span class="transfer-folder-name">${escapeHtml(group)}</span>`;
          html += countBadge;
          html += `</div>`;
          html += `<div class="transfer-folder-pins">`;
          gPins.forEach(pin => {
            html += `<div class="transfer-pin${isCurrent ? ' disabled' : ''}" data-ai="${ai}" data-profile-id="${prof.id}" data-url="${escapeHtml(pin.url)}">
              <span class="transfer-pin-icon">📌</span>
              <span class="transfer-pin-title">${escapeHtml(pin.title || 'Чат')}</span>
            </div>`;
          });
          html += `</div>`;
          html += `</div>`;
        });
      }

      html += `</div>`; // close transfer-folder-pins
      html += `</div>`; // close profile folder
    });

    // "New chat" option for default profile
    html += `<div class="transfer-new-chat${isCurrent ? ' disabled' : ''}" data-ai="${ai}" data-profile-id="default" data-url="${escapeHtml(AI_CONFIG[ai].home)}">
      <span>✏</span>
      <span>Новый чат</span>
    </div>`;

    html += `</div>`;
  });
  container.innerHTML = html;

  // Bind click events — AI header (transfer to current chat of that AI, active profile)
  container.querySelectorAll('.transfer-target').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      // For AI header, use the currently active profile of that AI
      const activeTid = activeTabId[el.dataset.ai];
      const activeTab = findTab(activeTid);
      const profId = activeTab ? activeTab.profileId : 'default';
      transferTo(el.dataset.ai, profId, null);
    });
  });

  // Bind click events — folder header (toggle collapse)
  container.querySelectorAll('.transfer-folder-header').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const folder = el.closest('.transfer-folder');
      folder.classList.toggle('collapsed');
    });
  });

  // Bind click events — pinned chat
  container.querySelectorAll('.transfer-pin').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      transferTo(el.dataset.ai, el.dataset.profileId, el.dataset.url);
    });
  });

  // Bind click events — new chat
  container.querySelectorAll('.transfer-new-chat').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.classList.contains('disabled')) return;
      transferTo(el.dataset.ai, el.dataset.profileId, el.dataset.url);
    });
  });
}

function openTransferPopup() {
  const popup = document.getElementById('transfer-popup');
  const btn = document.getElementById('transfer-btn');

  // Rebuild targets each time (pins may have changed)
  buildTransferTargets();

  // Position popup below the button
  if (btn) {
    const rect = btn.getBoundingClientRect();
    const popupHeight = 400; // estimated max height
    let top = rect.bottom + 6;
    // If popup would go below viewport, show it above the button instead
    if (top + popupHeight > window.innerHeight) {
      top = Math.max(8, rect.top - popupHeight - 6);
    }
    popup.style.top = top + 'px';
    popup.style.right = (window.innerWidth - rect.right) + 'px';
    popup.style.left = 'auto';
  }

  // Reset state
  transferExtractedText = '';
  const preview = document.getElementById('transfer-preview');
  if (preview) {
    preview.style.display = 'none';
    preview.textContent = '';
  }

  // Extract text using multiple strategies via executeJavaScript
  // This is more reliable than preload IPC because we can try many approaches
  const EXTRACT_SCRIPT = `
    (function() {
      var result = '';

      // Strategy 1: Current textarea/input value (what user is typing right now)
      try {
        var ta = document.querySelector('textarea');
        if (ta && ta.value && ta.value.trim()) {
          result = ta.value.trim();
        }
      } catch(e) {}

      // Strategy 2: Current contenteditable input
      if (!result) {
        try {
          var ce = document.querySelector('[contenteditable="true"]');
          if (ce && ce.innerText && ce.innerText.trim()) {
            result = ce.innerText.trim();
          }
        } catch(e) {}
      }

      // Strategy 3: Selected text
      if (!result) {
        try {
          var sel = window.getSelection();
          if (sel && sel.toString().trim()) {
            result = sel.toString().trim();
          }
        } catch(e) {}
      }

      // Strategy 4: Last user message — try MANY selectors
      if (!result) {
        var selectors = [
          // Generic patterns
          '[class*="message"][class*="user"]:not([class*="assistant"]):not([class*="bot"])',
          '[class*="Message"][class*="User"]',
          '[class*="userMessage"]',
          '[class*="user-message"]',
          '[class*="chat-message-user"]',
          '[class*="msg-user"]',
          '[data-role="user"]',
          '[data-author="user"]',
          // Qwen specific
          '.message-item.user',
          '.chat-message.user',
          // DeepSeek specific
          '.ds-chat-message--user',
          // Z.ai specific
          '.chat-message-user',
          '.message-user',
          // Broader fallbacks
          '.user-message',
          '.human-message',
          '.message.human',
          '.message.user',
          // Even broader — any chat message bubble that's not assistant
          '.chat-message',
          '.message-item',
          '.message-content'
        ];

        for (var i = 0; i < selectors.length; i++) {
          try {
            var els = document.querySelectorAll(selectors[i]);
            if (els.length > 0) {
              // Get the last one
              var last = els[els.length - 1];
              var text = (last.innerText || last.textContent || '').trim();
              // Skip very long texts (probably full conversation) and empty
              if (text && text.length < 5000 && text.length > 2) {
                result = text;
                break;
              }
            }
          } catch(e) {}
        }
      }

      // Strategy 5: Last paragraph-like element in chat area
      if (!result) {
        try {
          var chatAreas = document.querySelectorAll(
            '[class*="chat"], [class*="conversation"], [class*="messages"], main, [role="log"], [role="main"]'
          );
          for (var c = 0; c < chatAreas.length; c++) {
            var paras = chatAreas[c].querySelectorAll('p, div > span');
            if (paras.length > 0) {
              for (var p = paras.length - 1; p >= 0; p--) {
                var t = (paras[p].innerText || '').trim();
                if (t && t.length > 5 && t.length < 5000) {
                  result = t;
                  break;
                }
              }
            }
            if (result) break;
          }
        } catch(e) {}
      }

      // Limit result length
      if (result.length > 3000) result = result.slice(0, 3000) + '...';

      return result;
    })()
  `;

  try {
    const activeWv = getActiveWebview();
    if (!activeWv) return;
    activeWv.executeJavaScript(EXTRACT_SCRIPT).then(text => {
      if (text && text.trim()) {
        transferExtractedText = text.trim();
        const preview = document.getElementById('transfer-preview');
        if (preview) {
          preview.style.display = 'block';
          preview.textContent = text.trim().length > 80 ? text.trim().slice(0, 80) + '...' : text.trim();
        }
      } else {
        // No text found at all — show hint
        const preview = document.getElementById('transfer-preview');
        if (preview) {
          preview.style.display = 'block';
          preview.textContent = 'Выдели текст или напиши сообщение';
          preview.style.color = 'var(--text-muted)';
          preview.style.fontStyle = 'italic';
        }
      }
    }).catch(() => {});
  } catch(e) {}

  popup.classList.add('visible');
  transferPopupOpen = true;

  // Create fullscreen overlay to catch clicks on webview area
  let overlay = document.getElementById('transfer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'transfer-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'block';
  overlay.onclick = () => closeTransferPopup();
}

function closeTransferPopup() {
  const popup = document.getElementById('transfer-popup');
  if (popup) popup.classList.remove('visible');
  transferPopupOpen = false;
  const overlay = document.getElementById('transfer-overlay');
  if (overlay) overlay.style.display = 'none';
}

function transferTo(targetAI, profileId, url) {
  const targetProfileId = profileId || 'default';

  // Check if this is a no-op: same AI + same active profile + no specific URL
  const currentTabId = activeTabId[targetAI];
  const currentTab = findTab(currentTabId);
  const currentProfileId = currentTab ? currentTab.profileId : 'default';
  if (targetAI === activeAI && targetProfileId === currentProfileId && !url) return;

  const text = transferExtractedText;
  const targetName = AI_CONFIG[targetAI].name;

  // Switch to the correct profile tab (creates one if needed)
  const tabId = switchToProfileTab(targetAI, targetProfileId);
  if (!tabId) {
    showToast(`Не удалось переключиться на профиль`);
    closeTransferPopup();
    return;
  }

  const targetWv = webviewElements[tabId];
  if (!targetWv) {
    showToast(`Вебвью не найдено для профиля`);
    closeTransferPopup();
    return;
  }

  if (text) {
    // Copy to clipboard as backup
    copyToClipboard(text);

    // If URL specified (pinned chat or new chat), navigate there
    if (url) {
      try { targetWv.loadURL(url); } catch(e) {}
    }

    // Inject text into target webview's input via executeJavaScript
    const injectDelay = url ? 1500 : 600; // more time if navigating to new page
    setTimeout(() => {
      try {
        targetWv.executeJavaScript(`
          (function() {
            var text = ${JSON.stringify(text)};
            var ta = document.querySelector('textarea');
            if (ta) {
              var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
              if (setter && setter.set) setter.set.call(ta, text);
              else ta.value = text;
              ta.dispatchEvent(new Event('input', {bubbles:true}));
              ta.dispatchEvent(new Event('change', {bubbles:true}));
              ta.focus();
              return true;
            }
            var ce = document.querySelector('[contenteditable="true"]');
            if (ce) {
              ce.focus();
              ce.innerText = text;
              ce.dispatchEvent(new Event('input', {bubbles:true}));
              return true;
            }
            return false;
          })()
        `).then(ok => {
          if (ok) showToast(`Вставлено → ${targetName}`);
          else showToast(`Скопировано → ${targetName} (вставь Ctrl+V)`);
        }).catch(() => {
          showToast(`Скопировано → ${targetName} (вставь Ctrl+V)`);
        });
      } catch(e) {
        showToast(`Скопировано → ${targetName} (вставь Ctrl+V)`);
      }
    }, injectDelay);
  } else {
    // No text extracted — switch + optionally navigate
    if (url) {
      try { targetWv.loadURL(url); } catch(e) {}
    }
    showToast('Переключено — вставь текст (Ctrl+V)');
  }

  closeTransferPopup();
}

function transferToAll() {
  const text = transferExtractedText;

  if (!text) {
    showToast('Нет текста — выдели текст или напиши в чат');
    closeTransferPopup();
    return;
  }

  // Copy to clipboard as backup
  copyToClipboard(text);

  // Send to all OTHER AIs via executeJavaScript
  const targets = Object.keys(AI_CONFIG).filter(ai => ai !== activeAI);
  targets.forEach(targetAI => {
    setTimeout(() => {
      try {
        const wv = getWebviewForAI(targetAI);
        if (!wv) return;
        wv.executeJavaScript(`
          (function() {
            var text = ${JSON.stringify(text)};
            var ta = document.querySelector('textarea');
            if (ta) {
              var setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
              if (setter && setter.set) setter.set.call(ta, text);
              else ta.value = text;
              ta.dispatchEvent(new Event('input', {bubbles:true}));
              ta.dispatchEvent(new Event('change', {bubbles:true}));
              // Try to send
              setTimeout(function() {
                var btn = document.querySelector('button[type="submit"], button[class*="send"], button[class*="Submit"], [class*="sendButton"], button[aria-label*="end"]');
                if (btn && !btn.disabled) btn.click();
                else ta.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
              }, 300);
              return true;
            }
            var ce = document.querySelector('[contenteditable="true"]');
            if (ce) {
              ce.focus();
              ce.innerText = text;
              ce.dispatchEvent(new Event('input', {bubbles:true}));
              setTimeout(function() {
                var btn = document.querySelector('button[type="submit"], button[class*="send"], button[class*="Submit"]');
                if (btn && !btn.disabled) btn.click();
                else ce.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
              }, 300);
              return true;
            }
            return false;
          })()
        `);
      } catch(e) {}
    }, 400);
  });

  showToast(`Отправлено всем (${targets.map(ai => AI_CONFIG[ai].name).join(', ')})`);
  closeTransferPopup();
}
