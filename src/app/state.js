// ═══════════════════════════════════════════════════════════════════════
// app/state.js — Shared state variables, constants, and DOM references
//
// This file MUST be loaded first. It defines all global variables and
// constants that other modules depend on. No functions live here except
// trivial pure helpers that have zero dependencies on other modules.
//
// Dependencies: none (loaded first)
// ═══════════════════════════════════════════════════════════════════════

// ── Core state ──────────────────────────────────────────────────────
let activeAI = 'qwen';
let sidebarActiveAI = 'qwen';
let lastActiveAI = 'qwen'; // persisted across restarts
let pinnedChats = { 'qwen:default': [], 'zai:default': [], 'deepseek:default': [] };

// ── AI configuration ────────────────────────────────────────────────
const AI_CONFIG = {
  qwen:     { name: 'Qwen',     home: 'https://chat.qwen.ai'      },
  zai:      { name: 'GLM',      home: 'https://chat.z.ai'         },
  deepseek: { name: 'DeepSeek', home: 'https://chat.deepseek.com' },
};

let MAX_TABS_PER_AI = 3;
let MAX_PROFILES_PER_AI = 3;

// Profile color palette (same as accent colors for consistency)
const PROFILE_COLORS = [
  '#6c8ef5', '#5fcfab', '#f5c542', '#f472b6', '#e06c6c',
  '#fb923c', '#a3e635', '#38bdf8', '#c084fc', '#818cf8',
];

// Default profile color per AI (brand color)
const AI_DEFAULT_PROFILE_COLORS = {
  qwen: '#6366F1',
  zai: '#4ecdc4',
  deepseek: '#3964FE',
};

// AI brand colors used by sidebar, transfer, etc.
const AI_COLORS = {
  qwen:     'var(--accent-qwen)',
  zai:      'var(--accent-zai)',
  deepseek: 'var(--accent-ds)',
};

// Local icon files for each AI service
const AI_ICONS = {
  qwen: './icons/qwen.png',
  zai:  './icons/zai.png',
  deepseek: './icons/deepseek.png',
};

// ── Profiles & Tabs ─────────────────────────────────────────────────
// Profiles represent sessions (different partitions = different logins)
let profiles = {
  qwen:     [{ id: 'default', name: 'Основной', partition: 'persist:qwen', color: '#6366F1' }],
  zai:      [{ id: 'default', name: 'Основной', partition: 'persist:zai', color: '#4ecdc4' }],
  deepseek: [{ id: 'default', name: 'Основной', partition: 'persist:deepseek', color: '#3964FE' }],
};

// Tabs represent open webviews within each AI
let tabs = {
  qwen:     [{ id: 'qwen-0', profileId: 'default', url: 'https://chat.qwen.ai', customName: 'Вкладка 1' }],
  zai:      [{ id: 'zai-0',  profileId: 'default', url: 'https://chat.z.ai', customName: 'Вкладка 1' }],
  deepseek: [{ id: 'deepseek-0', profileId: 'default', url: 'https://chat.deepseek.com', customName: 'Вкладка 1' }],
};

// Which tab is active per AI
let activeTabId = { qwen: 'qwen-0', zai: 'zai-0', deepseek: 'deepseek-0' };

// Tab counter for generating unique IDs
let tabCounter = 1;

// Webview elements stored by tab id
let webviewElements = {};

// Transfer state (used by createWebviewElement IPC handler)
let transferExtractedText = '';

// ── Hotkey state (uses e.code — physical key, layout-independent) ──
let focusHotkey = { ctrl: true, alt: false, shift: false, code: 'Space', display: 'Ctrl+Space' };
let switchHotkey = { ctrl: true, alt: false, shift: false, code: 'Tab', display: 'Ctrl+Tab' };
let qwenHotkey = { ctrl: true, alt: false, shift: false, code: 'Digit1', display: 'Ctrl+1' };
let zaiHotkey = { ctrl: true, alt: false, shift: false, code: 'Digit2', display: 'Ctrl+2' };
let deepseekHotkey = { ctrl: true, alt: false, shift: false, code: 'Digit3', display: 'Ctrl+3' };
let pendingFocusHotkey = null;
let pendingSwitchHotkey = null;
let pendingQwenHotkey = null;
let pendingZaiHotkey = null;
let pendingDeepseekHotkey = null;
let listeningTarget = null; // 'focus' | 'switch' | 'qwen' | 'zai' | 'deepseek'

// ── Accent color (persisted in settings) ────────────────────────────
let accentColor = '#7aa2f7'; // default, matches Tokyo Night accent
let pendingAccentColor = null;
let pendingTheme = null;
let pendingAccentSource = null;
let defaultColorsMode = false; // when true, AI tabs use their own colors
let currentTheme = 'tokyonight';    // 'dark' | 'light' | 'midnight' | 'nord' | 'dracula' | 'tokyonight'
let accentSource = 'theme';   // 'theme' | 'default' | 'custom'
// Snapshot for revert on cancel
let _savedTheme = 'tokyonight';
let _savedAccentSource = 'theme';
let _savedAccentColor = '#7aa2f7';
let _savedTabIconMode = 'dots';

// ── Zoom per AI (persisted in settings) ────────────────────────────────
let zoomLevels = { qwen: 100, zai: 100, deepseek: 100 }; // percentage

// ── Themes ───────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    name: 'Тёмная',
    accent: '#6c8ef5',
    vars: {
      '--bg':         '#0f0f13',
      '--surface':    '#17171f',
      '--surface2':   '#1e1e28',
      '--border':     '#2a2a38',
      '--text':       '#e8e8f0',
      '--text-muted': '#6b6b80',
      '--text-dim':   '#9898b0',
      '--danger':     '#e06c6c',
      '--overlay':    'rgba(0,0,0,0.5)',
      '--shadow':     'rgba(0,0,0,0.4)',
    }
  },
  light: {
    name: 'Светлая',
    accent: '#4f6ef7',
    vars: {
      '--bg':         '#f0f2f5',
      '--surface':    '#ffffff',
      '--surface2':   '#e8eaed',
      '--border':     '#d0d4db',
      '--text':       '#1d1d1f',
      '--text-muted': '#6e6e73',
      '--text-dim':   '#48484a',
      '--danger':     '#d93025',
      '--overlay':    'rgba(0,0,0,0.25)',
      '--shadow':     'rgba(0,0,0,0.12)',
    }
  },
  midnight: {
    name: 'Полночь',
    accent: '#7b8cde',
    vars: {
      '--bg':         '#080c18',
      '--surface':    '#0f1629',
      '--surface2':   '#172038',
      '--border':     '#243054',
      '--text':       '#c8d0e8',
      '--text-muted': '#5a6a8a',
      '--text-dim':   '#7a8aaa',
      '--danger':     '#e06c6c',
      '--overlay':    'rgba(0,0,0,0.55)',
      '--shadow':     'rgba(0,0,0,0.5)',
    }
  },
  nord: {
    name: 'Nord',
    accent: '#88c0d0',
    vars: {
      '--bg':         '#2e3440',
      '--surface':    '#3b4252',
      '--surface2':   '#434c5e',
      '--border':     '#4c566a',
      '--text':       '#eceff4',
      '--text-muted': '#d8dee9',
      '--text-dim':   '#81a1c1',
      '--danger':     '#bf616a',
      '--overlay':    'rgba(0,0,0,0.45)',
      '--shadow':     'rgba(0,0,0,0.35)',
    }
  },
  dracula: {
    name: 'Dracula',
    accent: '#bd93f9',
    vars: {
      '--bg':         '#282a36',
      '--surface':    '#44475a',
      '--surface2':   '#343746',
      '--border':     '#6272a4',
      '--text':       '#f8f8f2',
      '--text-muted': '#6272a4',
      '--text-dim':   '#9092a8',
      '--danger':     '#ff5555',
      '--overlay':    'rgba(0,0,0,0.5)',
      '--shadow':     'rgba(0,0,0,0.4)',
    }
  },
  tokyonight: {
    name: 'Tokyo Night',
    accent: '#7aa2f7',
    vars: {
      '--bg':         '#1a1b26',
      '--surface':    '#24283b',
      '--surface2':   '#1f2335',
      '--border':     '#3b4261',
      '--text':       '#c0caf5',
      '--text-muted': '#565f89',
      '--text-dim':   '#a9b1d6',
      '--danger':     '#f7768e',
      '--overlay':    'rgba(0,0,0,0.5)',
      '--shadow':     'rgba(0,0,0,0.4)',
    }
  },
};

const APP_VERSION = '0.9.2';

const DEFAULT_ACCENT = '#6c8ef5';

// ── Group collapse state (in-memory, resets on restart) ──────────
let collapsedGroups = {};

// ── Group colors (persisted with pins) ─────────────────────────────
let groupColors = {}; // { 'ai:groupName': '#hex' }

// ── Drag & Drop state ──────────────────────────────────────────────
let dragState = null; // { ai, idx, pin }
let isDraggingGroup = false; // true once group header actually starts dragging
let groupDragState = null; // { ai, groupName }

// ── Tab icons mode ──────────────────────────────────────────────────
let tabIconMode = 'dots'; // 'dots' | 'icons'

// ── Search pins state ──────────────────────────────────────────────
let searchQuery = '';

// ── Sidebar collapsed profiles ─────────────────────────────────────
let collapsedProfiles = {}; // track which profile sections are collapsed

// ── Group color palette ────────────────────────────────────────────
const GROUP_PALETTE = [
  '#f5c542', '#6c8ef5', '#5fcfab', '#e06c6c', '#c084fc',
  '#f472b6', '#fb923c', '#38bdf8', '#a3e635', '#818cf8',
];

// ── Settings state ──────────────────────────────────────────────────
let settingsTrayEnabled = false;
let autoStartEnabled = false;     // auto-start on system boot
let closeConfirmationEnabled = true; // show confirmation before closing
let showWelcomeOnStart = true;       // show welcome page on startup
let _savedProfiles = null; // snapshot for cancel
let _settingsDirty = false; // track unsaved settings changes
let _savedMaxTabs = 3;      // snapshot for cancel
let _savedMaxProfiles = 3;  // snapshot for cancel

// ── Transfer state ──────────────────────────────────────────────────
let transferPopupOpen = false;

// ── DOM element references ──────────────────────────────────────────
const mainTabs      = document.querySelectorAll('.tab');
const sidebarTabs   = document.querySelectorAll('.sidebar-tab');
const sidebarBody   = document.getElementById('sidebar-body');
const urlDisplay    = document.getElementById('url-display');
const loadingOverlay= document.getElementById('loading-overlay');
const pinTitleInput = document.getElementById('pin-title-input');
const addPinBtn     = document.getElementById('add-pin-btn');
const pinCurrentBtn = document.getElementById('pin-current-btn');
const navBack       = document.getElementById('nav-back');
const navForward    = document.getElementById('nav-forward');
const navReload     = document.getElementById('nav-reload');
