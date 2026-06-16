const { app, BrowserWindow, ipcMain, session, globalShortcut, Tray, Menu, nativeImage, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Force all webviews to report dark color scheme to websites
nativeTheme.themeSource = 'dark';

// Paths for storing data
const STORE_PATH = path.join(app.getPath('userData'), 'pinned-chats.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let mainWindow = null;
let tray = null;
let trayEnabled = false;

// ── Data persistence ────────────────────────────────────────────────
function loadPinnedChats() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {}
  return { qwen: [], zai: [], deepseek: [] };
}

function savePinnedChats(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {}
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {}
  // Default settings
  return {
    focusHotkey: { ctrl: true, alt: false, shift: false, code: 'Space', display: 'Ctrl+Space' },
    switchHotkey: { ctrl: true, alt: false, shift: false, code: 'Tab', display: 'Ctrl+Tab' },
    qwenHotkey: { ctrl: true, alt: false, shift: false, code: 'Digit1', display: 'Ctrl+1' },
    zaiHotkey: { ctrl: true, alt: false, shift: false, code: 'Digit2', display: 'Ctrl+2' },
    deepseekHotkey: { ctrl: true, alt: false, shift: false, code: 'Digit3', display: 'Ctrl+3' },
    minimizeToTray: false,
    lastActiveAI: 'qwen',
    sidebarWidth: 220,
    accentColor: '#7aa2f7',
    theme: 'tokyonight',
    accentSource: 'theme',
    zoomLevels: { qwen: 100, zai: 100, deepseek: 100 },
    tabIconMode: 'dots',
  };
}

function saveSettings(data) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  } catch (e) {}
}

// ── Hotkey helpers ──────────────────────────────────────────────────
function codeToAccelerator(code) {
  if (code.startsWith('Key'))   return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    'Space': 'Space',        'Enter': 'Enter',         'Tab': 'Tab',
    'Backquote': '`',        'Minus': '-',             'Equal': '=',
    'BracketLeft': '[',      'BracketRight': ']',      'Backslash': '\\',
    'Semicolon': ';',        'Quote': "'",             'Comma': ',',
    'Period': '.',           'Slash': '/',             'Escape': 'Escape',
    'Backspace': 'Backspace','Delete': 'Delete',       'Insert': 'Insert',
    'Home': 'Home',          'End': 'End',             'PageUp': 'PageUp',
    'PageDown': 'PageDown',  'ArrowUp': 'Up',          'ArrowDown': 'Down',
    'ArrowLeft': 'Left',     'ArrowRight': 'Right',
  };
  if (map[code]) return map[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Numpad')) return code;
  return code;
}

function buildAccelerator(hotkey) {
  const parts = [];
  if (hotkey.ctrl)  parts.push('Ctrl');
  if (hotkey.alt)   parts.push('Alt');
  if (hotkey.shift) parts.push('Shift');
  parts.push(codeToAccelerator(hotkey.code));
  return parts.join('+');
}

// ── Global hotkey registration ──────────────────────────────────────
function registerGlobalHotkeys(settings) {
  globalShortcut.unregisterAll();

  // Focus mode hotkey
  if (settings.focusHotkey && settings.focusHotkey.code) {
    try {
      const acc = buildAccelerator(settings.focusHotkey);
      const ok = globalShortcut.register(acc, () => {
        if (mainWindow && mainWindow.isFocused()) {
          mainWindow.webContents.send('toggle-focus');
        }
      });
      if (!ok) console.error('Focus hotkey registration failed:', acc);
    } catch (e) {
      console.error('Focus hotkey error:', e.message);
    }
  }

  // AI switch hotkey (cycle)
  if (settings.switchHotkey && settings.switchHotkey.code) {
    try {
      const acc = buildAccelerator(settings.switchHotkey);
      const ok = globalShortcut.register(acc, () => {
        if (mainWindow && mainWindow.isFocused()) {
          mainWindow.webContents.send('switch-ai');
        }
      });
      if (!ok) console.error('Switch hotkey registration failed:', acc);
    } catch (e) {
      console.error('Switch hotkey error:', e.message);
    }
  }

  // Direct AI hotkeys: qwen / zai / deepseek
  const aiKeys = [
    { key: 'qwenHotkey',     event: 'switch-to-qwen'     },
    { key: 'zaiHotkey',      event: 'switch-to-zai'      },
    { key: 'deepseekHotkey', event: 'switch-to-deepseek'  },
  ];
  aiKeys.forEach(({ key, event }) => {
    if (settings[key] && settings[key].code) {
      try {
        const acc = buildAccelerator(settings[key]);
        const ok = globalShortcut.register(acc, () => {
          if (mainWindow && mainWindow.isFocused()) {
            mainWindow.webContents.send(event);
          }
        });
        if (!ok) console.error(`${key} registration failed:`, acc);
      } catch (e) {
        console.error(`${key} error:`, e.message);
      }
    }
  });
}

// ── Tray ────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return; // Already created

  const iconPath = path.join(__dirname, 'icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
    // On Linux, tray icons often need to be resized to 16x16 or 22x22
    if (process.platform === 'linux') {
      icon = icon.resize({ width: 22, height: 22 });
    }
  } else {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip('AI Hub');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Показать', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

// ── Session setup ───────────────────────────────────────────────────
function setupSession(partitionName) {
  const ses = session.fromPartition(partitionName);
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    callback({ responseHeaders: headers });
  });
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
}

// ── Window creation ─────────────────────────────────────────────────
function createWindow() {
  ['persist:qwen', 'persist:zai', 'persist:deepseek'].forEach(setupSession);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });

  const settings = loadSettings();

  const appIcon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f13',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.maximize();

  // ── IPC: Pinned chats ──
  ipcMain.handle('get-pinned', () => loadPinnedChats());
  ipcMain.handle('save-pinned', (_, data) => { savePinnedChats(data); return true; });

  // ── IPC: Settings ──
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_, data) => {
    saveSettings(data);
    registerGlobalHotkeys(data);
    // Handle tray toggle
    if (data.minimizeToTray && !trayEnabled) {
      createTray();
      trayEnabled = true;
    } else if (!data.minimizeToTray && trayEnabled) {
      destroyTray();
      trayEnabled = false;
    }
    return true;
  });
  // Lightweight: save only lastActiveAI without re-registering hotkeys
  ipcMain.handle('save-last-active-ai', (_, ai) => {
    const settings = loadSettings();
    settings.lastActiveAI = ai;
    saveSettings(settings);
    return true;
  });
  // Lightweight: save only sidebarWidth without re-registering hotkeys
  ipcMain.handle('save-sidebar-width', (_, width) => {
    const settings = loadSettings();
    settings.sidebarWidth = width;
    saveSettings(settings);
    return true;
  });

  // ── IPC: Clear session data for a partition ──
  ipcMain.handle('clear-session-data', (_, partition) => {
    try {
      const ses = session.fromPartition(partition);
      return ses.clearStorageData().then(() => true).catch(() => false);
    } catch(e) {
      return false;
    }
  });

  // ── IPC: Clipboard access ──
  // Used by the main renderer (preload.js) via electronAPI.readClipboardText /
  // writeClipboardText. Needed because navigator.clipboard may be unavailable
  // or restricted in the Electron renderer process.
  ipcMain.handle('clipboard-read-text', () => {
    try { return clipboard.readText(); }
    catch(e) { return ''; }
  });
  ipcMain.handle('clipboard-write-text', (_, text) => {
    try { clipboard.writeText(text); return true; }
    catch(e) { return false; }
  });

  // ── IPC: Window controls ──
  ipcMain.on('win-minimize', () => mainWindow.minimize());
  ipcMain.on('win-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
  ipcMain.on('win-close', () => {
    if (trayEnabled) {
      mainWindow.hide();
    } else {
      mainWindow.close();
    }
  });

  // ── IPC: Auto-start ──
  ipcMain.handle('set-autostart', (_, enabled) => {
    try {
      if (process.platform === 'linux') {
        const autostartDir = path.join(os.homedir(), '.config', 'autostart');
        const desktopPath = path.join(autostartDir, 'ai-hub.desktop');
        if (enabled) {
          if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
          const execPath = process.env.APPIMAGE || process.execPath;
          fs.writeFileSync(desktopPath,
            '[Desktop Entry]\n' +
            'Type=Application\n' +
            'Name=AI Hub\n' +
            'Comment=Unified AI chat interface\n' +
            `Exec=${execPath}\n` +
            'Icon=ai-hub\n' +
            'Terminal=false\n' +
            'Categories=Network;Chat;\n'
          );
        } else {
          if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
        }
      } else {
        app.setLoginItemSettings({ openAtLogin: enabled });
      }
      return true;
    } catch(e) { return false; }
  });

  // ── Register global hotkeys ──
  registerGlobalHotkeys(settings);

  // ── Setup tray if enabled ──
  if (settings.minimizeToTray) {
    createTray();
    trayEnabled = true;
  }

  // ── Minimize to tray on close if enabled ──
  // Also save tab URLs before actually closing
  mainWindow.on('close', (e) => {
    if (trayEnabled && !app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    // Save current tab URLs before closing
    if (!mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('save-before-close');
      } catch(err) {}
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

// ── Disable sandbox for webview preload ────────────────────────────
// In Electron 20+, sandbox is enabled by default for webviews.
// Our webview-preload.js uses require('electron') to get ipcRenderer for
// sending messages to the host (zoom, context menu, click forwarding).
// Keeping sandbox: false ensures require() works correctly.
app.on('will-attach-webview', (event, webPreferences, params) => {
  webPreferences.sandbox = false;
});

// ── Intercept zoom shortcuts in webviews ────────────────────────────
app.on('web-contents-created', (event, webContents) => {
  // Only handle webview webContents (not the main window)
  if (webContents.getType() === 'webview') {
    // Prevent default pinch-to-zoom
    webContents.setVisualZoomLevelLimits(1, 1);

    // Intercept keyboard zoom shortcuts (Ctrl+Plus/Minus/0)
    // Use input.code (layout-independent) instead of input.key
    webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (!input.control || input.alt) return;

      if (input.code === 'Equal' || input.code === 'NumpadAdd') {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('zoom-in');
        }
      } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('zoom-out');
        }
      } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('zoom-reset');
        }
      }
    });
  }
});
