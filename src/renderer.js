// ═══════════════════════════════════════════════════════════════════════
// renderer.js — Main entry point
//
// This is the orchestrator. It contains:
//   - init() — startup sequence
//   - switchAI() / switchTab() — AI and tab switching
//   - setupTabs() — main tab bar click handlers
//   - loadSettings() — restore persisted settings on startup
//   - Window controls, focus mode, nav buttons, pin buttons
//   - Cross-module helper functions (pinKey, getPinsForAI, etc.)
//   - Theme and accent color application
//   - Toast notifications
//   - Pin persistence (savePins)
//
// Module load order (set in index.html):
//   1. app/state.js       — all shared variables and constants
//   2. app/clipboard.js   — clipboard and text injection utilities
//   3. app/zoom.js        — zoom functions
//   4. app/webview.js     — webview creation and management
//   5. app/profiles.js    — profile and tab management
//   6. app/sidebar.js     — sidebar, pins, drag & drop, groups
//   7. app/context-menu.js — webview context menu
//   8. app/transfer.js    — transfer popup
//   9. app/settings.js    — settings modal
//  10. renderer.js        — this file (init, tabs, themes, focus, etc.)
// ═══════════════════════════════════════════════════════════════════════

// ── Cross-module helpers ────────────────────────────────────────────
// These are used by multiple modules and are defined here so they're
// available globally after state.js loads the variables they reference.

// Helper: get pin key for (ai, profileId)
function pinKey(ai, profileId) { return ai + ':' + profileId; }

// Helper: get pins for AI's currently active profile
function getPinsForAI(ai) {
  const tabInfo = findTab(activeTabId[ai]);
  const pk = pinKey(ai, tabInfo ? tabInfo.profileId : 'default');
  return pinnedChats[pk] || [];
}

// Helper: set pins for AI's currently active profile
function setPinsForAI(ai, pins) {
  const tabInfo = findTab(activeTabId[ai]);
  const pk = pinKey(ai, tabInfo ? tabInfo.profileId : 'default');
  pinnedChats[pk] = pins;
}

// Helper: find profile object by id
function getProfile(ai, profileId) {
  return (profiles[ai] || []).find(p => p.id === profileId) || profiles[ai][0];
}

// Helper: find tab object by id
function findTab(tabId) {
  for (const ai of Object.keys(tabs)) {
    const t = tabs[ai].find(t => t.id === tabId);
    if (t) return { ...t, ai };
  }
  return null;
}

// Helper: get active webview element
function getActiveWebview() {
  return webviewElements[activeTabId[activeAI]] || null;
}

// Helper: get webview for a specific AI (first active tab's webview)
function getWebviewForAI(ai) {
  const tid = activeTabId[ai];
  return webviewElements[tid] || null;
}

// Helper: find a tab for a specific AI + profileId, or return null
function findTabForProfile(ai, profileId) {
  return tabs[ai].find(t => t.profileId === profileId) || null;
}

// Helper: switch to (or create/reuse) a tab for the given AI + profileId, returns the tabId
function switchToProfileTab(ai, profileId) {
  // If there's already a tab for this profile, switch to it
  let tab = findTabForProfile(ai, profileId);
  if (tab) {
    activeTabId[ai] = tab.id;
    if (ai === activeAI) {
      // Same AI, different profile — manually switch visible webview
      Object.keys(webviewElements).forEach(tid => {
        webviewElements[tid].classList.toggle('active', tid === tab.id);
      });
      renderSubTabs(ai);
      updateUrlDisplay();
      saveProfilesAndTabs();
    } else {
      switchAI(ai);
    }
    return tab.id;
  }

  // No tab for this profile — try to create one
  if (tabs[ai].length < MAX_TABS_PER_AI) {
    const newTabId = addTab(ai, profileId, AI_CONFIG[ai].home);
    return newTabId;
  }

  // All tab slots taken — reuse the currently active tab for this AI.
  // Destroy its webview, update profileId, create new webview with correct partition.
  const reuseTabId = activeTabId[ai];
  const reuseTab = tabs[ai].find(t => t.id === reuseTabId);
  if (!reuseTab) return null;

  // Destroy old webview
  destroyWebviewElement(reuseTabId);

  // Update tab's profile
  reuseTab.profileId = profileId;
  reuseTab.url = AI_CONFIG[ai].home;

  // Create new webview with the target profile's partition
  createWebviewElement(reuseTabId, ai, profileId, reuseTab.url);

  // Show the new webview
  if (ai === activeAI) {
    Object.keys(webviewElements).forEach(tid => {
      webviewElements[tid].classList.toggle('active', tid === reuseTabId);
    });
  } else {
    switchAI(ai);
  }
  renderSubTabs(ai);
  saveProfilesAndTabs();

  return reuseTabId;
}

// Get next available color for a new profile
function getNextProfileColor(ai) {
  const usedColors = profiles[ai].map(p => p.color).filter(Boolean);
  // First try the AI's brand color
  const brandColor = AI_DEFAULT_PROFILE_COLORS[ai];
  if (!usedColors.includes(brandColor)) return brandColor;
  // Then try palette colors
  for (const c of PROFILE_COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  // Fallback: first palette color
  return PROFILE_COLORS[0];
}

// ── Toast notifications ──────────────────────────────────────────────
function showToast(message, duration = 2500) {
  // Remove existing toast
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.className = 'toast';
  toast.textContent = message;

  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Pin persistence ─────────────────────────────────────────────────
async function savePins() {
  // Include group colors in saved data
  const data = { ...pinnedChats, _groupColors: groupColors };
  await window.electronAPI.savePinned(data);
}

// ── Init ────────────────────────────────────────────────────────────
async function init() {
  const stored = await window.electronAPI.getPinned();
  if (stored) {
    // Extract group colors before spreading into pinnedChats
    if (stored._groupColors) groupColors = stored._groupColors;
    // Migration: old format { qwen: [...], zai: [...] } → new format { 'qwen:default': [...] }
    const migrated = {};
    Object.keys(stored).forEach(key => {
      if (key === '_groupColors') return;
      if (key.includes(':')) {
        // Already new format
        migrated[key] = stored[key];
      } else if (AI_CONFIG[key] && Array.isArray(stored[key])) {
        // Old format: migrate to new
        migrated[`${key}:default`] = stored[key];
      }
    });
    pinnedChats = { 'qwen:default': [], 'zai:default': [], 'deepseek:default': [], ...migrated };
    // Remove _groupColors from pinnedChats
    delete pinnedChats._groupColors;
  }

  // Migrate old pins that don't have a group field yet
  Object.values(pinnedChats).forEach(pins => {
    if (!Array.isArray(pins)) return;
    pins.forEach(pin => { if (pin.group === undefined) pin.group = ''; });
  });

  // Load persisted profiles and tabs
  await loadProfilesAndTabs();

  await loadSettings();

  // Create webviews for all existing tabs
  Object.keys(tabs).forEach(ai => {
    tabs[ai].forEach(tab => {
      createWebviewElement(tab.id, ai, tab.profileId, tab.url);
    });
  });

  // Restore last active AI tab
  if (lastActiveAI && AI_CONFIG[lastActiveAI]) {
    switchAI(lastActiveAI);
  }

  renderSidebar();
  updateSidebarTabCounts();
  setupTabs();
  setupSidebarTabs();
  setupNavButtons();
  setupWebviewEvents();
  setupWindowControls();
  setupPinButtons();
  setupFocusMode();
  setupSidebarResize();
  setupZoomHotkeys();
  setupSearchPins();
  setupZoomIPC();
  setupWebviewZoomWheel();
  setupTransfer();
  setupSubTabs();
  setupWelcomeBindings();
  if (showWelcomeOnStart) showWelcomePage();
  // Apply zoom levels to webviews after they're ready
  Object.keys(tabs).forEach(ai => {
    tabs[ai].forEach(tab => {
      const wv = webviewElements[tab.id];
      if (wv) {
        wv.addEventListener('dom-ready', () => {
          applyZoom(ai, zoomLevels[ai]);
        });
      }
    });
  });
}

// ── Tabs ────────────────────────────────────────────────────────────
function setupTabs() {
  mainTabs.forEach(tab => tab.addEventListener('click', () => switchAI(tab.dataset.ai)));
}

function switchAI(ai) {
  if (ai === activeAI) return; // no-op if same AI

  activeAI = ai;
  lastActiveAI = ai;
  mainTabs.forEach(t => t.classList.toggle('active', t.dataset.ai === ai));

  // Show active tab's webview for this AI, hide all others
  const activeTid = activeTabId[ai];
  Object.keys(webviewElements).forEach(tid => {
    webviewElements[tid].classList.toggle('active', tid === activeTid);
  });

  sidebarActiveAI = ai;
  sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.ai === ai));

  // Fade sidebar content during switch
  const sidebarBody = document.querySelector('.sidebar-body');
  if (sidebarBody) {
    sidebarBody.classList.add('fade-out');
    setTimeout(() => {
      renderSidebar();
      updateSidebarTabCounts();
      sidebarBody.classList.remove('fade-out');
    }, 80);
  } else {
    renderSidebar();
    updateSidebarTabCounts();
  }

  updateUrlDisplay();
  renderSubTabs(ai);
  // Re-check active pin after sidebar re-renders (URL might already match)
  setTimeout(() => updateActivePin(), 100);
  // Persist last active AI
  saveLastActiveAI();
}

function switchTab(tabId) {
  const tabInfo = findTab(tabId);
  if (!tabInfo) return;

  // Hide welcome page if visible
  if (typeof _welcomeVisible !== 'undefined' && _welcomeVisible) hideWelcomePage();

  // If different AI, switch AI first
  if (tabInfo.ai !== activeAI) {
    activeTabId[tabInfo.ai] = tabId;
    switchAI(tabInfo.ai);
    return;
  }

  activeTabId[activeAI] = tabId;

  // Show/hide webviews
  Object.keys(webviewElements).forEach(tid => {
    webviewElements[tid].classList.toggle('active', tid === tabId);
  });

  renderSubTabs(activeAI);
  updateUrlDisplay();
  setTimeout(() => updateActivePin(), 100);
  saveProfilesAndTabs();
}

async function saveLastActiveAI() {
  try {
    await window.electronAPI.saveLastActiveAI(lastActiveAI);
  } catch(e) {}
}

// ── Nav buttons ─────────────────────────────────────────────────────
function setupNavButtons() {
  navBack.addEventListener('click',    () => { try { const wv = getActiveWebview(); if (wv && wv.canGoBack())    wv.goBack();    } catch(e){} });
  navForward.addEventListener('click', () => { try { const wv = getActiveWebview(); if (wv && wv.canGoForward()) wv.goForward(); } catch(e){} });
  navReload.addEventListener('click',  () => { try { const wv = getActiveWebview(); if (wv) wv.reload(); } catch(e){} });
}

// ── Accent color ────────────────────────────────────────────────────
function applyAccentColor(color) {
  const root = document.documentElement;
  root.style.setProperty('--accent', color);

  // Compute accent with transparency for backgrounds / glows
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  root.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  root.style.setProperty('--accent-bg', `rgba(${r},${g},${b},0.18)`);
  root.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.35)`);
}

function applyDefaultColorsMode(enabled) {
  document.body.classList.toggle('default-colors', enabled);
  defaultColorsMode = enabled;
}

// ── Theme ────────────────────────────────────────────────────────────
function applyTheme(themeName) {
  const theme = THEMES[themeName];
  if (!theme) return;
  currentTheme = themeName;
  const root = document.documentElement;

  // Apply theme CSS variables
  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // Apply accent based on source
  resolveAndApplyAccent();
}

function resolveAndApplyAccent() {
  let resolvedAccent;
  if (accentSource === 'theme') {
    resolvedAccent = THEMES[currentTheme].accent;
  applyDefaultColorsMode(false);
  } else if (accentSource === 'default') {
    // "По умолчанию" — each AI uses its brand color, app accent is default blue
    resolvedAccent = DEFAULT_ACCENT;
    applyDefaultColorsMode(true);
  } else {
    // 'custom' — use the user's chosen accentColor
    resolvedAccent = accentColor;
    applyDefaultColorsMode(false);
  }
  applyAccentColor(resolvedAccent);
}

// ── Pinning ──────────────────────────────────────────────────────────
function setupPinButtons() {
  addPinBtn.addEventListener('click', pinCurrentPage);
  pinCurrentBtn.addEventListener('click', pinCurrentPage);
}

function pinCurrentPage() {
  let url, title;
  try {
    const wv = getActiveWebview();
    url   = wv ? wv.getURL() : null;
    title = pinTitleInput.value.trim() || (wv ? wv.getTitle() : '') || AI_CONFIG[activeAI].name;
  } catch(e) {
    url   = AI_CONFIG[activeAI].home;
    title = AI_CONFIG[activeAI].name;
  }
  if (!url || url === 'about:blank') return;
  if (getPinsForAI(activeAI).some(p => p.url === url)) { showToast('Уже закреплено!'); return; }

  const group = document.getElementById('pin-group-select')?.value || '';
  getPinsForAI(activeAI).push({ title, url, group });
  pinTitleInput.value = '';
  const gs = document.getElementById('pin-group-select');
  if (gs) gs.value = '';
  savePins();
  sidebarActiveAI = activeAI;
  sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.ai === sidebarActiveAI));
  renderSidebar();
  updateSidebarTabCounts();
  showToast('Закреплено!');
}

function flashBtn(btn, msg) {
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

// ── Window controls ──────────────────────────────────────────────────
function setupWindowControls() {
  document.getElementById('btn-min').addEventListener('click',   () => window.electronAPI.minimize());
  document.getElementById('btn-max').addEventListener('click',   () => window.electronAPI.maximize());
  document.getElementById('btn-close').addEventListener('click', () => {
    if (closeConfirmationEnabled && !settingsTrayEnabled) {
      if (!confirm('Вы уверены, что хотите закрыть AI Hub?')) return;
    }
    saveCurrentTabUrls();
    saveProfilesAndTabs();
    window.electronAPI.close();
  });
  // Home button — re-open welcome page
  document.getElementById('btn-home').addEventListener('click', () => {
    showWelcomePage();
  });
}

// ── Focus mode ────────────────────────────────────────────────────────
function toggleFocus() {
  document.body.classList.toggle('focus-mode');
  // When exiting focus mode, restore sidebar if it was hidden by focus mode
  if (!document.body.classList.contains('focus-mode') && sidebarHidden) {
    toggleSidebar(); // restore sidebar
  }
}

// ── Sidebar toggle (hide/show) ────────────────────────────────────────
let sidebarHidden = false;

// ── Save current webview URLs to tabs state ───────────────────────────
function saveCurrentTabUrls() {
  Object.keys(tabs).forEach(ai => {
    tabs[ai].forEach(tab => {
      const wv = webviewElements[tab.id];
      if (wv) {
        try {
          const currentUrl = wv.getURL();
          if (currentUrl && currentUrl !== 'about:blank') {
            tab.url = currentUrl;
          }
        } catch(e) {}
      }
    });
  });
}

function toggleSidebar() {
  sidebarHidden = !sidebarHidden;
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('btn-sidebar-toggle');
  if (sidebarHidden) {
    sidebar.style.width = '0px';
    sidebar.style.overflow = 'hidden';
    sidebar.style.borderRight = 'none';
    document.documentElement.style.setProperty('--sidebar-w', '0px');
    if (btn) btn.title = 'Показать боковую панель';
  } else {
    const savedW = localStorage.getItem('sidebar-width') || '200';
    const w = Math.max(160, parseInt(savedW, 10));
    sidebar.style.width = w + 'px';
    sidebar.style.overflow = '';
    sidebar.style.borderRight = '';
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    if (btn) btn.title = 'Скрыть боковую панель';
  }
}

// ── Limit warning ──────────────────────────────────────────────────────
function checkLimitWarning() {
  const maxTabsSel = document.getElementById('setting-max-tabs');
  const maxProfSel = document.getElementById('setting-max-profiles');
  const warning = document.getElementById('limit-warning');
  if (!maxTabsSel || !maxProfSel || !warning) return;

  const newMaxTabs = parseInt(maxTabsSel.value, 10);
  const newMaxProf = parseInt(maxProfSel.value, 10);
  let showWarning = false;

  // Check if any AI has more tabs than the new limit
  Object.keys(AI_CONFIG).forEach(ai => {
    if (tabs[ai] && tabs[ai].length > newMaxTabs) showWarning = true;
    if (profiles[ai] && profiles[ai].length > newMaxProf) showWarning = true;
  });

  warning.style.display = showWarning ? 'block' : 'none';
}

function cycleAI() {
  const aiList = ['qwen', 'zai', 'deepseek'];
  const currentIdx = aiList.indexOf(activeAI);
  const nextIdx = (currentIdx + 1) % aiList.length;
  switchAI(aiList[nextIdx]);
}

function setupFocusMode() {
  document.getElementById('btn-focus').addEventListener('click', toggleFocus);
  document.getElementById('btn-sidebar-toggle').addEventListener('click', toggleSidebar);
  document.getElementById('focus-exit').addEventListener('click', toggleFocus);

  // Global hotkeys handled by main process
  window.electronAPI.onToggleFocus(() => toggleFocus());
  window.electronAPI.onSwitchAI(() => cycleAI());
  window.electronAPI.onSwitchToQwen(() => switchAI('qwen'));
  window.electronAPI.onSwitchToZai(() => switchAI('zai'));
  window.electronAPI.onSwitchToDeepseek(() => switchAI('deepseek'));

  // Save tab URLs before window closes (triggered by main process)
  window.electronAPI.onSaveBeforeClose(() => {
    saveCurrentTabUrls();
    saveProfilesAndTabs();
  });

  // Settings modal
  document.getElementById('btn-settings').addEventListener('click', openSettingsModal);
  document.getElementById('settings-cancel').addEventListener('click', closeSettingsModal);
  document.getElementById('settings-save').addEventListener('click', saveSettingsFromModal);
  document.getElementById('settings-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('settings-modal')) closeSettingsModal();
  });
  document.getElementById('focus-hotkey-listen').addEventListener('click', () => startHotkeyListening('focus'));
  document.getElementById('switch-hotkey-listen').addEventListener('click', () => startHotkeyListening('switch'));
  document.getElementById('qwen-hotkey-listen').addEventListener('click', () => startHotkeyListening('qwen'));
  document.getElementById('zai-hotkey-listen').addEventListener('click', () => startHotkeyListening('zai'));
  document.getElementById('deepseek-hotkey-listen').addEventListener('click', () => startHotkeyListening('deepseek'));

  // Theme cards
  document.querySelectorAll('#theme-cards .theme-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#theme-cards .theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const themeName = card.dataset.theme;
      pendingTheme = themeName;
      applyTheme(themeName);
      markSettingsDirty();
    });
  });

  // Accent source buttons
  document.querySelectorAll('#accent-source-row .accent-source-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#accent-source-row .accent-source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const source = btn.dataset.source;
      pendingAccentSource = source;
      // Show/hide custom color picker
      const showCustom = source === 'custom';
      document.getElementById('accent-colors-row').style.display = showCustom ? 'flex' : 'none';
      document.getElementById('accent-custom-row').style.display = showCustom ? 'flex' : 'none';
      // Apply accent
      accentSource = source;
      resolveAndApplyAccent();
      markSettingsDirty();
    });
  });

  // Accent color swatches
  document.querySelectorAll('#accent-colors-row .accent-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      const color = sw.dataset.color;
      pendingAccentColor = color;
      document.querySelectorAll('#accent-colors-row .accent-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      document.getElementById('accent-custom-color').value = color;
      // Preview: temporarily apply
      accentColor = color;
      resolveAndApplyAccent();
      markSettingsDirty();
    });
  });

  // Accent color custom picker
  document.getElementById('accent-custom-color').addEventListener('input', (e) => {
    const color = e.target.value;
    pendingAccentColor = color;
    document.querySelectorAll('#accent-colors-row .accent-swatch').forEach(s => s.classList.remove('active'));
    // Preview: temporarily apply
    accentColor = color;
    resolveAndApplyAccent();
    markSettingsDirty();
  });

  // Tab icons toggle — live preview
  document.getElementById('setting-tab-icons').addEventListener('change', (e) => {
    applyTabIconMode(e.target.checked ? 'icons' : 'dots');
    markSettingsDirty();
  });

  // Other toggles — mark dirty on change
  document.getElementById('setting-tray').addEventListener('change', markSettingsDirty);
  document.getElementById('setting-autostart').addEventListener('change', markSettingsDirty);
  document.getElementById('setting-close-confirm').addEventListener('change', markSettingsDirty);
  document.getElementById('setting-welcome-start').addEventListener('change', markSettingsDirty);

  // Experimental limits — mark dirty on change + show warning when lowering
  document.getElementById('setting-max-tabs').addEventListener('change', (e) => {
    markSettingsDirty();
    checkLimitWarning();
  });
  document.getElementById('setting-max-profiles').addEventListener('change', (e) => {
    markSettingsDirty();
    checkLimitWarning();
  });


}

// ── Settings load ────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const saved = await window.electronAPI.getSettings();
    if (saved.focusHotkey && saved.focusHotkey.code) focusHotkey = saved.focusHotkey;
    if (saved.switchHotkey && saved.switchHotkey.code) switchHotkey = saved.switchHotkey;
    if (saved.qwenHotkey && saved.qwenHotkey.code) qwenHotkey = saved.qwenHotkey;
    if (saved.zaiHotkey && saved.zaiHotkey.code) zaiHotkey = saved.zaiHotkey;
    if (saved.deepseekHotkey && saved.deepseekHotkey.code) deepseekHotkey = saved.deepseekHotkey;
    if (saved.minimizeToTray !== undefined) settingsTrayEnabled = saved.minimizeToTray;
    if (saved.lastActiveAI && AI_CONFIG[saved.lastActiveAI]) lastActiveAI = saved.lastActiveAI;
    if (saved.accentColor) {
      accentColor = saved.accentColor;
    }
    if (saved.theme && THEMES[saved.theme]) {
      currentTheme = saved.theme;
    }
    if (saved.accentSource) {
      accentSource = saved.accentSource;
    } else if (saved.defaultColorsMode) {
      // Backward compat: old settings had toggle instead of accentSource
      accentSource = 'default';
    }
    // Apply theme (which also resolves accent)
    applyTheme(currentTheme);
    if (saved.sidebarWidth) {
      const w = Math.max(160, Math.min(500, saved.sidebarWidth));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.style.width = w + 'px';
    }
    // Zoom levels
    if (saved.zoomLevels) {
      Object.keys(saved.zoomLevels).forEach(ai => {
        if (zoomLevels.hasOwnProperty(ai)) zoomLevels[ai] = saved.zoomLevels[ai];
      });
    }
    // Tab icon mode
    if (saved.tabIconMode) {
      applyTabIconMode(saved.tabIconMode);
    }
    if (saved.autoStart !== undefined) autoStartEnabled = saved.autoStart;
    if (saved.closeConfirmation !== undefined) closeConfirmationEnabled = saved.closeConfirmation;
    if (saved.showWelcomeOnStart !== undefined) showWelcomeOnStart = saved.showWelcomeOnStart;
    if (saved.maxTabsPerAI !== undefined) MAX_TABS_PER_AI = saved.maxTabsPerAI;
    if (saved.maxProfilesPerAI !== undefined) MAX_PROFILES_PER_AI = saved.maxProfilesPerAI;
  } catch(e) {}
}

// ── Start ─────────────────────────────────────────────────────────────
init();
