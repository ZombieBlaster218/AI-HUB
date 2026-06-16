// ═══════════════════════════════════════════════════════════════════════
// app/welcome.js — Welcome / launcher page
//
// Shows a welcome overlay on startup. Hides only when the user
// explicitly closes it (clicks an AI card, main tab, or close button).
// Can be re-opened via the home button in the titlebar.
//
// Dependencies: app/state.js
// ═══════════════════════════════════════════════════════════════════════

let _welcomeVisible = true;
let _webviewLoadedState = { qwen: false, zai: false, deepseek: false };

function showWelcomePage() {
  const el = document.getElementById('welcome-page');
  if (!el) return;
  _welcomeVisible = true;
  el.classList.remove('hidden');

  // Set version
  const verEl = el.querySelector('.welcome-version');
  if (verEl) verEl.textContent = 'v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.9.2');

  updateWelcomeHotkeys();
  updateWelcomeStats();
}

function hideWelcomePage() {
  const el = document.getElementById('welcome-page');
  if (!el) return;
  _welcomeVisible = false;
  el.classList.add('hidden');
}

function updateWelcomeStats() {
  const container = document.getElementById('welcome-stats');
  if (!container) return;

  let html = '';
  Object.keys(AI_CONFIG).forEach(ai => {
    const name = AI_CONFIG[ai].name;
    const aiProfiles = profiles[ai] || [];
    const profileCount = aiProfiles.length;
    const aiPins = [];
    aiProfiles.forEach(p => {
      const pk = pinKey(ai, p.id);
      if (pinnedChats[pk]) aiPins.push(...pinnedChats[pk]);
    });
    const pinCount = aiPins.length;
    html += `<div class="welcome-stat-row">
      <span>${escapeHtml(name)}</span>
      <span class="welcome-stat-value">${profileCount} ${declension(profileCount, 'профиль', 'профиля', 'профилей')}, ${pinCount} ${declension(pinCount, 'пин', 'пина', 'пинов')}</span>
    </div>`;
  });
  html += `<div class="welcome-stat-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px;">
    <span>Лимиты</span>
    <span class="welcome-stat-value">${MAX_TABS_PER_AI} вкладок / ${MAX_PROFILES_PER_AI} профилей на ИИ</span>
  </div>`;
  container.innerHTML = html;
}

function updateWelcomeHotkeys() {
  const container = document.getElementById('welcome-hotkeys');
  if (!container) return;

  const hotkeys = [
    { label: 'Фокус-режим', hk: focusHotkey },
    { label: 'Переключение AI', hk: switchHotkey },
    { label: 'Qwen', hk: qwenHotkey },
    { label: 'GLM', hk: zaiHotkey },
    { label: 'DeepSeek', hk: deepseekHotkey },
  ];

  let html = '';
  hotkeys.forEach(({ label, hk }) => {
    html += `<div class="welcome-hotkey-row">
      <span class="welcome-hotkey-label">${escapeHtml(label)}</span>
      <span class="welcome-hotkey-key">${escapeHtml(hk.display)}</span>
    </div>`;
  });
  container.innerHTML = html;
}

function markWebviewLoaded(ai) {
  _webviewLoadedState[ai] = true;
  // No auto-hide — welcome page stays until user explicitly closes it
}

// Russian declension helper
function declension(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

// Bind AI card clicks on welcome page
function setupWelcomeBindings() {
  const cards = document.querySelectorAll('.welcome-ai-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const ai = card.dataset.ai;
      if (ai && AI_CONFIG[ai]) {
        switchAI(ai);
        hideWelcomePage();
      }
    });
  });

  // Also hide welcome when main tabs are clicked
  mainTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (_welcomeVisible) hideWelcomePage();
    });
  });

  // Donate phone — click to copy
  const donatePhone = document.getElementById('donate-phone');
  if (donatePhone) {
    donatePhone.addEventListener('click', async () => {
      const phone = '+79873833552';
      try {
        await navigator.clipboard.writeText(phone);
        showToast('Номер скопирован!');
      } catch(e) {
        // Fallback for webviews where clipboard might not work
        try {
          await window.electronAPI.writeClipboardText(phone);
          showToast('Номер скопирован!');
        } catch(e2) {}
      }
    });
  }
}
