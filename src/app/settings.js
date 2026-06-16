// ═══════════════════════════════════════════════════════════════════════
// app/settings.js — Settings modal
//
// Manages the settings modal: hotkey capture, theme/accent selection,
// tray toggle, tab icons, profile settings. Handles live preview,
// dirty tracking, and save/cancel with snapshot revert.
//
// Dependencies: app/state.js, app/zoom.js (zoomLevels),
//   app/sidebar.js (renderSidebar, updateSidebarTabCounts)
// ═══════════════════════════════════════════════════════════════════════

// ── Dirty tracking helper ───────────────────────────────────────────
// Call markSettingsDirty() whenever a setting is changed in the modal.
// When the user tries to close without saving, show a confirmation dialog.
function markSettingsDirty() {
  _settingsDirty = true;
}

function resetSettingsDirty() {
  _settingsDirty = false;
}

function openSettingsModal() {
  // Save snapshot for revert on cancel
  _savedTheme = currentTheme;
  _savedAccentSource = accentSource;
  _savedAccentColor = accentColor;
  _savedTabIconMode = tabIconMode;
  _savedMaxTabs = MAX_TABS_PER_AI;
  _savedMaxProfiles = MAX_PROFILES_PER_AI;
  // Deep copy profiles for cancel revert
  _savedProfiles = JSON.parse(JSON.stringify(profiles));

  pendingFocusHotkey = null;
  pendingSwitchHotkey = null;
  pendingQwenHotkey = null;
  pendingZaiHotkey = null;
  pendingDeepseekHotkey = null;
  pendingAccentColor = null;
  pendingTheme = null;
  pendingAccentSource = null;
  listeningTarget = null;
  _settingsDirty = false;

  // Populate current values — general hotkeys
  const focusCap = document.getElementById('focus-hotkey-capture');
  const switchCap = document.getElementById('switch-hotkey-capture');
  focusCap.textContent = focusHotkey.display;
  focusCap.classList.remove('listening');
  switchCap.textContent = switchHotkey.display;
  switchCap.classList.remove('listening');

  // Populate current values — AI direct hotkeys
  const qwenCap = document.getElementById('qwen-hotkey-capture');
  const zaiCap = document.getElementById('zai-hotkey-capture');
  const deepseekCap = document.getElementById('deepseek-hotkey-capture');
  qwenCap.textContent = qwenHotkey.display;
  qwenCap.classList.remove('listening');
  zaiCap.textContent = zaiHotkey.display;
  zaiCap.classList.remove('listening');
  deepseekCap.textContent = deepseekHotkey.display;
  deepseekCap.classList.remove('listening');

  // Reset all listen buttons
  document.querySelectorAll('.hotkey-listen-btn').forEach(b => b.textContent = '🎧');

  document.getElementById('setting-tray').checked = settingsTrayEnabled;
  document.getElementById('setting-tab-icons').checked = (tabIconMode === 'icons');
  document.getElementById('setting-autostart').checked = autoStartEnabled;
  document.getElementById('setting-close-confirm').checked = closeConfirmationEnabled;
  document.getElementById('setting-welcome-start').checked = showWelcomeOnStart;

  // Limits — select elements
  const maxTabsSel = document.getElementById('setting-max-tabs');
  const maxProfSel = document.getElementById('setting-max-profiles');
  if (maxTabsSel) maxTabsSel.value = String(MAX_TABS_PER_AI);
  if (maxProfSel) maxProfSel.value = String(MAX_PROFILES_PER_AI);

  // Theme — highlight active
  document.querySelectorAll('#theme-cards .theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === currentTheme);
  });

  // Accent source — highlight active + show/hide custom picker
  document.querySelectorAll('#accent-source-row .accent-source-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.source === accentSource);
  });
  const showCustom = accentSource === 'custom';
  document.getElementById('accent-colors-row').style.display = showCustom ? 'flex' : 'none';
  document.getElementById('accent-custom-row').style.display = showCustom ? 'flex' : 'none';

  // Accent color — highlight active swatch
  document.querySelectorAll('#accent-colors-row .accent-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === accentColor);
  });
  document.getElementById('accent-custom-color').value = accentColor;

  // Render profile settings
  renderProfileSettings();

  document.getElementById('settings-modal').classList.add('open');
}

function closeSettingsModal() {
  // If there are unsaved changes, show confirmation dialog
  if (_settingsDirty) {
    showUnsavedDialog();
    return;
  }
  forceCloseSettingsModal();
}

function forceCloseSettingsModal() {
  listeningTarget = null;
  _settingsDirty = false;
  // Remove any active key listeners
  document.removeEventListener('keydown', captureSettingsKey, true);
  document.getElementById('settings-modal').classList.remove('open');
  // Reset pending
  pendingTheme = null;
  pendingAccentSource = null;
  pendingAccentColor = null;
  // Revert to snapshot (undoes any live preview)
  currentTheme = _savedTheme;
  accentSource = _savedAccentSource;
  accentColor = _savedAccentColor;
  defaultColorsMode = (accentSource === 'default');
  applyTabIconMode(_savedTabIconMode);
  MAX_TABS_PER_AI = _savedMaxTabs;
  MAX_PROFILES_PER_AI = _savedMaxProfiles;
  applyTheme(currentTheme);
  // Revert profile changes if any
  if (_savedProfiles) {
    profiles = _savedProfiles;
    _savedProfiles = null;
    // Re-render sub-tabs for all AIs
    Object.keys(AI_CONFIG).forEach(ai => renderSubTabs(ai));
  }
}

// ── Unsaved changes dialog ──────────────────────────────────────────
// A styled modal dialog that warns the user about unsaved changes.
function showUnsavedDialog() {
  // Remove existing dialog if any
  const existing = document.getElementById('unsaved-dialog');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'unsaved-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:var(--overlay);';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px 32px;max-width:380px;width:90%;box-shadow:0 8px 32px var(--shadow);';

  box.innerHTML = `
    <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;">Несохранённые изменения</div>
    <div style="font-size:13px;color:var(--text-muted);line-height:1.5;margin-bottom:20px;">Вы изменили настройки, но не сохранили их. Вы уверены, что хотите закрыть без сохранения?</div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button id="unsaved-stay" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:13px;">Остаться</button>
      <button id="unsaved-discard" style="padding:8px 18px;border-radius:8px;border:none;background:var(--danger);color:#fff;cursor:pointer;font-size:13px;">Закрыть без сохранения</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  document.getElementById('unsaved-stay').addEventListener('click', () => {
    overlay.remove();
  });

  document.getElementById('unsaved-discard').addEventListener('click', () => {
    overlay.remove();
    _settingsDirty = false;
    forceCloseSettingsModal();
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

function startHotkeyListening(target) {
  // Stop previous listening
  document.removeEventListener('keydown', captureSettingsKey, true);

  listeningTarget = target;
  const capId = target + '-hotkey-capture';
  const cap = document.getElementById(capId);
  if (cap) {
    cap.textContent = 'Нажми комбинацию...';
    cap.classList.add('listening');
  }

  const btn = document.getElementById(target + '-hotkey-listen');
  if (btn) btn.textContent = '⏳';

  document.addEventListener('keydown', captureSettingsKey, true);
}

function captureSettingsKey(e) {
  if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();

  const displayKey = codeToDisplay(e.code);
  const captured = {
    ctrl:    e.ctrlKey,
    alt:     e.altKey,
    shift:   e.shiftKey,
    code:    e.code,
    display: [
      e.ctrlKey  ? 'Ctrl'  : '',
      e.altKey   ? 'Alt'   : '',
      e.shiftKey ? 'Shift' : '',
      displayKey,
    ].filter(Boolean).join('+'),
  };

  const target = listeningTarget;
  const pendingMap = {
    focus: 'pendingFocusHotkey',
    switch: 'pendingSwitchHotkey',
    qwen: 'pendingQwenHotkey',
    zai: 'pendingZaiHotkey',
    deepseek: 'pendingDeepseekHotkey',
  };

  if (pendingMap[target]) {
    // Store in the right pending variable
    switch (target) {
      case 'focus':     pendingFocusHotkey = captured; break;
      case 'switch':    pendingSwitchHotkey = captured; break;
      case 'qwen':      pendingQwenHotkey = captured; break;
      case 'zai':       pendingZaiHotkey = captured; break;
      case 'deepseek':  pendingDeepseekHotkey = captured; break;
    }

    const cap = document.getElementById(target + '-hotkey-capture');
    if (cap) {
      cap.textContent = captured.display;
      cap.classList.remove('listening');
    }
    const btn = document.getElementById(target + '-hotkey-listen');
    if (btn) btn.textContent = '🎧';

    markSettingsDirty();
  }

  listeningTarget = null;
  document.removeEventListener('keydown', captureSettingsKey, true);
}

function codeToDisplay(code) {
  if (code.startsWith('Key'))   return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    'Space': 'Space',        'Enter': 'Enter',         'Tab': 'Tab',
    'Backquote': '`',        'Minus': '-',             'Equal': '=',
    'BracketLeft': '[',      'BracketRight': ']',      'Backslash': '\\',
    'Semicolon': ';',        'Quote': "'",             'Comma': ',',
    'Period': '.',           'Slash': '/',             'Escape': 'Esc',
    'Backspace': '⌫',        'Delete': 'Del',          'Insert': 'Ins',
    'Home': 'Home',          'End': 'End',             'PageUp': 'PgUp',
    'PageDown': 'PgDn',      'ArrowUp': '↑',          'ArrowDown': '↓',
    'ArrowLeft': '←',        'ArrowRight': '→',
  };
  if (map[code]) return map[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

// ── Tab icon mode ──────────────────────────────────────────────────
function applyTabIconMode(mode) {
  tabIconMode = mode;
  document.body.classList.toggle('tab-icons-mode', mode === 'icons');
  updateTabIcons();
}

function updateTabIcons() {
  document.querySelectorAll('.tab-dot').forEach(dot => {
    const tab = dot.closest('.tab');
    if (!tab) return;
    const ai = tab.dataset.ai;
    if (tabIconMode === 'icons') {
      // Insert an <img> element with the AI icon
      dot.innerHTML = '';
      const img = document.createElement('img');
      img.src = AI_ICONS[ai] || '';
      img.alt = AI_CONFIG[ai]?.name || ai;
      dot.appendChild(img);
    } else {
      // Dots mode — clear any img elements
      dot.innerHTML = '';
    }
  });
}

async function saveSettingsFromModal() {
  if (pendingFocusHotkey) focusHotkey = pendingFocusHotkey;
  if (pendingSwitchHotkey) switchHotkey = pendingSwitchHotkey;
  if (pendingQwenHotkey) qwenHotkey = pendingQwenHotkey;
  if (pendingZaiHotkey) zaiHotkey = pendingZaiHotkey;
  if (pendingDeepseekHotkey) deepseekHotkey = pendingDeepseekHotkey;
  // Note: accentColor, currentTheme, accentSource were already updated during live preview
  // Just clear pending flags
  pendingAccentColor = null;
  pendingTheme = null;
  pendingAccentSource = null;

  settingsTrayEnabled = document.getElementById('setting-tray').checked;
  autoStartEnabled = document.getElementById('setting-autostart').checked;
  closeConfirmationEnabled = document.getElementById('setting-close-confirm').checked;
  showWelcomeOnStart = document.getElementById('setting-welcome-start').checked;
  defaultColorsMode = (accentSource === 'default');
  applyTabIconMode(document.getElementById('setting-tab-icons').checked ? 'icons' : 'dots');

  // Limits — apply and save
  const newMaxTabs = parseInt(document.getElementById('setting-max-tabs').value, 10) || 3;
  const newMaxProfiles = parseInt(document.getElementById('setting-max-profiles').value, 10) || 3;
  MAX_TABS_PER_AI = newMaxTabs;
  MAX_PROFILES_PER_AI = newMaxProfiles;

  // Apply resolved accent (which also handles defaultColorsMode)
  resolveAndApplyAccent();

  // Update snapshot so closeSettingsModal doesn't revert
  _savedTheme = currentTheme;
  _savedAccentSource = accentSource;
  _savedAccentColor = accentColor;
  _savedTabIconMode = tabIconMode;
  _savedProfiles = null; // Profile changes are committed
  _settingsDirty = false;

  const sidebar = document.getElementById('sidebar');
  const currentSidebarWidth = sidebar ? sidebar.offsetWidth : 220;

  const settings = {
    focusHotkey,
    switchHotkey,
    qwenHotkey,
    zaiHotkey,
    deepseekHotkey,
    minimizeToTray: settingsTrayEnabled,
    lastActiveAI,
    sidebarWidth: currentSidebarWidth,
    accentColor,
    theme: currentTheme,
    accentSource,
    zoomLevels,
    tabIconMode,
    autoStart: autoStartEnabled,
    closeConfirmation: closeConfirmationEnabled,
    showWelcomeOnStart,
    maxTabsPerAI: MAX_TABS_PER_AI,
    maxProfilesPerAI: MAX_PROFILES_PER_AI,
  };

  await window.electronAPI.saveSettings(settings);
  await window.electronAPI.setAutoStart(autoStartEnabled);
  await saveProfilesAndTabs();
  document.getElementById('settings-modal').classList.remove('open');
  showToast('Настройки сохранены');
}
