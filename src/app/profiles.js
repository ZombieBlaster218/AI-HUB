// ═══════════════════════════════════════════════════════════════════════
// app/profiles.js — Profile and tab management
//
// Manages profiles (sessions/partitions), sub-tabs, creating/closing
// tabs, creating/renaming/deleting profiles, and persisting profiles
// and tabs to disk.
//
// Dependencies: app/state.js, app/clipboard.js (escapeHtml),
//   app/webview.js (createWebviewElement, destroyWebviewElement, showLoading, updateUrlDisplay)
// ═══════════════════════════════════════════════════════════════════════

// ── Profiles & Tabs persistence ──────────────────────────────────────
async function loadProfilesAndTabs() {
  try {
    const settings = await window.electronAPI.getSettings();
    if (settings.profiles) profiles = settings.profiles;
    if (settings.tabs) {
      // Validate tabs — ensure each AI has at least one tab
      Object.keys(AI_CONFIG).forEach(ai => {
        if (!settings.tabs[ai] || settings.tabs[ai].length === 0) {
          settings.tabs[ai] = [{ id: `${ai}-0`, profileId: 'default', url: AI_CONFIG[ai].home, customName: 'Вкладка 1' }];
        }
      });
      tabs = settings.tabs;
    }
    if (settings.activeTabId) {
      // Validate active tab IDs
      Object.keys(AI_CONFIG).forEach(ai => {
        if (!tabs[ai].find(t => t.id === settings.activeTabId[ai])) {
          settings.activeTabId[ai] = tabs[ai][0].id;
        }
      });
      activeTabId = settings.activeTabId;
    }
    if (settings.tabCounter) tabCounter = settings.tabCounter;
    // Ensure all profiles have a color field (migration for old profiles)
    Object.keys(profiles).forEach(ai => {
      profiles[ai].forEach((p, idx) => {
        if (!p.color) {
          if (p.id === 'default') {
            p.color = AI_DEFAULT_PROFILE_COLORS[ai] || PROFILE_COLORS[0];
          } else {
            // Assign a color from the palette
            const usedColors = profiles[ai].map(x => x.color).filter(Boolean);
            let assigned = PROFILE_COLORS.find(c => !usedColors.includes(c));
            p.color = assigned || PROFILE_COLORS[idx % PROFILE_COLORS.length];
          }
        }
      });
    });
    // Ensure pinnedChats has entries for all profiles
    Object.keys(profiles).forEach(ai => {
      profiles[ai].forEach(p => {
        const pk = pinKey(ai, p.id);
        if (!pinnedChats[pk]) pinnedChats[pk] = [];
      });
    });
  } catch(e) {
    console.warn('Failed to load profiles/tabs:', e);
  }
}

async function saveProfilesAndTabs() {
  try {
    const settings = await window.electronAPI.getSettings();
    settings.profiles = profiles;
    settings.tabs = tabs;
    settings.activeTabId = activeTabId;
    settings.tabCounter = tabCounter;
    await window.electronAPI.saveSettings(settings);
  } catch(e) {}
}

// ── Sub-tab management ──────────────────────────────────────────────
function setupSubTabs() {
  renderSubTabs(activeAI);
}

function renderSubTabs(ai) {
  const list = document.getElementById('sub-tabs-list');
  if (!list) return;

  const aiTabs = tabs[ai] || [];
  const activeTid = activeTabId[ai];

  let html = '';
  aiTabs.forEach(tab => {
    const profile = getProfile(ai, tab.profileId);
    const isActive = tab.id === activeTid;
    const profileColor = profile.color || '#6c8ef5';
    const displayTitle = tab.customName || tab.title || profile.name || AI_CONFIG[ai].name;
    const canClose = aiTabs.length > 1; // can't close last tab

    html += `<div class="sub-tab${isActive ? ' active' : ''}" data-tab-id="${tab.id}" style="${isActive ? `border-bottom-color:${profileColor}` : ''}">
      <span class="sub-tab-color-dot" style="background:${profileColor}"></span>
      <span class="sub-tab-title">${escapeHtml(displayTitle)}</span>
      ${canClose ? '<span class="sub-tab-close" data-tab-id="' + tab.id + '">✕</span>' : ''}
    </div>`;
  });
  list.innerHTML = html;

  // Bind click events
  list.querySelectorAll('.sub-tab').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('sub-tab-close')) return;
      // Only switch if clicking a different tab — otherwise dblclick won't work
      // because switchTab → renderSubTabs destroys the DOM element
      if (el.dataset.tabId !== activeTabId[ai]) {
        switchTab(el.dataset.tabId);
      }
    });
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const tabId = el.dataset.tabId;
      startSubTabRename(tabId, ai, el);
    });
  });
  list.querySelectorAll('.sub-tab-close').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(el.dataset.tabId);
    });
  });
}

function addTab(ai, profileId, url) {
  if (tabs[ai].length >= MAX_TABS_PER_AI) {
    showToast(`Максимум ${MAX_TABS_PER_AI} вкладок на ${AI_CONFIG[ai].name}`);
    return null;
  }

  const id = `${ai}-${tabCounter++}`;
  const tab = { id, profileId: profileId || 'default', url: url || AI_CONFIG[ai].home, customName: 'Вкладка ' + (tabs[ai].length + 1) };
  tabs[ai].push(tab);
  createWebviewElement(id, ai, tab.profileId, tab.url);
  switchTab(id);
  saveProfilesAndTabs();
  return id;
}

function closeTab(tabId) {
  const tabInfo = findTab(tabId);
  if (!tabInfo) return;

  const ai = tabInfo.ai;
  if (tabs[ai].length <= 1) {
    showToast('Нельзя закрыть последнюю вкладку');
    return;
  }

  // Remove tab
  const idx = tabs[ai].findIndex(t => t.id === tabId);
  if (idx === -1) return;
  tabs[ai].splice(idx, 1);
  destroyWebviewElement(tabId);

  // If we closed the active tab, switch to another
  if (activeTabId[ai] === tabId) {
    const newActive = tabs[ai][Math.min(idx, tabs[ai].length - 1)];
    activeTabId[ai] = newActive.id;
    if (ai === activeAI) {
      Object.keys(webviewElements).forEach(tid => {
        webviewElements[tid].classList.toggle('active', tid === newActive.id);
      });
    }
  }

  renderSubTabs(ai);
  updateUrlDisplay();
  saveProfilesAndTabs();
}

function showNewTabMenu() {
  const ai = activeAI;
  const aiProfiles = profiles[ai];
  const aiTabs = tabs[ai];

  if (aiTabs.length >= MAX_TABS_PER_AI) {
    showToast(`Максимум ${MAX_TABS_PER_AI} вкладок на ${AI_CONFIG[ai].name}`);
    return;
  }

  // Simple menu: show profile options
  let menuHtml = '';
  aiProfiles.forEach(p => {
    const profileColor = p.color || '#6c8ef5';
    menuHtml += `<div class="new-tab-option" data-profile-id="${p.id}">
      <span class="new-tab-color-dot" style="background:${profileColor}"></span>
      <span>${escapeHtml(p.name)}</span>
    </div>`;
  });

  if (aiProfiles.length < MAX_PROFILES_PER_AI) {
    menuHtml += `<div class="new-tab-option new-tab-new-profile">
      <span>+</span>
      <span>Новый профиль...</span>
    </div>`;
  }

  // Use a simple popup positioned near the + button
  let menu = document.getElementById('new-tab-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'new-tab-menu';
    document.body.appendChild(menu);
  }

  const addBtn = document.getElementById('sub-tab-add');
  const rect = addBtn.getBoundingClientRect();
  menu.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    right: ${window.innerWidth - rect.right}px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    min-width: 160px;
    z-index: 99999;
    box-shadow: 0 4px 16px var(--shadow);
    animation: transfer-pop 0.12s ease;
  `;
  menu.innerHTML = menuHtml;

  // Create fullscreen overlay to catch clicks on webview area
  let overlay = document.getElementById('new-tab-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'new-tab-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99998;';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'block';

  const closeMenu = () => {
    menu.remove();
    overlay.style.display = 'none';
  };

  overlay.addEventListener('click', closeMenu);

  // Also close on clicks outside menu in the DOM area
  document.addEventListener('click', function outsideClick(e) {
    if (!menu.contains(e.target) && e.target !== addBtn) {
      closeMenu();
      document.removeEventListener('click', outsideClick);
    }
  });

  // Bind clicks
  menu.querySelectorAll('.new-tab-option').forEach(el => {
    el.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 7px 10px; border-radius: 6px; cursor: pointer;
      color: var(--text); font-size: 13px; transition: background 0.1s;
    `;
    el.addEventListener('mouseover', () => el.style.background = 'var(--accent-bg)');
    el.addEventListener('mouseout', () => el.style.background = 'none');
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const profileId = el.dataset.profileId;
      if (profileId) {
        addTab(ai, profileId, AI_CONFIG[ai].home);
      } else {
        // New profile
        createNewProfile(ai);
      }
      closeMenu();
    });
  });
}

function createNewProfile(ai) {
  if (profiles[ai].length >= MAX_PROFILES_PER_AI) {
    showToast(`Максимум ${MAX_PROFILES_PER_AI} профилей на ${AI_CONFIG[ai].name}`);
    return;
  }

  // Can't use prompt() in Electron — use inline input dialog
  showProfileNameDialog(ai);
}

function showProfileNameDialog(ai) {
  // Remove existing dialog if any
  const existing = document.getElementById('profile-name-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'profile-name-dialog';
  dialog.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; z-index: 999999; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    min-width: 280px; display: flex; flex-direction: column; gap: 12px;
  `;

  dialog.innerHTML = `
    <div style="font-size:14px;font-weight:600;color:var(--text);">Новый профиль</div>
    <input type="text" id="profile-name-input" placeholder="Название профиля..."
      style="padding:8px 12px;border-radius:8px;border:1px solid var(--border);
      background:var(--surface2);color:var(--text);font-size:13px;outline:none;width:100%;">
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="profile-name-cancel" style="padding:6px 16px;border-radius:6px;border:1px solid var(--border);
        background:var(--surface2);color:var(--text-muted);cursor:pointer;font-size:13px;">Отмена</button>
      <button id="profile-name-ok" style="padding:6px 16px;border-radius:6px;border:none;
        background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Создать</button>
    </div>
  `;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'profile-name-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 999998;
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(dialog);

  const input = document.getElementById('profile-name-input');
  input.focus();

  const close = () => {
    dialog.remove();
    overlay.remove();
  };

  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.style.borderColor = 'var(--danger)'; return; }

    const id = 'profile-' + tabCounter++;
    const partition = `persist:${ai}-${id}`;
    const color = getNextProfileColor(ai);
    profiles[ai].push({ id, name, partition, color });
    pinnedChats[pinKey(ai, id)] = [];
    addTab(ai, id, AI_CONFIG[ai].home);
    saveProfilesAndTabs();
    renderSubTabs(ai);
    showToast(`Профиль "${name}" создан`);
    close();
  };

  document.getElementById('profile-name-cancel').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.getElementById('profile-name-ok').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') close();
  });
}

// ── Profile settings management ────────────────────────────────────
function renderProfileSettings() {
  const container = document.getElementById('profiles-settings-container');
  if (!container) return;

  let html = '';
  Object.keys(AI_CONFIG).forEach(ai => {
    const name = AI_CONFIG[ai].name;
    const aiColor = AI_COLORS[ai] || 'var(--accent)';
    const aiProfiles = profiles[ai] || [];

    html += `<div class="profile-ai-group">`;
    html += `<div class="profile-ai-label"><span class="profile-ai-dot" style="background:${aiColor}"></span>${escapeHtml(name)}</div>`;

    aiProfiles.forEach(prof => {
      const profColor = prof.color || '#6c8ef5';
      const isDefault = prof.id === 'default';
      const canDelete = !isDefault;

      html += `<div class="profile-card" data-ai="${ai}" data-profile-id="${prof.id}">`;
      html += `<div class="profile-color-dot" style="background:${profColor}" data-ai="${ai}" data-profile-id="${prof.id}" title="Изменить цвет"></div>`;
      html += `<span class="profile-card-name" data-ai="${ai}" data-profile-id="${prof.id}">${escapeHtml(prof.name)}</span>`;
      html += `<button class="profile-card-btn edit-name-btn" data-ai="${ai}" data-profile-id="${prof.id}" title="Переименовать">✏</button>`;
      if (!isDefault) {
        html += `<button class="profile-card-btn delete-btn" data-ai="${ai}" data-profile-id="${prof.id}" title="Удалить профиль">🗑</button>`;
      }
      html += `</div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;

  // Bind events
  container.querySelectorAll('.profile-color-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      showProfileColorPicker(dot, dot.dataset.ai, dot.dataset.profileId);
    });
  });

  container.querySelectorAll('.edit-name-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startProfileNameEdit(btn.closest('.profile-card'), btn.dataset.ai, btn.dataset.profileId);
    });
  });

  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteProfile(btn.dataset.ai, btn.dataset.profileId);
    });
  });
}

function showProfileColorPicker(anchor, ai, profileId) {
  // Remove any existing picker
  const existing = document.querySelector('.profile-color-picker');
  if (existing) existing.remove();

  const profile = getProfile(ai, profileId);
  if (!profile) return;
  const currentColor = profile.color || '#6c8ef5';

  const picker = document.createElement('div');
  picker.className = 'profile-color-picker';

  let html = '';
  PROFILE_COLORS.forEach(c => {
    html += `<div class="profile-color-picker-swatch${currentColor === c ? ' active' : ''}" data-color="${c}" style="background:${c}"></div>`;
  });
  // Custom color option using input[type=color]
  html += `<input type="color" class="profile-color-custom-input" value="${currentColor}" style="width:24px;height:24px;border:none;padding:0;background:none;cursor:pointer;border-radius:50%;">`;
  picker.innerHTML = html;

  // Position near the anchor
  const rect = anchor.getBoundingClientRect();
  const settingsBox = anchor.closest('.settings-box');
  const boxRect = settingsBox.getBoundingClientRect();
  picker.style.top = (rect.bottom - boxRect.top + 4) + 'px';
  picker.style.left = (rect.left - boxRect.left) + 'px';

  settingsBox.style.position = 'relative';
  settingsBox.appendChild(picker);

  // Close on outside click
  const closePicker = () => {
    picker.remove();
    document.removeEventListener('mousedown', outsideClick, true);
  };
  const outsideClick = (e) => {
    if (!picker.contains(e.target) && e.target !== anchor) closePicker();
  };
  setTimeout(() => document.addEventListener('mousedown', outsideClick, true), 10);

  // Swatch click
  picker.querySelectorAll('.profile-color-picker-swatch').forEach(sw => {
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = sw.dataset.color;
      profile.color = color;
      anchor.style.background = color;
      renderSubTabs(ai);
      saveProfilesAndTabs();
      closePicker();
    });
  });

  // Custom color input
  const customInput = picker.querySelector('.profile-color-custom-input');
  customInput.addEventListener('input', (e) => {
    const color = e.target.value;
    profile.color = color;
    anchor.style.background = color;
    renderSubTabs(ai);
    saveProfilesAndTabs();
  });
  customInput.addEventListener('change', () => {
    closePicker();
  });
}

function startProfileNameEdit(card, ai, profileId) {
  const profile = getProfile(ai, profileId);
  if (!profile) return;

  const nameSpan = card.querySelector('.profile-card-name');
  if (!nameSpan) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'profile-card-name-input';
  input.value = profile.name;

  nameSpan.style.display = 'none';
  nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== profile.name) {
      profile.name = newName;
      renderSubTabs(ai);
      saveProfilesAndTabs();
    }
    cleanup();
    renderProfileSettings();
  };

  const cancel = () => {
    cleanup();
    nameSpan.style.display = '';
    input.remove();
  };

  const cleanup = () => {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  const onBlur = () => { commit(); };

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
}

function confirmDeleteProfile(ai, profileId) {
  const profile = getProfile(ai, profileId);
  if (!profile) return;

  // Check if profile has open tabs (will be auto-closed)
  const hasOpenTabs = tabs[ai].some(t => t.profileId === profileId);

  // Show confirmation dialog
  const existing = document.getElementById('confirm-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'confirm-dialog';
  dialog.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; z-index: 999999; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    min-width: 300px; display: flex; flex-direction: column; gap: 12px;
  `;

  const warningText = hasOpenTabs
    ? `У этого профиля есть открытые вкладки — они будут закрыты. Все данные сессии будут стёрты.`
    : `Все данные сессии будут стёрты. Войдите в аккаунт заново при создании нового профиля с этим именем.`;

  dialog.innerHTML = `
    <div style="font-size:14px;font-weight:600;color:var(--text);">Удалить профиль «${escapeHtml(profile.name)}»?</div>
    <div style="font-size:12px;color:var(--text-muted);">${warningText}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="confirm-cancel" style="padding:6px 16px;border-radius:6px;border:1px solid var(--border);
        background:var(--surface2);color:var(--text-muted);cursor:pointer;font-size:13px;">Отмена</button>
      <button id="confirm-ok" style="padding:6px 16px;border-radius:6px;border:none;
        background:var(--danger);color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Удалить</button>
    </div>
  `;

  const overlay = document.createElement('div');
  overlay.id = 'confirm-overlay';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:999998;`;

  document.body.appendChild(overlay);
  document.body.appendChild(dialog);

  const close = () => { dialog.remove(); overlay.remove(); };

  document.getElementById('confirm-cancel').addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    close();
    await deleteProfile(ai, profileId);
  });
}

async function deleteProfile(ai, profileId) {
  const profile = getProfile(ai, profileId);
  if (!profile) return;

  // Close all tabs for this profile first
  const profileTabs = tabs[ai].filter(t => t.profileId === profileId);
  for (const tab of profileTabs) {
    const tabIdx = tabs[ai].indexOf(tab);
    if (tabIdx !== -1) {
      tabs[ai].splice(tabIdx, 1);
      destroyWebviewElement(tab.id);
    }
  }
  // Ensure at least one tab remains for this AI
  if (tabs[ai].length === 0) {
    const defaultProfile = profiles[ai].find(p => p.id === 'default') || profiles[ai][0];
    const newId = `${ai}-0`;
    tabs[ai].push({ id: newId, profileId: defaultProfile.id, url: AI_CONFIG[ai].home, customName: 'Вкладка 1' });
    createWebviewElement(newId, ai, defaultProfile.id, AI_CONFIG[ai].home);
    activeTabId[ai] = newId;
  }
  // If active tab was removed, switch to first remaining
  if (!tabs[ai].find(t => t.id === activeTabId[ai])) {
    activeTabId[ai] = tabs[ai][0].id;
  }
  // If this was the active AI, update webview visibility
  if (ai === activeAI) {
    Object.keys(webviewElements).forEach(tid => {
      webviewElements[tid].classList.toggle('active', tid === activeTabId[ai]);
    });
  }

  // Clear session data
  try {
    await window.electronAPI.clearSessionData(profile.partition);
  } catch(e) {
    console.warn('Failed to clear session data:', e);
  }

  // Remove profile from state
  const idx = profiles[ai].findIndex(p => p.id === profileId);
  if (idx === -1) return;
  profiles[ai].splice(idx, 1);

  // Clean up pinned chats for this profile
  delete pinnedChats[pinKey(ai, profileId)];

  // Re-render and save
  renderProfileSettings();
  renderSubTabs(ai);
  renderSidebar();
  updateUrlDisplay();
  saveProfilesAndTabs();
  savePins();
  showToast(`Профиль «${profile.name}» удалён`);
}

// ── Sub-tab rename (double-click) ──────────────────────────────────
function startSubTabRename(tabId, ai, subTabEl) {
  const tab = tabs[ai].find(t => t.id === tabId);
  if (!tab) return;

  const titleSpan = subTabEl.querySelector('.sub-tab-title');
  if (!titleSpan) return;

  const currentName = tab.customName || tab.title || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sub-tab-rename-input';
  input.value = currentName;
  input.style.cssText = `
    background: var(--surface2);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    padding: 2px 6px;
    outline: none;
    width: 100%;
    min-width: 60px;
  `;

  titleSpan.style.display = 'none';
  titleSpan.parentNode.insertBefore(input, titleSpan.nextSibling);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      tab.customName = newName;
      saveProfilesAndTabs();
    } else if (newName === '' && tab.customName) {
      // If user clears the name, remove customName
      tab.customName = null;
      saveProfilesAndTabs();
    }
    cleanup();
    renderSubTabs(ai);
  };

  const cancel = () => {
    cleanup();
    renderSubTabs(ai);
  };

  const cleanup = () => {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  const onBlur = () => { commit(); };

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
}
