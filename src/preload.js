const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPinned: () => ipcRenderer.invoke('get-pinned'),
  savePinned: (data) => ipcRenderer.invoke('save-pinned', data),
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close: () => ipcRenderer.send('win-close'),
  // Settings (includes hotkeys, tray, etc.)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  saveLastActiveAI: (ai) => ipcRenderer.invoke('save-last-active-ai', ai),
  saveSidebarWidth: (width) => ipcRenderer.invoke('save-sidebar-width', width),
  // Clear session data for a partition (used when deleting profiles)
  clearSessionData: (partition) => ipcRenderer.invoke('clear-session-data', partition),
  // Clipboard access — using IPC to main process (clipboard module may be
  // unavailable in sandboxed preload). This is the ONLY clipboard method.
  readClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  // Listen for global hotkey events from main process
  onToggleFocus: (callback) => {
    ipcRenderer.on('toggle-focus', () => callback());
  },
  onSwitchAI: (callback) => {
    ipcRenderer.on('switch-ai', () => callback());
  },
  onSwitchToQwen: (callback) => {
    ipcRenderer.on('switch-to-qwen', () => callback());
  },
  onSwitchToZai: (callback) => {
    ipcRenderer.on('switch-to-zai', () => callback());
  },
  onSwitchToDeepseek: (callback) => {
    ipcRenderer.on('switch-to-deepseek', () => callback());
  },
  // Zoom events from main process (intercepted from webviews via before-input-event)
  onZoomIn: (callback) => {
    ipcRenderer.on('zoom-in', () => callback());
  },
  onZoomOut: (callback) => {
    ipcRenderer.on('zoom-out', () => callback());
  },
  onZoomReset: (callback) => {
    ipcRenderer.on('zoom-reset', () => callback());
  },
  // Auto-start setting
  setAutoStart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  // Save before close event from main process
  onSaveBeforeClose: (callback) => {
    ipcRenderer.on('save-before-close', () => callback());
  },
});
