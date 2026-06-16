// ═══════════════════════════════════════════════════════════════════════
// app/sidebar.js — Sidebar, pins, drag & drop, groups
//
// Renders the sidebar with pinned chats, handles profile sections,
// groups (create/rename/color/collapse), drag & drop reordering,
// pin context menus, group selector popup, search, and sidebar resize.
//
// Dependencies: app/state.js, app/clipboard.js (escapeHtml, shortUrl),
//   app/webview.js (updateUrlDisplay), app/profiles.js (renderSubTabs,
//   saveProfilesAndTabs, addTab), app/context-menu.js (closeContextMenu)
// ═══════════════════════════════════════════════════════════════════════

// ── Active pin highlight ─────────────────────────────────────────────
function updateActivePin() {
  // Remove previous highlight
  sidebarBody.querySelectorAll('.pin-item.active-pin').forEach(el => el.classList.remove('active-pin'));

  const wv = getActiveWebview();
  if (!wv) return;
  try {
    const currentUrl = wv.getURL();
    if (!currentUrl) return;
    // Find matching pin for current AI + profile
    const tabInfo = findTab(activeTabId[activeAI]);
    const profileId = tabInfo ? tabInfo.profileId : 'default';
    const pk = pinKey(activeAI, profileId);
    const pins = pinnedChats[pk] || [];
    for (let i = 0; i < pins.length; i++) {
      if (pins[i].url === currentUrl) {
        const el = sidebarBody.querySelector(`.pin-item[data-idx="${i}"][data-ai="${activeAI}"][data-profile-id="${profileId}"]`);
        if (el) el.classList.add('active-pin');
        break;
      }
    }
  } catch(e) {}
}

// ── Sidebar tab counts ───────────────────────────────────────────────
function updateSidebarTabCounts() {
  sidebarTabs.forEach(tab => {
    const ai = tab.dataset.ai;
    // Count total pins across ALL profiles for this AI
    let total = 0;
    (profiles[ai] || []).forEach(prof => {
      const pk = pinKey(ai, prof.id);
      total += (pinnedChats[pk] || []).length;
    });
    const baseName = AI_CONFIG[ai].name;
    tab.textContent = total > 0 ? `${baseName} (${total})` : baseName;
  });
}

// ── Sidebar resize by dragging right edge ────────────────────────────
function setupSidebarResize() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sidebar-resize-handle');
  if (!handle || !sidebar) return;

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    // Capture all pointer events — works even over webview
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('sidebar-resizing');
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) return; // not pressed
    const delta = e.clientX - startX;
    const newWidth = Math.max(160, Math.min(500, startWidth + delta));
    sidebar.style.width = newWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-w', newWidth + 'px');
    // Debounced save
    clearTimeout(handle._saveTimer);
    handle._saveTimer = setTimeout(() => saveSidebarWidth(newWidth), 300);
  });

  handle.addEventListener('pointerup', (e) => {
    handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('sidebar-resizing');
    // Save final width
    const finalWidth = sidebar.offsetWidth;
    saveSidebarWidth(finalWidth);
  });
}

async function saveSidebarWidth(width) {
  try {
    await window.electronAPI.saveSidebarWidth(width);
  } catch(e) {}
}

function setupSidebarTabs() {
  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sidebarActiveAI = tab.dataset.ai;
      sidebarTabs.forEach(t => t.classList.toggle('active', t.dataset.ai === sidebarActiveAI));
      renderSidebar();
    });
  });
}

function getAllGroups(ai) {
  // Get groups for the active profile of this AI
  const tabInfo = findTab(activeTabId[ai]);
  const pk = pinKey(ai, tabInfo ? tabInfo.profileId : 'default');
  const pins = pinnedChats[pk] || [];
  const groups = new Set();
  pins.forEach(p => { if (p.group) groups.add(p.group); });
  return [...groups];
}

function getAllGroupsForProfile(ai, profileId) {
  const pk = pinKey(ai, profileId);
  const pins = pinnedChats[pk] || [];
  const groups = new Set();
  pins.forEach(p => { if (p.group) groups.add(p.group); });
  return [...groups];
}

function renderSidebar() {
  const ai = sidebarActiveAI;
  const aiProfiles = profiles[ai] || [];
  const sq = searchQuery;

  const matchesSearch = (pin) => {
    if (!sq) return true;
    return String(pin.title || '').toLowerCase().includes(sq);
  };

  let html = '';

  // ── Render each profile as a collapsible section ──
  aiProfiles.forEach(prof => {
    const pk = pinKey(ai, prof.id);
    const pins = pinnedChats[pk] || [];
    const profColor = prof.color || '#6c8ef5';

    // Filter pins by search
    const filteredPins = pins.filter(matchesSearch);

    // Get groups within this profile
    const groups = getAllGroupsForProfile(ai, prof.id);
    const ungrouped = filteredPins.filter(p => !p.group);
    const grouped = {};
    groups.forEach(g => { grouped[g] = filteredPins.filter(p => p.group === g); });

    // Collapsed state
    const collapseKey = `${ai}:${prof.id}`;
    const isCollapsed = sq ? false : !!collapsedProfiles[collapseKey];
    const totalPins = pins.length;

    // ── Profile header (collapsible) ──
    html += `<div class="profile-section-header" data-ai="${ai}" data-profile-id="${prof.id}">`;
    html += `<span class="profile-section-toggle">${isCollapsed ? '▶' : '▼'}</span>`;
    html += `<span class="profile-section-dot" style="background:${profColor}"></span>`;
    html += `<span class="profile-section-name">${escapeHtml(prof.name)}</span>`;
    html += `<span class="profile-section-count">${totalPins}</span>`;
    html += `</div>`;

    if (!isCollapsed) {
      // ── Ungrouped pins under this profile ──
      if (ungrouped.length > 0 || (groups.length === 0 && pins.length === 0 && !sq)) {
        if (pins.length === 0 && !sq) {
          html += `<div class="empty-pins" style="padding-left:18px;">Нет закреплённых чатов.<br>Открой нужный чат и нажми 📌</div>`;
        }
        ungrouped.forEach((pin) => {
          const realIdx = pins.indexOf(pin);
          html += renderPinItem(pin, realIdx, ai, prof.id);
        });
      }

      // ── Grouped pins under this profile ──
      groups.forEach(group => {
        const gPins = grouped[group] || [];
        if (sq && gPins.length === 0) return;
        const groupKey = `${ai}:${prof.id}:${group}`;
        const isGroupCollapsed = !!collapsedGroups[groupKey] && !sq;
        const gColor = groupColors[`${ai}:${group}`] || '';
        const colorStyle = gColor ? ` style="color:${gColor}"` : '';

        html += `<div class="group-header" data-group="${escapeHtml(group)}" data-ai="${ai}" data-profile-id="${prof.id}" draggable="true" ${gColor ? `data-color="${gColor}"` : ''} style="margin-left:10px;">`;
        html += `<span class="group-drag-handle" title="Перетащить группу">⠿</span>`;
        html += `<span class="group-toggle">${isGroupCollapsed ? '▶' : '▼'}</span>`;
        html += `<span class="group-name"${colorStyle}>${escapeHtml(group)}</span>`;
        html += `<span class="group-count"${gColor ? ` style="background:${gColor}22;color:${gColor}"` : ''}>${gPins.length}</span>`;
        html += `<button class="group-delete-btn" data-group="${escapeHtml(group)}" data-ai="${ai}" title="Распустить группу (пины → без группы)">✕</button>`;
        html += `</div>`;
        if (!isGroupCollapsed) {
          html += `<div class="group-pins" style="padding-left:20px;">`;
          gPins.forEach(pin => {
            const realIdx = pins.indexOf(pin);
            html += renderPinItem(pin, realIdx, ai, prof.id);
          });
          html += `</div>`;
        }
        html += `<div class="group-dropzone" data-group="${escapeHtml(group)}" data-ai="${ai}" style="margin-left:10px;"></div>`;
      });
    }
  });

  // No results
  if (sq && aiProfiles.every(prof => {
    const pk = pinKey(ai, prof.id);
    const pins = (pinnedChats[pk] || []).filter(matchesSearch);
    return pins.length === 0;
  })) {
    html += `<div class="empty-pins">Ничего не найдено</div>`;
  }

  sidebarBody.innerHTML = html;

  bindPinEvents();
  bindGroupEvents();
  bindProfileSectionEvents();
  bindDragEvents();
  updateGroupSelect();
}

function renderPinItem(pin, idx, ai, profileId) {
  const groupKey = pin.group ? `${ai}:${pin.group}` : '';
  const gColor = groupKey ? (groupColors[groupKey] || '') : '';
  const groupBadge = pin.group
    ? `<span class="pin-group-badge" data-idx="${idx}" data-ai="${ai}" data-profile-id="${profileId}" title="Изменить группу"${gColor ? ` style="background:${gColor}22;border-color:${gColor}44;color:${gColor}"` : ''}>${escapeHtml(pin.group)}</span>`
    : `<span class="pin-group-badge empty" data-idx="${idx}" data-ai="${ai}" data-profile-id="${profileId}" title="Назначить группу">⋯</span>`;

  return `<div class="pin-item" data-idx="${idx}" data-ai="${ai}" data-profile-id="${profileId}" draggable="true">
    <span class="pin-drag-handle" title="Перетащить">⠿</span>
    <span class="pin-icon">📌</span>
    <div style="flex:1;overflow:hidden;">
      <div class="pin-title">${escapeHtml(pin.title || 'Чат')}</div>
      <div class="pin-url">${escapeHtml(shortUrl(pin.url))}</div>
    </div>
    ${groupBadge}
    <button class="unpin-btn" data-idx="${idx}" data-ai="${ai}" data-profile-id="${profileId}" title="Открепить">✕</button>
  </div>`;
}

function bindPinEvents() {
  sidebarBody.querySelectorAll('.pin-item').forEach(el => {
    // Click → navigate to pinned chat
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('unpin-btn') || e.target.classList.contains('pin-group-badge') || e.target.classList.contains('pin-drag-handle') || e.target.classList.contains('pin-title-edit-input')) return;
      const ai  = el.dataset.ai;
      const profileId = el.dataset.profileId;
      const pk = pinKey(ai, profileId);
      const pins = pinnedChats[pk] || [];
      const pin = pins[parseInt(el.dataset.idx)];
      if (pin) {
        // Hide welcome page if visible
        if (typeof _welcomeVisible !== 'undefined' && _welcomeVisible) hideWelcomePage();
        // Switch to the correct profile tab first, then navigate
        const tabId = switchToProfileTab(ai, profileId);
        const wv = webviewElements[tabId];
        if (wv) wv.loadURL(pin.url);
      }
    });

    // Right-click → context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPinContextMenu(e.clientX, e.clientY, parseInt(el.dataset.idx), el.dataset.ai, el.dataset.profileId);
    });
  });

  sidebarBody.querySelectorAll('.unpin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ai = btn.dataset.ai;
      const profileId = btn.dataset.profileId;
      const pk = pinKey(ai, profileId);
      const pins = pinnedChats[pk] || [];
      pins.splice(parseInt(btn.dataset.idx), 1);
      savePins(); renderSidebar(); updateSidebarTabCounts();
      showToast('Откреплено');
    });
  });

  // Group badge click → show group selector popup
  sidebarBody.querySelectorAll('.pin-group-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      showGroupSelector(badge, parseInt(badge.dataset.idx), badge.dataset.ai);
    });
  });
}

function bindGroupEvents() {
  // Toggle group collapse
  sidebarBody.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (isDraggingGroup) return;
      if (e.target.classList.contains('group-delete-btn')) return;
      const group = header.dataset.group;
      const ai = header.dataset.ai;
      const profileId = header.dataset.profileId;
      const key = `${ai}:${profileId}:${group}`;
      collapsedGroups[key] = !collapsedGroups[key];
      renderSidebar();
    });

    // Right-click → group context menu
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showGroupContextMenu(e.clientX, e.clientY, header.dataset.group, header.dataset.ai);
    });
  });

  // Delete group — moves pins to ungrouped
  sidebarBody.querySelectorAll('.group-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = btn.dataset.group;
      const ai = btn.dataset.ai;
      // Remove group from all profiles of this AI
      profiles[ai].forEach(prof => {
        const pk = pinKey(ai, prof.id);
        const pins = pinnedChats[pk] || [];
        pins.forEach(pin => {
          if (pin.group === group) pin.group = '';
        });
      });
      savePins(); renderSidebar();
    });
  });
}

function bindProfileSectionEvents() {
  sidebarBody.querySelectorAll('.profile-section-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const ai = header.dataset.ai;
      const profileId = header.dataset.profileId;
      const key = `${ai}:${profileId}`;
      collapsedProfiles[key] = !collapsedProfiles[key];
      renderSidebar();
    });
  });
}

// ── Pin context menu ────────────────────────────────────────────────
function showPinContextMenu(x, y, pinIdx, ai, profileId) {
  closeContextMenu();

  const pk = pinKey(ai, profileId || 'default');
  const pin = (pinnedChats[pk] || [])[pinIdx];
  if (!pin) return;

  const groups = getAllGroupsForProfile(ai, profileId || 'default');

  const menu = document.createElement('div');
  menu.id = 'pin-context-menu';
  menu.className = 'context-menu';

  let html = '';

  // Rename
  html += `<div class="ctx-item" data-action="rename"><span class="ctx-icon">✏️</span> Переименовать</div>`;

  // Copy URL
  html += `<div class="ctx-item" data-action="copy-url"><span class="ctx-icon">📋</span> Копировать URL</div>`;

  html += `<div class="ctx-divider"></div>`;

  // Change group → submenu
  html += `<div class="ctx-item" data-action="set-group" data-group=""><span class="ctx-icon">📁</span> Без группы</div>`;
  groups.forEach(g => {
    const active = pin.group === g ? ' ctx-active' : '';
    html += `<div class="ctx-item${active}" data-action="set-group" data-group="${escapeHtml(g)}"><span class="ctx-icon">📁</span> ${escapeHtml(g)}</div>`;
  });
  html += `<div class="ctx-item" data-action="new-group"><span class="ctx-icon">➕</span> Новая группа…</div>`;

  html += `<div class="ctx-divider"></div>`;

  // Unpin
  html += `<div class="ctx-item ctx-danger" data-action="unpin"><span class="ctx-icon">🗑️</span> Открепить</div>`;

  menu.innerHTML = html;

  // Position: keep within viewport
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  document.body.appendChild(menu);

  // Adjust if overflows right/bottom
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  });

  // ── Close logic ──
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
  }

  function onOutside(e) {
    if (!menu.contains(e.target)) close();
  }

  function onEsc(e) {
    if (e.key === 'Escape') close();
  }

  // Delayed to avoid immediate close from the right-click
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  }, 10);

  // ── Menu item actions ──
  const ctxPk = pk; // capture for closure
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;

      switch (action) {
        case 'rename':
          close();
          // Find the pin element and start inline edit
          const pinEl = sidebarBody.querySelector(`.pin-item[data-idx="${pinIdx}"][data-ai="${ai}"][data-profile-id="${profileId}"]`);
          const titleEl = pinEl?.querySelector('.pin-title');
          if (pinEl && titleEl) startInlineEdit(pinEl, titleEl);
          break;

        case 'copy-url':
          copyToClipboard(pin.url);
          close();
          break;

        case 'set-group': {
          const ctxPins = pinnedChats[ctxPk] || [];
          if (ctxPins[pinIdx]) ctxPins[pinIdx].group = item.dataset.group;
          savePins(); close(); renderSidebar();
          break;
        }

        case 'new-group':
          close();
          showNewGroupFromMenu(pinIdx, ai, profileId);
          break;

        case 'unpin': {
          const ctxPins2 = pinnedChats[ctxPk] || [];
          ctxPins2.splice(pinIdx, 1);
          savePins(); close(); renderSidebar(); updateSidebarTabCounts();
          showToast('Откреплено');
          break;
        }
      }
    });
  });
}

// ── Group context menu ──────────────────────────────────────────────
function showGroupContextMenu(x, y, groupName, ai) {
  closeContextMenu();

  const key = `${ai}:${groupName}`;
  const currentColor = groupColors[key] || '';

  const menu = document.createElement('div');
  menu.id = 'group-context-menu';
  menu.className = 'context-menu';

  let html = '';

  // Rename
  html += `<div class="ctx-item" data-action="rename"><span class="ctx-icon">✏️</span> Переименовать</div>`;

  html += `<div class="ctx-divider"></div>`;

  // Color picker
  html += `<div class="ctx-item ctx-color-label"><span class="ctx-icon">🎨</span> Цвет группы</div>`;
  html += `<div class="ctx-color-palette">`;
  html += `<div class="ctx-color-swatch${!currentColor ? ' active' : ''}" data-color="" style="background:var(--text-muted);opacity:0.4" title="Без цвета"></div>`;
  GROUP_PALETTE.forEach(c => {
    html += `<div class="ctx-color-swatch${currentColor === c ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></div>`;
  });
  html += `</div>`;

  html += `<div class="ctx-divider"></div>`;

  // Disband
  html += `<div class="ctx-item ctx-danger" data-action="disband"><span class="ctx-icon">🗑️</span> Распустить группу</div>`;

  menu.innerHTML = html;

  // Position
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  document.body.appendChild(menu);

  // Adjust if overflows
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
  });

  // Close logic
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEsc, true);
  }

  function onOutside(e) {
    if (!menu.contains(e.target)) close();
  }

  function onEsc(e) {
    if (e.key === 'Escape') close();
  }

  setTimeout(() => {
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onEsc, true);
  }, 10);

  // Color swatch click
  menu.querySelectorAll('.ctx-color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      const color = swatch.dataset.color;
      if (color) {
        groupColors[key] = color;
      } else {
        delete groupColors[key];
      }
      savePins(); close(); renderSidebar();
    });
  });

  // Other menu actions
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;

      switch (action) {
        case 'rename':
          close();
          showGroupRenameInput(groupName, ai);
          break;

        case 'disband':
          getPinsForAI(ai).forEach(pin => {
            if (pin.group === groupName) pin.group = '';
          });
          // Also remove color
          delete groupColors[key];
          savePins(); close(); renderSidebar();
          break;
      }
    });
  });
}

// Inline rename for group
function showGroupRenameInput(groupName, ai) {
  const header = sidebarBody.querySelector(`.group-header[data-group="${CSS.escape(groupName)}"][data-ai="${ai}"]`);
  if (!header) return;

  const nameEl = header.querySelector('.group-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pin-title-edit-input';
  input.value = groupName;
  input.placeholder = 'Название группы';

  nameEl.style.display = 'none';
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
  input.focus();
  input.select();

  function commitRename() {
    const newName = input.value.trim();
    if (newName && newName !== groupName) {
      const oldKey = `${ai}:${groupName}`;
      const newKey = `${ai}:${newName}`;
      // Move color
      if (groupColors[oldKey]) {
        groupColors[newKey] = groupColors[oldKey];
        delete groupColors[oldKey];
      }
      // Rename all pins in this group
      getPinsForAI(ai).forEach(pin => {
        if (pin.group === groupName) pin.group = newName;
      });
      // Move collapse state
      const collapseKey = `${ai}:${groupName}`;
      const newCollapseKey = `${ai}:${newName}`;
      if (collapsedGroups[collapseKey] !== undefined) {
        collapsedGroups[newCollapseKey] = collapsedGroups[collapseKey];
        delete collapsedGroups[collapseKey];
      }
      savePins();
    }
    cleanup();
    renderSidebar();
  }

  function cancelRename() {
    cleanup();
    nameEl.style.display = '';
    input.remove();
  }

  function cleanup() {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keyup', onKeyUp);
  }

  function onKeyDown(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function onBlur() {
    commitRename();
  }

  function onKeyUp(e) {
    e.stopPropagation();
  }

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keyup', onKeyUp);
}

// New group input triggered from context menu
function showNewGroupFromMenu(pinIdx, ai, profileId) {
  // Reuse the group selector popup mechanism
  const pinEl = sidebarBody.querySelector(`.pin-item[data-idx="${pinIdx}"][data-ai="${ai}"][data-profile-id="${profileId}"]`);
  if (!pinEl) return;
  const badge = pinEl.querySelector('.pin-group-badge');
  if (badge) {
    showGroupSelector(badge, pinIdx, ai);
    // Auto-focus the new group input
    setTimeout(() => {
      const input = document.querySelector('.gs-new-input');
      if (input) input.focus();
    }, 100);
  }
}

// ── Inline editing of pin title ─────────────────────────────────────
function startInlineEdit(pinEl, titleEl) {
  const ai = pinEl.dataset.ai;
  const profileId = pinEl.dataset.profileId;
  const idx = parseInt(pinEl.dataset.idx);
  const pk = pinKey(ai, profileId);
  const pin = (pinnedChats[pk] || [])[idx];
  if (!pin) return;

  const currentTitle = pin.title || '';

  // Replace the title div with an input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'pin-title-edit-input';
  input.value = currentTitle;
  input.placeholder = 'Название чата';

  titleEl.style.display = 'none';
  titleEl.parentNode.insertBefore(input, titleEl.nextSibling);
  input.focus();
  input.select();

  function commitEdit() {
    const newTitle = input.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      const editPins = pinnedChats[pk] || [];
      if (editPins[idx]) editPins[idx].title = newTitle;
      savePins();
    }
    cleanup();
    renderSidebar();
  }

  function cancelEdit() {
    cleanup();
    titleEl.style.display = '';
    input.remove();
  }

  function cleanup() {
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('blur', onBlur);
    input.removeEventListener('keyup', onKeyUp);
  }

  function onKeyDown(e) {
    e.stopPropagation(); // Don't trigger global hotkeys
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }

  function onBlur() {
    commitEdit();
  }

  function onKeyUp(e) {
    e.stopPropagation(); // Don't trigger hotkey capture
  }

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keyup', onKeyUp);
}

// ── Drag & Drop ─────────────────────────────────────────────────────
function bindDragEvents() {
  // ── Pin items: draggable ──
  sidebarBody.querySelectorAll('.pin-item').forEach(el => {
    el.addEventListener('dragstart', onPinDragStart);
    el.addEventListener('dragend', onPinDragEnd);
    el.addEventListener('dragover', onPinDragOver);
    el.addEventListener('dragleave', onPinDragLeave);
    el.addEventListener('drop', onPinDrop);
  });

  // ── Group headers: drop targets (move pin into group) + draggable for reorder ──
  sidebarBody.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('dragover', onGroupHeaderDragOver);
    header.addEventListener('dragleave', onGroupHeaderDragLeave);
    header.addEventListener('drop', onGroupHeaderDrop);
    // Group drag (reorder)
    header.addEventListener('dragstart', onGroupDragStart);
    header.addEventListener('dragend', onGroupDragEnd);
  });

  // ── Section label "Без группы": drop target (move pin out of group) ──
  sidebarBody.querySelectorAll('.section-label').forEach(label => {
    label.addEventListener('dragover', onSectionLabelDragOver);
    label.addEventListener('dragleave', onSectionLabelDragLeave);
    label.addEventListener('drop', onSectionLabelDrop);
  });

  // ── Ungrouped header: drop target (move pin out of group) ──
  sidebarBody.querySelectorAll('.ungrouped-header').forEach(header => {
    header.addEventListener('dragover', onUngroupedHeaderDragOver);
    header.addEventListener('dragleave', onUngroupedHeaderDragLeave);
    header.addEventListener('drop', onUngroupedHeaderDrop);
  });

  // ── Group drop zones: drop pin here → move out of group (after it) ──
  sidebarBody.querySelectorAll('.group-dropzone').forEach(zone => {
    zone.addEventListener('dragover', onDropzoneDragOver);
    zone.addEventListener('dragleave', onDropzoneDragLeave);
    zone.addEventListener('drop', onDropzoneDrop);
  });

  // ── Bottom drop zone: place pin at the very end ──
  sidebarBody.querySelectorAll('.sidebar-bottom-dropzone').forEach(zone => {
    zone.addEventListener('dragover', onBottomDropzoneDragOver);
    zone.addEventListener('dragleave', onBottomDropzoneDragLeave);
    zone.addEventListener('drop', onBottomDropzoneDrop);
  });
}

// ── Pin drag ──
function onPinDragStart(e) {
  const el = e.currentTarget;
  const ai = el.dataset.ai;
  const idx = parseInt(el.dataset.idx);
  dragState = { ai, idx, pin: getPinsForAI(ai)[idx] };
  // Clear any group drag state
  groupDragState = null;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `pin:${ai}:${idx}`);
  requestAnimationFrame(() => {
    el.classList.add('dragging');
  });
}

function onPinDragEnd(e) {
  dragState = null;
  cleanupDragVisuals();
}

function onPinDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const el = e.currentTarget;
  if (el.dataset.ai === dragState.ai && parseInt(el.dataset.idx) === dragState.idx) return;

  const rect = el.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const isTop = e.clientY < midY;

  sidebarBody.querySelectorAll('.drag-over-top').forEach(x => x.classList.remove('drag-over-top'));
  sidebarBody.querySelectorAll('.drag-over-bottom').forEach(x => x.classList.remove('drag-over-bottom'));

  if (isTop) {
    el.classList.add('drag-over-top');
    el.classList.remove('drag-over-bottom');
  } else {
    el.classList.add('drag-over-bottom');
    el.classList.remove('drag-over-top');
  }
}

function onPinDragLeave(e) {
  const el = e.currentTarget;
  el.classList.remove('drag-over-top', 'drag-over-bottom');
}

function onPinDrop(e) {
  e.preventDefault();
  if (!dragState) return;

  const targetEl = e.currentTarget;
  const targetAi = targetEl.dataset.ai;
  const targetIdx = parseInt(targetEl.dataset.idx);

  if (targetAi !== dragState.ai) return;
  if (targetIdx === dragState.idx) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);
  const targetPin = pins[targetIdx];
  const targetGroup = targetPin.group;

  const rect = targetEl.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const isTop = e.clientY < midY;

  // Store original group before modifying the pin
  const originalGroup = dragState.pin.group;

  const [removed] = pins.splice(dragState.idx, 1);

  // Find target's new index after splice (indices shifted)
  let newTargetIdx = pins.indexOf(targetPin);
  if (newTargetIdx === -1) newTargetIdx = pins.length;

  // Check if target is the last pin in its group (after removal)
  const isLastInGroup = targetGroup && !pins.slice(newTargetIdx + 1).some(p => p.group === targetGroup);

  if (!isTop && isLastInGroup && originalGroup !== targetGroup) {
    // Dropping below the last pin in a DIFFERENT group → place after the group, ungrouped
    removed.group = '';
    pins.splice(newTargetIdx + 1, 0, removed);
  } else {
    // Standard behavior: join the target's group
    removed.group = targetGroup;
    if (isTop) {
      pins.splice(newTargetIdx, 0, removed);
    } else {
      pins.splice(newTargetIdx + 1, 0, removed);
    }
  }

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Drop on group header → move pin into that group ──
function onGroupHeaderDragOver(e) {
  e.preventDefault();
  // Accept both pin drags and group drags
  if (dragState) {
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('group-drop-target');
  } else if (groupDragState) {
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('group-reorder-target');
  }
}

function onGroupHeaderDragLeave(e) {
  e.currentTarget.classList.remove('group-drop-target', 'group-reorder-target');
}

function onGroupHeaderDrop(e) {
  e.preventDefault();

  // ── Group reorder drop ──
  if (groupDragState && !dragState) {
    const targetGroup = e.currentTarget.dataset.group;
    const targetAi = e.currentTarget.dataset.ai;

    if (targetAi !== groupDragState.ai) { onGroupDragEnd(e); return; }
    if (targetGroup === groupDragState.groupName) { onGroupDragEnd(e); return; }

    reorderGroup(groupDragState.ai, groupDragState.groupName, targetGroup);
    groupDragState = null;
    cleanupDragVisuals();
    renderSidebar();
    return;
  }

  // ── Pin → group drop ──
  if (!dragState) return;

  const group = e.currentTarget.dataset.group;
  const ai = e.currentTarget.dataset.ai;

  if (ai !== dragState.ai) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);
  const [removed] = pins.splice(dragState.idx, 1);
  removed.group = group;

  // Insert after the last pin in this group
  let lastGroupIdx = -1;
  for (let i = pins.length - 1; i >= 0; i--) {
    if (pins[i].group === group) { lastGroupIdx = i; break; }
  }
  pins.splice(lastGroupIdx + 1, 0, removed);

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Drop on "Без группы" section label → move pin out of group ──
function onSectionLabelDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('section-drop-target');
}

function onSectionLabelDragLeave(e) {
  e.currentTarget.classList.remove('section-drop-target');
}

function onSectionLabelDrop(e) {
  e.preventDefault();
  if (!dragState) return;

  const ai = sidebarActiveAI;
  if (ai !== dragState.ai) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);
  const [removed] = pins.splice(dragState.idx, 1);
  removed.group = '';

  // Insert at the end of the ungrouped section
  let lastUngroupedIdx = -1;
  for (let i = pins.length - 1; i >= 0; i--) {
    if (!pins[i].group) { lastUngroupedIdx = i; break; }
  }
  pins.splice(lastUngroupedIdx + 1, 0, removed);

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Drop on "Без группы" ungrouped header → move pin out of group ──
function onUngroupedHeaderDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('section-drop-target');
}

function onUngroupedHeaderDragLeave(e) {
  e.currentTarget.classList.remove('section-drop-target');
}

function onUngroupedHeaderDrop(e) {
  e.preventDefault();
  if (!dragState) return;

  const ai = e.currentTarget.dataset.ai;
  if (ai !== dragState.ai) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);
  const [removed] = pins.splice(dragState.idx, 1);
  removed.group = '';

  // Insert at the beginning (before any grouped pins)
  let firstGroupIdx = pins.findIndex(p => p.group);
  if (firstGroupIdx === -1) firstGroupIdx = pins.length;
  pins.splice(firstGroupIdx, 0, removed);

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Group drop zone → move pin out of group, place after this group ──
function onDropzoneDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('dropzone-active');
}

function onDropzoneDragLeave(e) {
  e.currentTarget.classList.remove('dropzone-active');
}

function onDropzoneDrop(e) {
  e.preventDefault();
  if (!dragState) return;

  const zoneGroup = e.currentTarget.dataset.group;
  const zoneAi = e.currentTarget.dataset.ai;

  if (zoneAi !== dragState.ai) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);

  // Remove the dragged pin
  const [removed] = pins.splice(dragState.idx, 1);
  removed.group = ''; // Move out of group

  // Insert after the last pin of this group
  let lastGroupIdx = -1;
  for (let i = pins.length - 1; i >= 0; i--) {
    if (pins[i].group === zoneGroup) { lastGroupIdx = i; break; }
  }
  pins.splice(lastGroupIdx + 1, 0, removed);

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Bottom drop zone → place pin at the very end, ungrouped ──
function onBottomDropzoneDragOver(e) {
  if (!dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('dropzone-active');
}

function onBottomDropzoneDragLeave(e) {
  e.currentTarget.classList.remove('dropzone-active');
}

function onBottomDropzoneDrop(e) {
  e.preventDefault();
  if (!dragState) return;

  const zoneAi = e.currentTarget.dataset.ai;
  if (zoneAi !== dragState.ai) { onPinDragEnd(e); return; }

  const pins = getPinsForAI(dragState.ai);
  const [removed] = pins.splice(dragState.idx, 1);
  removed.group = '';
  pins.push(removed);

  savePins();
  dragState = null;
  renderSidebar();
}

// ── Group reorder drag ──
function onGroupDragStart(e) {
  const header = e.currentTarget;
  const ai = header.dataset.ai;
  const groupName = header.dataset.group;

  isDraggingGroup = true;
  groupDragState = { ai, groupName };
  dragState = null; // Clear pin drag state
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `group:${ai}:${groupName}`);
  requestAnimationFrame(() => {
    header.classList.add('group-dragging');
  });
}

function onGroupDragEnd(e) {
  groupDragState = null;
  isDraggingGroup = false;
  cleanupDragVisuals();
}

// Reorder groups: move all pins of `sourceGroup` to be before/after `targetGroup`
function reorderGroup(ai, sourceGroup, targetGroup) {
  const pins = getPinsForAI(ai);

  // Extract all pins of the source group
  const sourcePins = pins.filter(p => p.group === sourceGroup);
  const otherPins = pins.filter(p => p.group !== sourceGroup);

  // Find the index of the first pin of targetGroup in otherPins
  let targetFirstIdx = -1;
  for (let i = 0; i < otherPins.length; i++) {
    if (otherPins[i].group === targetGroup) { targetFirstIdx = i; break; }
  }

  if (targetFirstIdx === -1) return;

  // Insert source group pins before the target group
  const newPins = [
    ...otherPins.slice(0, targetFirstIdx),
    ...sourcePins,
    ...otherPins.slice(targetFirstIdx),
  ];

  setPinsForAI(ai, newPins);
  savePins();
}

function cleanupDragVisuals() {
  sidebarBody.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  sidebarBody.querySelectorAll('.drag-over-top').forEach(el => el.classList.remove('drag-over-top'));
  sidebarBody.querySelectorAll('.drag-over-bottom').forEach(el => el.classList.remove('drag-over-bottom'));
  sidebarBody.querySelectorAll('.group-drop-target').forEach(el => el.classList.remove('group-drop-target'));
  sidebarBody.querySelectorAll('.section-drop-target').forEach(el => el.classList.remove('section-drop-target'));
  sidebarBody.querySelectorAll('.dropzone-active').forEach(el => el.classList.remove('dropzone-active'));
  sidebarBody.querySelectorAll('.group-dragging').forEach(el => el.classList.remove('group-dragging'));
  sidebarBody.querySelectorAll('.group-reorder-target').forEach(el => el.classList.remove('group-reorder-target'));
  sidebarBody.querySelectorAll('.sidebar-bottom-dropzone').forEach(el => el.classList.remove('dropzone-active'));
}

// ── Group selector popup ────────────────────────────────────────────
function showGroupSelector(anchor, pinIdx, ai) {
  // Remove any existing popup
  const existing = document.getElementById('group-selector');
  if (existing) existing.remove();

  const profileId = anchor.dataset.profileId || anchor.closest('.pin-item')?.dataset.profileId || 'default';
  const pk = pinKey(ai, profileId);
  const groups = getAllGroupsForProfile(ai, profileId);
  const currentGroup = (pinnedChats[pk] || [])[pinIdx]?.group || '';

  const popup = document.createElement('div');
  popup.id = 'group-selector';
  popup.className = 'group-selector-popup';

  let html = `<div class="gs-option ${!currentGroup ? 'active' : ''}" data-group="">Без группы</div>`;
  groups.forEach(g => {
    html += `<div class="gs-option ${currentGroup === g ? 'active' : ''}" data-group="${escapeHtml(g)}">${escapeHtml(g)}</div>`;
  });
  html += `<div class="gs-divider"></div>`;
  html += `<div class="gs-new-row">
    <input type="text" class="gs-new-input" placeholder="Новая группа...">
    <button class="gs-new-btn" title="Создать">＋</button>
  </div>`;

  popup.innerHTML = html;

  // Position the popup near the badge
  const rect = anchor.getBoundingClientRect();
  const sidebarRect = document.getElementById('sidebar').getBoundingClientRect();
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.left = `${sidebarRect.left + 8}px`;

  document.body.appendChild(popup);

  // ── Close logic ──
  function closePopup() {
    popup.remove();
    document.removeEventListener('mousedown', outsideClick, true);
  }

  function outsideClick(e) {
    if (!popup.contains(e.target)) closePopup();
  }

  // ── Select existing group ──
  popup.querySelectorAll('.gs-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = opt.dataset.group;
      const selPins = pinnedChats[pk] || [];
      if (selPins[pinIdx]) selPins[pinIdx].group = group;
      savePins(); closePopup(); renderSidebar();
    });
  });

  // ── Create new group ──
  const newInput = popup.querySelector('.gs-new-input');
  const newBtn = popup.querySelector('.gs-new-btn');

  function createNew() {
    const name = newInput.value.trim();
    if (!name) return;
    const selPins = pinnedChats[pk] || [];
    if (selPins[pinIdx]) selPins[pinIdx].group = name;
    savePins(); closePopup(); renderSidebar();
  }

  newBtn.addEventListener('click', (e) => { e.stopPropagation(); createNew(); });
  newInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') createNew();
    e.stopImmediatePropagation();
  });
  newInput.addEventListener('keyup', (e) => { e.stopPropagation(); e.stopImmediatePropagation(); });

  setTimeout(() => newInput.focus(), 50);

  setTimeout(() => {
    document.addEventListener('mousedown', outsideClick, true);
  }, 10);
}

// ── Update the <select> in add-pin-form ─────────────────────────────
function updateGroupSelect() {
  const sel = document.getElementById('pin-group-select');
  if (!sel) return;
  const groups = getAllGroups(sidebarActiveAI);
  const current = sel.value;
  sel.innerHTML = '<option value="">Без группы</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  });
  if (groups.includes(current)) sel.value = current;
}

// ── Search pins ─────────────────────────────────────────────────────
function setupSearchPins() {
  const input = document.getElementById('search-pins-input');
  const clearBtn = document.getElementById('search-clear-btn');
  if (!input || !clearBtn) return;

  const doSearch = () => {
    searchQuery = input.value.trim().toLowerCase();
    clearBtn.style.display = searchQuery ? 'block' : 'none';
    renderSidebar();
  };

  // Prevent other handlers from intercepting keystrokes in the search input
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
  });

  // Use multiple events for maximum compatibility (Windows IME issues, etc.)
  input.addEventListener('input', doSearch);
  input.addEventListener('keyup', (e) => {
    e.stopPropagation();
    // Only re-search if the value actually differs (avoid double-render)
    const current = input.value.trim().toLowerCase();
    if (current !== searchQuery) {
      doSearch();
    }
  });
  // Fallback for composition events (IME input on Windows)
  input.addEventListener('compositionend', () => {
    setTimeout(doSearch, 0);
  });
  // Ensure search triggers on any change
  input.addEventListener('change', doSearch);

  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    clearBtn.style.display = 'none';
    renderSidebar();
    input.focus();
  });
}
