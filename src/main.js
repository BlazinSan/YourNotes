import './style.css'
import './sync.js'

// --- Data Persistence Override ---
const _originalSetItem = Storage.prototype.setItem;
const _originalGetItem = Storage.prototype.getItem;

Storage.prototype.setItem = function(key, value) {
  if (window.electronAPI && window.electronAPI.saveDataSync) {
    window.electronAPI.saveDataSync(key, value);
  }
  try {
    _originalSetItem.call(this, key, value);
  } catch (e) {
    console.warn("Storage quota exceeded in browser context, but successfully backup-persisted via Electron API.", e);
  }
  // Cloud sync: schedule a debounced push when signed in (no-op otherwise)
  if (window.__syncNotifyChange) window.__syncNotifyChange(key);
};

Storage.prototype.getItem = function(key) {
  if (window.electronAPI && window.electronAPI.loadDataSync) {
    const data = window.electronAPI.loadDataSync(key);
    if (data !== null) return data;
  }
  return _originalGetItem.call(this, key);
};

// removeItem/clear must ALSO update the Electron store — otherwise removed keys
// (and even a full factory reset) silently resurrect from the store file on restart.
const _originalRemoveItem = Storage.prototype.removeItem;
Storage.prototype.removeItem = function(key) {
  if (window.electronAPI && window.electronAPI.saveDataSync) {
    window.electronAPI.saveDataSync(key, null); // null = delete in the main process
  }
  try { _originalRemoveItem.call(this, key); } catch (_) {}
};
const _originalClear = Storage.prototype.clear;
Storage.prototype.clear = function() {
  if (window.electronAPI && window.electronAPI.clearDataSync) {
    window.electronAPI.clearDataSync();
  }
  try { _originalClear.call(this); } catch (_) {}
};
// ---------------------------------

// --- Store-ready guard ---------------------------------------------------
// If the data file exists but couldn't be read yet (e.g. antivirus briefly locking
// it right after a close→reopen), NEVER render an empty app (which used to look like
// a "reset"). Show a loading state and reload until the read succeeds. Data is safe
// on disk the whole time.
(function guardStoreReady() {
  const api = window.electronAPI;
  if (!(api && api.storeLoadFailed)) { return; }
  let failed = false;
  try { failed = api.storeLoadFailed(); } catch (_) { failed = false; }
  if (!failed) { try { sessionStorage.removeItem('__yn_retries'); } catch (_) {} return; }
  const tries = parseInt((() => { try { return sessionStorage.getItem('__yn_retries'); } catch (_) { return '0'; } })() || '0', 10);
  if (tries >= 8) { return; } // give up gracefully after ~7s; data remains safe on disk
  try { sessionStorage.setItem('__yn_retries', String(tries + 1)); } catch (_) {}
  const paint = () => { if (document.body) document.body.innerHTML = '<div style="position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;font-family:Inter,-apple-system,sans-serif;color:#8c7a6b;background:#12100e;"><div style="width:34px;height:34px;border:3px solid rgba(201,155,102,0.25);border-top-color:#c99b66;border-radius:50%;animation:ynspin 0.8s linear infinite;"></div><div>Loading your workspace…</div><style>@keyframes ynspin{to{transform:rotate(360deg)}}</style></div>'; };
  if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
  setTimeout(() => location.reload(), 650);
  throw new Error('yn:store-not-ready-retrying'); // halt the rest of main.js this pass
})();

// State
let notes = JSON.parse(localStorage.getItem('opennotes_data')) || [];
let activeNoteId = null;
let saveTimeout = null;

// Linking State
let isLinking = false;
let linkStartIndex = -1;
let selectedLinkIndex = 0;
let filteredLinks = [];

// DOM Elements
const notesListEl = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const searchInput = document.getElementById('search-input');
const noteTitleInput = document.getElementById('note-title');
let noteBodyInput = document.getElementById('note-body'); 
const deleteNoteBtn = document.getElementById('delete-note-btn');
const exportNoteBtn = document.getElementById('export-note-btn');
const saveIndicator = document.getElementById('save-indicator');
const editorContent = document.querySelector('.editor-content');
const editorHeader = document.querySelector('.editor-header');
const linkDropdown = document.getElementById('link-dropdown');
const floatingToolbar = document.getElementById('floating-toolbar');
const homePage = document.getElementById('home-page');
const homeGrid = document.getElementById('home-grid');
const homeGraph = document.getElementById('home-graph');
const graphCanvas = document.getElementById('graph-canvas');
const homeSearchInput = document.getElementById('home-search-input');
const appTitle = document.querySelector('.sidebar-brand h1');
const appContainer = document.querySelector('.app-container');
const viewGridBtn = document.getElementById('view-grid-btn');
const viewGraphBtn = document.getElementById('view-graph-btn');
const viewArchivedBtn = document.getElementById('view-archived-btn');
const dashboardTitle = document.getElementById('dashboard-title');
const dashboardBanner = document.getElementById('dashboard-banner');
const bannerUpload = document.getElementById('banner-upload');

let currentHomeView = 'grid';

// Initialize
function init() {
  document.execCommand('defaultParagraphSeparator', false, 'div');
  
  // Onboarding Logic
  const onboardingOverlay = document.getElementById('onboarding-overlay');
  const onboardingNameInput = document.getElementById('onboarding-name');
  const onboardingRoleInput = document.getElementById('onboarding-role');
  const onboardingSubmit = document.getElementById('onboarding-submit');
  
  const sidebarProfileName = document.getElementById('sidebar-profile-name');
  const sidebarProfileType = document.getElementById('sidebar-profile-type');
  const sidebarProfileAvatar = document.getElementById('sidebar-profile-avatar');
  
  let savedUserName = localStorage.getItem('userName');
  let savedUserRole = localStorage.getItem('userRole');
  
  function updateSidebarProfile() {
    if (sidebarProfileName && savedUserName) sidebarProfileName.textContent = savedUserName;
    if (sidebarProfileType && savedUserRole) sidebarProfileType.textContent = savedUserRole;
    if (sidebarProfileAvatar && savedUserName) {
      sidebarProfileAvatar.textContent = savedUserName.charAt(0).toUpperCase();
    }
    
    const bannerRoleText = document.getElementById('banner-role-text');
    const bannerNameText = document.getElementById('banner-name-text');
    if (bannerRoleText && savedUserRole) bannerRoleText.textContent = savedUserRole;
    if (bannerNameText && savedUserName) bannerNameText.textContent = savedUserName + '.';
  }

  if (!savedUserName || !savedUserRole) {
    if (onboardingOverlay) onboardingOverlay.style.display = 'flex';
    
    if (onboardingSubmit) {
      onboardingSubmit.addEventListener('click', () => {
        savedUserName = onboardingNameInput.value.trim() || 'Guest';
        savedUserRole = onboardingRoleInput.value.trim() || 'Personal Account';
        
        localStorage.setItem('userName', savedUserName);
        localStorage.setItem('userRole', savedUserRole);
        
        updateSidebarProfile();
        onboardingOverlay.style.display = 'none';
      });
    }
  } else {
    updateSidebarProfile();
  }

  
  // Dashboard Title Initialization
  const savedTitle = localStorage.getItem('dashboardTitle');
  if (savedTitle && dashboardTitle) {
    dashboardTitle.textContent = savedTitle;
  }
  
  if (dashboardTitle) {
    dashboardTitle.addEventListener('blur', () => {
      localStorage.setItem('dashboardTitle', dashboardTitle.textContent);
    });
    dashboardTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dashboardTitle.blur();
      }
    });
  }

  window.setBannerTextColor = function(color) {
    const textOverlay = document.querySelector('.banner-text-overlay');
    if (!textOverlay) return;
    
    if (color === 'white') {
      textOverlay.classList.remove('light-bg');
      textOverlay.classList.add('dark-bg');
      localStorage.setItem('opennotes_banner_text_color', 'white');
    } else if (color === 'black') {
      textOverlay.classList.remove('dark-bg');
      textOverlay.classList.add('light-bg');
      localStorage.setItem('opennotes_banner_text_color', 'black');
    }
  };

  // Banner Text Color Helper
  function updateBannerTextColor(dataUrl) {
    const override = localStorage.getItem('opennotes_banner_text_color');
    const textOverlay = document.querySelector('.banner-text-overlay');
    
    if (override === 'white' || override === 'black') {
      if (textOverlay) {
        textOverlay.classList.remove('light-bg', 'dark-bg');
        textOverlay.classList.add(override === 'white' ? 'dark-bg' : 'light-bg');
      }
      return;
    }

    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch(e) {
        return;
      }
      const data = imageData.data;
      let r = 0, g = 0, b = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 40) {
        r += data[i];
        g += data[i+1];
        b += data[i+2];
        count++;
      }
      r = r / count;
      g = g / count;
      b = b / count;
      
      const brightness = Math.sqrt(
        0.299 * (r * r) +
        0.587 * (g * g) +
        0.114 * (b * b)
      );
      
      if (textOverlay) {
        if (brightness > 127.5) {
          textOverlay.classList.remove('dark-bg');
          textOverlay.classList.add('light-bg');
        } else {
          textOverlay.classList.remove('light-bg');
          textOverlay.classList.add('dark-bg');
        }
      }
    };
    img.src = dataUrl;
  }

  // Dashboard Banner Initialization
  const savedBanner = localStorage.getItem('dashboardBanner');
  if (savedBanner && dashboardBanner) {
    const bannerSrc = window.resolveFileUrl ? window.resolveFileUrl(savedBanner) : savedBanner;
    dashboardBanner.style.backgroundImage = `url(${bannerSrc})`;
    updateBannerTextColor(bannerSrc);
  }
  
  if (bannerUpload) {
    bannerUpload.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Save the cover to disk (path only in the store) so the store stays small/fast.
      if (window.electronAPI && window.electronAPI.saveBoardFile) {
        try {
          const buf = await file.arrayBuffer();
          const osPath = await window.electronAPI.saveBoardFile(file.name || 'banner.png', buf);
          const url = 'file:///' + String(osPath).replace(/\\/g, '/');
          dashboardBanner.style.backgroundImage = `url(${url})`;
          updateBannerTextColor(url);
          localStorage.setItem('dashboardBanner', url);
          return;
        } catch (err) { /* fall through to inline data URL */ }
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        dashboardBanner.style.backgroundImage = `url(${dataUrl})`;
        updateBannerTextColor(dataUrl);
        try { localStorage.setItem('dashboardBanner', dataUrl); } catch (_) {}
      };
      reader.readAsDataURL(file);
    });
  }
  
  if (appTitle) {
    appTitle.style.cursor = 'pointer';
    appTitle.addEventListener('click', () => setActiveNote(null));
  }
  
  const editorHomeBtn = document.getElementById('editor-home-btn');
  if (editorHomeBtn) {
    editorHomeBtn.addEventListener('click', () => setActiveNote(null));
  }
  
  // Only seed the welcome note on a genuine first run. The `opennotes_initialized`
  // flag prevents a transient read failure from overwriting existing notes with a
  // fresh welcome note (which is how data appeared to "reset" before).
  if (notes.length === 0 && !localStorage.getItem('opennotes_initialized')) {
    const newNote = {
      id: Date.now().toString(),
      title: 'Welcome to YourNotes',
      body: 'This is your first note. Start typing...',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.push(newNote);
    localStorage.setItem('opennotes_initialized', '1');
    saveNotes();
  }
  
  renderNotesList();
  setActiveNote(null);
  
  editorContent.addEventListener('click', (e) => {
    const link = e.target.closest('.note-link');
    if (link) {
      const targetId = link.getAttribute('data-id');
      if (targetId) setActiveNote(targetId);
    }
  });
}

// Save to LocalStorage
function saveNotes() {
  localStorage.setItem('opennotes_data', JSON.stringify(notes));
}

function loadStringSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch (_) {
    return new Set();
  }
}

function saveStringSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

let archivedNoteIds = loadStringSet('opennotes_archived_notes');
let expandedSidebarGroups = loadStringSet('opennotes_sidebar_expanded_groups');

function saveArchivedNoteIds() {
  saveStringSet('opennotes_archived_notes', archivedNoteIds);
}

function isNoteArchived(noteOrId) {
  const id = typeof noteOrId === 'string' ? noteOrId : noteOrId && noteOrId.id;
  return !!id && archivedNoteIds.has(id);
}

function visibleSidebarNotes() {
  return notes.filter(note => !isNoteArchived(note));
}

function groupTitle(folderName, title) {
  const cleanTitle = (title || '').trim() || 'Untitled Note';
  return folderName && folderName !== 'Ungrouped' ? `${folderName} · ${cleanTitle}` : cleanTitle;
}

// Render Notes List
function renderNotesList(filterText = '') {
  notesListEl.innerHTML = '';
  const term = (filterText || '').toLowerCase();

  const filteredNotes = visibleSidebarNotes().filter(note => {
    const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : '';
    return (note.title || '').toLowerCase().includes(term) ||
           (plainText || '').toLowerCase().includes(term) ||
           noteGroup(note).toLowerCase().includes(term);
  });

  filteredNotes.sort((a, b) => b.updatedAt - a.updatedAt);

  if (filteredNotes.length === 0) {
    notesListEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-secondary); font-size:0.9rem;">No notes found</div>`;
    return;
  }

  const groups = new Map();
  filteredNotes.forEach(note => {
    const group = noteGroup(note);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(note);
  });

  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });

  groupNames.forEach(group => {
    const items = groups.get(group);
    const expanded = !!term || expandedSidebarGroups.has(group) || items.some(note => note.id === activeNoteId);
    const header = document.createElement('div');
    header.className = 'sidebar-note-group';
    header.innerHTML = `
      <svg class="sidebar-note-group-chevron ${expanded ? '' : 'collapsed'}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      <span class="sidebar-note-group-name">${gsEscape(group)}</span>
      <span class="sidebar-note-group-count">${items.length}</span>
    `;
    header.onclick = () => {
      if (expandedSidebarGroups.has(group)) expandedSidebarGroups.delete(group);
      else expandedSidebarGroups.add(group);
      saveStringSet('opennotes_sidebar_expanded_groups', expandedSidebarGroups);
      renderNotesList(filterText);
    };
    header.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCollegeContextMenu('project-folder', group, e.clientX, e.clientY);
    };
    notesListEl.appendChild(header);

    if (!expanded) return;

    items.forEach(note => {
      const date = new Date(note.updatedAt);
      const dateString = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : 'No content...';

      const div = document.createElement('div');
      div.className = `note-item ${note.id === activeNoteId ? 'active' : ''}`;
      div.onclick = () => setActiveNote(note.id);
      div.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCollegeContextMenu('note', note.id, e.clientX, e.clientY);
      };

      div.innerHTML = `
        <div class="note-item-title">${gsEscape(noteDisplayTitle(note))}</div>
        <div class="note-item-preview">${gsEscape(plainText)}</div>
        <div class="note-item-date">${dateString}</div>
      `;

      notesListEl.appendChild(div);
    });
  });
}

// Set Active Note
function setActiveNote(id) {
  activeNoteId = id;
  const note = notes.find(n => n.id === id);
  
  if (note) {
    noteTitleInput.value = note.title;
    
    if (!document.getElementById('note-body')) {
      const drop = document.getElementById('link-dropdown');
      document.querySelector('.editor-content').innerHTML = '<div id="note-body" contenteditable="true" data-placeholder="Start typing your note here..."></div>';
      document.querySelector('.editor-content').appendChild(drop);
      reattachNoteBodyListeners();
    }
    
    noteBodyInput.innerHTML = note.body || '';
    
    editorHeader.style.display = 'flex';
    document.querySelector('.editor-content').style.display = 'flex';
    if (homePage) homePage.style.display = 'none';
    if (appContainer) appContainer.classList.remove('home-active');
    
  } else {
    noteTitleInput.value = '';
    
    editorHeader.style.display = 'none';
    document.querySelector('.editor-content').style.display = 'none';
    if (appContainer) appContainer.classList.add('home-active');
    
    if (homePage) {
      homePage.style.display = 'flex';
      renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
      if (currentHomeView === 'graph') {
        initGraph();
      }
    }
  }
  
  renderNotesList(searchInput.value);
}

// --- Notes grouping / sort / filter state ---
let homeSort = localStorage.getItem('opennotes_home_sort') || 'recent';
let homeFolderFilter = 'all';
let expandedProjectGroups = loadStringSet('opennotes_expanded_project_groups');
let homeArchiveMode = false;

// Pinned project folders (group names) — render first in the Projects grid
let pinnedGroups = JSON.parse(localStorage.getItem('opennotes_pinned_groups') || '[]');
window.togglePinGroup = function(name) {
  if (pinnedGroups.includes(name)) pinnedGroups = pinnedGroups.filter(g => g !== name);
  else pinnedGroups.push(name);
  localStorage.setItem('opennotes_pinned_groups', JSON.stringify(pinnedGroups));
  renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
};

// -----------------------------------------
// Favourites — star anything (notes, project folders, college folders/PDFs);
// listed together on a Favourites view under College Notes. Stored as {type, id}.
// -----------------------------------------
let favourites = JSON.parse(localStorage.getItem('opennotes_favourites') || '[]');
function isFav(type, id) { return favourites.some(f => f.type === type && f.id === id); }
window.toggleFav = function(e, type, id) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (isFav(type, id)) favourites = favourites.filter(f => !(f.type === type && f.id === id));
  else favourites.push({ type, id });
  localStorage.setItem('opennotes_favourites', JSON.stringify(favourites));
  // re-render whatever is visible
  if (document.getElementById('home-grid') && document.getElementById('home-grid').offsetParent) renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
  if (typeof renderCollegeFolders === 'function') { const c = document.getElementById('home-college'); if (c && c.style.display !== 'none') { if (activeCollegeFolderId) renderCollegeSingleFolder(activeCollegeFolderId); else renderCollegeFolders(); } }
  const favPanel = document.getElementById('home-favourites');
  if (typeof renderFavourites === 'function' && favPanel && favPanel.style.display !== 'none') renderFavourites();
};
const STAR_SVG = (filled) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

window.showFavourites = function() {
  setActiveNote(null);
  showPanel('home-favourites', 'nav-favourites-btn');
  renderFavourites();
};
function renderFavourites() {
  const list = document.getElementById('favourites-list');
  if (!list) return;
  const items = [];
  favourites.forEach(f => {
    if (f.type === 'note') {
      const n = notes.find(x => x.id === f.id);
      if (n) items.push({ icon: GS_ICONS.note, label: noteDisplayTitle(n), sub: noteGroup(n), type: 'Note', open: () => setActiveNote(n.id) });
    } else if (f.type === 'group') {
      if (notes.some(n => noteGroup(n) === f.id)) items.push({ icon: GS_ICONS.folder, label: f.id, sub: 'Project folder', type: 'Folder', open: () => { window.goToDashboard(); window.setHomeFolderFilter(f.id); } });
    } else if (f.type === 'folder') {
      const fol = collegeFolders.find(x => x.id === f.id);
      if (fol) items.push({ icon: GS_ICONS.folder, label: fol.name, sub: fol.category || 'College', type: 'College Folder', open: () => { window.toggleCollegePanel(); window.openCollegeFolder(fol.id); } });
    } else if (f.type === 'pdf') {
      let found = null, fol = null;
      collegeFolders.forEach(x => (x.pdfs || []).forEach(p => { if (p.id === f.id) { found = p; fol = x; } }));
      if (found) items.push({ icon: GS_ICONS.pdf, label: found.name, sub: fol.name, type: 'College File', open: () => { window.toggleCollegePanel(); window.openCollegeFolder(fol.id); setTimeout(() => window.viewCollegePDF(found.id), 80); } });
    }
  });
  if (items.length === 0) {
    list.innerHTML = `<div style="text-align:center; padding:60px 20px; color:var(--text-secondary);">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.5; margin-bottom:16px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
      <h4 style="font-size:1.1rem; font-weight:600; color:var(--text-primary); margin:0 0 4px;">No favourites yet</h4>
      <p style="font-size:0.9rem; margin:0;">Tap the ★ on any note, folder, or file to add it here.</p></div>`;
    return;
  }
  list.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'fav-row';
    b.innerHTML = `${it.icon}<span class="fav-row-label">${gsEscape(it.label)}</span><span class="fav-row-type">${it.type}</span>${it.sub ? `<span class="fav-row-sub">${gsEscape(it.sub)}</span>` : ''}`;
    b.onclick = it.open;
    list.appendChild(b);
  });
}

// A note's "folder" is the prefix before " · " in its title (set on import); else "Ungrouped".
function noteGroup(n) {
  const t = n.title || '';
  const i = t.indexOf(' · ');
  return i > -1 ? t.slice(0, i).trim() : 'Ungrouped';
}
function noteDisplayTitle(n) {
  const t = n.title || 'Untitled Note';
  const i = t.indexOf(' · ');
  return i > -1 ? (t.slice(i + 3).trim() || t) : t;
}

function projectNotesForMode() {
  return notes.filter(note => homeArchiveMode ? isNoteArchived(note) : !isNoteArchived(note));
}

function projectFolderNames(sourceNotes = notes) {
  return [...new Set(sourceNotes.map(noteGroup))].sort((a, b) => {
    if (a === 'Ungrouped') return 1;
    if (b === 'Ungrouped') return -1;
    return a.localeCompare(b);
  });
}

function notesInProjectFolder(folderName) {
  return notes.filter(note => noteGroup(note) === folderName);
}

function refreshNoteSurfaces(searchTerm = undefined) {
  renderHomeGrid(searchTerm !== undefined ? searchTerm : (homeSearchInput ? homeSearchInput.value : ''));
  renderNotesList(searchInput ? searchInput.value : '');
  const favPanel = document.getElementById('home-favourites');
  if (typeof renderFavourites === 'function' && favPanel && favPanel.style.display !== 'none') renderFavourites();
  if (currentHomeView === 'graph' && !homeArchiveMode) initGraph();
}

function setNoteArchived(noteId, archived) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  if (archived) archivedNoteIds.add(noteId);
  else archivedNoteIds.delete(noteId);
  saveArchivedNoteIds();
  if (activeNoteId === noteId && archived) setActiveNote(null);
  else refreshNoteSurfaces();
}

function setProjectFolderArchived(folderName, archived) {
  const folderNotes = notesInProjectFolder(folderName);
  if (folderNotes.length === 0) return;
  folderNotes.forEach(note => archived ? archivedNoteIds.add(note.id) : archivedNoteIds.delete(note.id));
  saveArchivedNoteIds();
  if (folderNotes.some(note => note.id === activeNoteId) && archived) setActiveNote(null);
  else refreshNoteSurfaces();
}

function renameProjectFolder(folderName) {
  const nextName = prompt('Rename folder:', folderName);
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) return;
  notesInProjectFolder(folderName).forEach(note => {
    note.title = groupTitle(trimmed, noteDisplayTitle(note));
    note.updatedAt = Date.now();
  });
  pinnedGroups = pinnedGroups.map(g => g === folderName ? trimmed : g);
  favourites = favourites.map(f => (f.type === 'group' && f.id === folderName) ? { ...f, id: trimmed } : f);
  if (homeFolderFilter === folderName) homeFolderFilter = trimmed;
  if (expandedProjectGroups.delete(folderName)) expandedProjectGroups.add(trimmed);
  if (expandedSidebarGroups.delete(folderName)) expandedSidebarGroups.add(trimmed);
  localStorage.setItem('opennotes_pinned_groups', JSON.stringify(pinnedGroups));
  localStorage.setItem('opennotes_favourites', JSON.stringify(favourites));
  saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
  saveStringSet('opennotes_sidebar_expanded_groups', expandedSidebarGroups);
  saveNotes();
  refreshNoteSurfaces();
}

function renameProjectNote(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  const folder = noteGroup(note);
  const nextName = prompt('Rename note:', noteDisplayTitle(note));
  if (nextName === null) return;
  const trimmed = nextName.trim();
  if (!trimmed) return;
  note.title = groupTitle(folder, trimmed);
  note.updatedAt = Date.now();
  if (activeNoteId === noteId) noteTitleInput.value = note.title;
  saveNotes();
  refreshNoteSurfaces();
}

function deleteProjectNote(noteId) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  if (!confirm(`Are you sure you want to delete the note "${noteDisplayTitle(note)}"?`)) return;
  notes = notes.filter(n => n.id !== noteId);
  archivedNoteIds.delete(noteId);
  saveArchivedNoteIds();
  saveNotes();
  if (activeNoteId === noteId) setActiveNote(null);
  else refreshNoteSurfaces();
}

function deleteProjectFolder(folderName) {
  const folderNotes = notesInProjectFolder(folderName);
  if (folderNotes.length === 0) return;
  if (!confirm(`Delete "${folderName}" and all ${folderNotes.length} note${folderNotes.length === 1 ? '' : 's'} inside it?`)) return;
  const ids = new Set(folderNotes.map(note => note.id));
  notes = notes.filter(note => !ids.has(note.id));
  ids.forEach(id => archivedNoteIds.delete(id));
  pinnedGroups = pinnedGroups.filter(g => g !== folderName);
  favourites = favourites.filter(f => !(f.type === 'group' && f.id === folderName) && !(f.type === 'note' && ids.has(f.id)));
  expandedProjectGroups.delete(folderName);
  expandedSidebarGroups.delete(folderName);
  if (homeFolderFilter === folderName) homeFolderFilter = 'all';
  localStorage.setItem('opennotes_pinned_groups', JSON.stringify(pinnedGroups));
  localStorage.setItem('opennotes_favourites', JSON.stringify(favourites));
  saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
  saveStringSet('opennotes_sidebar_expanded_groups', expandedSidebarGroups);
  saveArchivedNoteIds();
  saveNotes();
  if (ids.has(activeNoteId)) setActiveNote(null);
  else refreshNoteSurfaces();
}

function moveProjectNoteToFolder(noteId, folderName) {
  const note = notes.find(n => n.id === noteId);
  if (!note) return;
  note.title = groupTitle(folderName, noteDisplayTitle(note));
  note.updatedAt = Date.now();
  expandedProjectGroups.add(folderName);
  expandedSidebarGroups.add(folderName);
  saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
  saveStringSet('opennotes_sidebar_expanded_groups', expandedSidebarGroups);
  if (activeNoteId === noteId) noteTitleInput.value = note.title;
  saveNotes();
  refreshNoteSurfaces();
}

function createProjectFolderWithFirstNote() {
  const folderName = prompt('New folder name:');
  if (folderName === null) return;
  const trimmed = folderName.trim();
  if (!trimmed) return;
  homeArchiveMode = false;
  currentHomeView = 'grid';
  expandedProjectGroups.add(trimmed);
  expandedSidebarGroups.add(trimmed);
  saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
  saveStringSet('opennotes_sidebar_expanded_groups', expandedSidebarGroups);
  createNote(groupTitle(trimmed, 'Untitled Note'), '');
}

function sortNotes(arr, mode) {
  const a = [...arr];
  if (mode === 'oldest') a.sort((x, y) => (x.updatedAt || 0) - (y.updatedAt || 0));
  else if (mode === 'az') a.sort((x, y) => (x.title || '').localeCompare(y.title || ''));
  else if (mode === 'za') a.sort((x, y) => (y.title || '').localeCompare(x.title || ''));
  else a.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  return a;
}

window.setHomeSort = function(v) { homeSort = v; localStorage.setItem('opennotes_home_sort', v); renderHomeGrid(homeSearchInput ? homeSearchInput.value : ''); };
window.setHomeFolderFilter = function(v) { homeFolderFilter = v; renderHomeGrid(homeSearchInput ? homeSearchInput.value : ''); };

function populateFolderFilter() {
  const sel = document.getElementById('home-folder-filter');
  if (!sel) return;
  const groups = projectFolderNames(projectNotesForMode());
  if (!groups.includes(homeFolderFilter)) homeFolderFilter = 'all';
  const cur = homeFolderFilter;
  sel.innerHTML = '<option value="all">All folders</option>' + groups.map(g => `<option value="${g.replace(/"/g, '&quot;')}">${g}</option>`).join('');
  sel.value = cur;
  const ss = document.getElementById('home-sort');
  if (ss) ss.value = homeSort;
  if (typeof refreshSelects === 'function') refreshSelects();
}

function makeNoteCard(note) {
  const date = new Date(note.updatedAt);
  const dateString = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const card = document.createElement('div');
  card.className = 'book-card';
  card.onclick = () => setActiveNote(note.id);
  card.oncontextmenu = (e) => { e.preventDefault(); showCollegeContextMenu('note', note.id, e.clientX, e.clientY); };
  card.innerHTML = `
    <button class="card-fav-btn fav-btn ${isFav('note', note.id) ? 'active' : ''}" title="Favourite" onclick="toggleFav(event,'note','${note.id}')">${STAR_SVG(isFav('note', note.id))}</button>
    <div class="book-card-title">${gsEscape(noteDisplayTitle(note))}</div>
    <div class="book-card-date">${dateString}</div>
  `;
  return card;
}

function renderHomeGrid(searchTerm = '') {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  const term = (searchTerm || '').toLowerCase();
  populateFolderFilter();

  // "Create New Note" card (only in the default, unfiltered view)
  if (!homeArchiveMode && !term && homeFolderFilter === 'all') {
    const newCard = document.createElement('div');
    newCard.className = 'book-card new-note-card';
    newCard.onclick = () => createNote('', '');
    newCard.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      createProjectFolderWithFirstNote();
    };
    newCard.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      <div style="font-size: 1.2rem; font-weight: 600;">Create New Note</div>
    `;
    homeGrid.appendChild(newCard);
  }

  const modeNotes = projectNotesForMode();
  if (modeNotes.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 40px; font-size: 1.1rem;';
    empty.textContent = homeArchiveMode ? 'No archived notes yet.' : 'No notes found.';
    homeGrid.appendChild(empty);
    return;
  }

  const filtered = modeNotes.filter(n => {
    const title = (n.title || '').toLowerCase();
    const plainBody = (n.body || '').replace(/<[^>]*>?/gm, '').toLowerCase();
    const group = noteGroup(n).toLowerCase();
    const matchSearch = !term || title.includes(term) || plainBody.includes(term) || group.includes(term);
    const matchFolder = homeFolderFilter === 'all' || noteGroup(n) === homeFolderFilter;
    return matchSearch && matchFolder;
  });

  if (filtered.length === 0) {
    const noResults = document.createElement('div');
    noResults.style.cssText = 'color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 40px; font-size: 1.1rem;';
    noResults.textContent = 'No notes found.';
    homeGrid.appendChild(noResults);
    return;
  }

  // Group the filtered notes
  const groups = new Map();
  filtered.forEach(n => { const g = noteGroup(n); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n); });

  // Order folders: pinned first, then by the chosen sort (which now sorts the folders too)
  const repTime = (items, oldest) => items.reduce((acc, n) => oldest ? Math.min(acc, n.updatedAt || 0) : Math.max(acc, n.updatedAt || 0), oldest ? Infinity : 0);
  const rest = [...groups.keys()].filter(g => !pinnedGroups.includes(g)).sort((a, b) => {
    if (a === 'Ungrouped') return 1; if (b === 'Ungrouped') return -1;
    if (homeSort === 'az') return a.localeCompare(b);
    if (homeSort === 'za') return b.localeCompare(a);
    const ta = repTime(groups.get(a), homeSort === 'oldest'), tb = repTime(groups.get(b), homeSort === 'oldest');
    return homeSort === 'oldest' ? ta - tb : tb - ta;
  });
  const groupNames = [...pinnedGroups.filter(g => groups.has(g)), ...rest];

  groupNames.forEach(g => {
    const items = sortNotes(groups.get(g), homeSort);
    const pinned = pinnedGroups.includes(g);
    const header = document.createElement('div');
    header.className = 'note-group-header';
    const expanded = !!term || homeFolderFilter !== 'all' || expandedProjectGroups.has(g);
    const collapsed = !expanded;
    header.innerHTML = `
      <svg class="note-group-chevron ${collapsed ? 'collapsed' : ''}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      <span class="note-group-name">${gsEscape(g)}</span>
      <span class="note-group-count">${items.length}</span>
      <button class="note-group-btn fav-btn ${isFav('group', g) ? 'active' : ''}" title="Favourite folder" onclick="toggleFav(event,'group','${g.replace(/'/g, "\\'")}')">${STAR_SVG(isFav('group', g))}</button>
      <button class="note-group-btn pin-btn ${pinned ? 'active' : ''}" title="${pinned ? 'Unpin' : 'Pin'} folder" onclick="event.stopPropagation(); togglePinGroup('${g.replace(/'/g, "\\'")}')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-1.5-4.5V5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7.5L5 17z"></path></svg>
      </button>
    `;
    header.onclick = () => {
      if (expandedProjectGroups.has(g)) expandedProjectGroups.delete(g);
      else expandedProjectGroups.add(g);
      saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
      renderHomeGrid(searchTerm);
    };
    header.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCollegeContextMenu('project-folder', g, e.clientX, e.clientY);
    };
    homeGrid.appendChild(header);
    if (collapsed) return;
    items.forEach(note => homeGrid.appendChild(makeNoteCard(note)));
  });
}

// Create New Note
function createNote(title = '', body = '') {
  const newNote = {
    id: Date.now().toString(),
    title,
    body,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  notes.push(newNote);
  saveNotes();
  
  setActiveNote(newNote.id);
  noteTitleInput.focus();
}

// Delete Note
function deleteNote() {
  if (!activeNoteId) return;
  notes = notes.filter(n => n.id !== activeNoteId);
  archivedNoteIds.delete(activeNoteId);
  saveArchivedNoteIds();
  saveNotes();
  const nextNote = notes.find(n => !isNoteArchived(n));
  if (nextNote) {
    setActiveNote(nextNote.id);
  } else {
    setActiveNote(null);
  }
}

// Update Note Content
function updateNoteContent() {
  if (!activeNoteId) return;
  const note = notes.find(n => n.id === activeNoteId);
  if (note) {
    note.title = noteTitleInput.value;
    if (noteBodyInput) {
      note.body = noteBodyInput.innerHTML;
    }
    note.updatedAt = Date.now();
    
    saveNotes();
    renderNotesList(searchInput.value);
    showSaveIndicator();
  }
}

// Show Save Indicator
function showSaveIndicator() {
  if (!saveIndicator) return;
  saveIndicator.classList.add('show');
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveIndicator.classList.remove('show');
  }, 1500);
}

// Export Note
function exportNote() {
  if (!activeNoteId) return;
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) return;
  
  const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : '';
  const content = `${note.title || 'Untitled Note'}\n\n${plainText}`;
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(note.title || 'Untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// WYSIWYG Markdown Formatting
function handleMarkdownShortcuts(e) {
  if (e.key === ' ') {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const node = selection.focusNode;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const offset = selection.focusOffset;
      const textBefore = text.substring(0, offset);
      
      let format = null;
      let charsToDelete = 0;
      
      if (textBefore === '# ' || textBefore === '#\u00A0') { format = 'H1'; charsToDelete = 2; }
      else if (textBefore === '## ' || textBefore === '##\u00A0') { format = 'H2'; charsToDelete = 3; }
      else if (textBefore === '### ' || textBefore === '###\u00A0') { format = 'H3'; charsToDelete = 4; }
      else if (textBefore === '> ' || textBefore === '>\u00A0') { format = 'BLOCKQUOTE'; charsToDelete = 2; }
      else if (textBefore === '- ' || textBefore === '-\u00A0') { format = 'InsertUnorderedList'; charsToDelete = 2; }
      
      if (format) {
        // 1. Format the block FIRST so it works perfectly even if the document was empty
        if (format === 'InsertUnorderedList') {
          document.execCommand(format, false, null);
        } else {
          document.execCommand('formatBlock', false, format);
          
          const focusNode = selection.focusNode;
          const parent = focusNode && focusNode.nodeType === 3 ? focusNode.parentNode : focusNode;
          if (parent && parent.tagName !== format) {
            document.execCommand('formatBlock', false, `<${format}>`);
          }
        }
        
        // 2. Select the trigger characters and delete natively
        // execCommand preserves the node and selection offset
        const newFocus = selection.focusNode;
        if (newFocus && newFocus.nodeType === Node.TEXT_NODE) {
          const currentOffset = selection.focusOffset;
          if (currentOffset >= charsToDelete) {
            const range = document.createRange();
            range.setStart(newFocus, currentOffset - charsToDelete);
            range.setEnd(newFocus, currentOffset);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('delete', false, null);
          }
        }
        
        // Ensure focus is retained
        noteBodyInput.focus();
        updateNoteContent();
      }
    }
  }
}

// Wiki Linking Logic
function getCaretCoordinates() {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return { top: 0, left: 0 };
  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(false);
  const rect = range.getBoundingClientRect();
  
  const editorRect = editorContent.getBoundingClientRect();
  return {
    top: rect.bottom - editorRect.top + editorContent.scrollTop,
    left: rect.left - editorRect.left + editorContent.scrollLeft
  };
}

function handleLinkingInput() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const node = selection.focusNode;
  
  if (node.nodeType !== Node.TEXT_NODE) {
    closeLinkDropdown();
    return;
  }
  
  const text = node.textContent;
  const cursor = selection.focusOffset;
  
  if (text.substring(cursor - 2, cursor) === '[[') {
    isLinking = true;
    linkStartIndex = cursor;
    selectedLinkIndex = 0;
    
    const coords = getCaretCoordinates();
    linkDropdown.style.top = coords.top + 'px';
    linkDropdown.style.left = coords.left + 'px';
    linkDropdown.classList.add('show');
    
    renderLinkDropdown('');
    return;
  }
  
  if (isLinking) {
    if (cursor < linkStartIndex || text.substring(linkStartIndex - 2, linkStartIndex) !== '[[') {
      closeLinkDropdown();
      return;
    }
    const query = text.substring(linkStartIndex, cursor);
    if (query.includes(']]') || query.includes('\n')) {
      closeLinkDropdown();
      return;
    }
    renderLinkDropdown(query);
  }
}

function renderLinkDropdown(query) {
  if (!linkDropdown) return;
  
  filteredLinks = notes.filter(n => 
    n.id !== activeNoteId && 
    (n.title || 'Untitled Note').toLowerCase().includes(query.toLowerCase())
  );
  
  if (filteredLinks.length === 0) {
    linkDropdown.innerHTML = '<li style="color: var(--text-secondary); cursor: default;">No notes found</li>';
    return;
  }
  
  linkDropdown.innerHTML = '';
  filteredLinks.forEach((n, index) => {
    const li = document.createElement('li');
    li.textContent = n.title || 'Untitled Note';
    if (index === selectedLinkIndex) li.classList.add('selected');
    
    li.onmousedown = (e) => {
      e.preventDefault();
      insertLink(n.title || 'Untitled Note', n.id);
    };
    
    linkDropdown.appendChild(li);
  });
}

function insertLink(title, targetId) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const node = selection.focusNode;
  
  const linkHtml = `<span class="note-link" contenteditable="false" data-id="${targetId}">${title}</span>&nbsp;`;
  
  const range = selection.getRangeAt(0);
  range.setStart(node, linkStartIndex - 2);
  range.setEnd(node, selection.focusOffset);
  range.deleteContents();
  
  const el = document.createElement('div');
  el.innerHTML = linkHtml;
  const frag = document.createDocumentFragment();
  let lastNode;
  while ((lastNode = el.firstChild)) {
    frag.appendChild(lastNode);
  }
  range.insertNode(frag);
  
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  
  closeLinkDropdown();
  updateNoteContent();
}

function closeLinkDropdown() {
  isLinking = false;
  linkStartIndex = -1;
  if (linkDropdown) linkDropdown.classList.remove('show');
}

function handleEditorKeydown(e) {
  handleLinkingKeydown(e);
  
  if (e.key === 'Enter' && !isLinking) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const node = selection.focusNode;
    const block = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    
    if (['H1', 'H2', 'H3', 'BLOCKQUOTE'].includes(block.tagName)) {
      if (block.textContent.trim() === '') {
        e.preventDefault();
        document.execCommand('formatBlock', false, 'DIV');
      }
    }
  }
}

function handleLinkingKeydown(e) {
  if (!isLinking) return;
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredLinks.length > 0) {
      selectedLinkIndex = (selectedLinkIndex + 1) % filteredLinks.length;
      renderLinkDropdown(window.getSelection().focusNode.textContent.substring(linkStartIndex, window.getSelection().focusOffset));
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredLinks.length > 0) {
      selectedLinkIndex = (selectedLinkIndex - 1 + filteredLinks.length) % filteredLinks.length;
      renderLinkDropdown(window.getSelection().focusNode.textContent.substring(linkStartIndex, window.getSelection().focusOffset));
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredLinks.length > 0) {
      insertLink(filteredLinks[selectedLinkIndex].title || 'Untitled Note', filteredLinks[selectedLinkIndex].id);
    } else {
      closeLinkDropdown();
    }
  } else if (e.key === 'Escape') {
    closeLinkDropdown();
  }
}

function reattachNoteBodyListeners() {
  noteBodyInput = document.getElementById('note-body');
  if (noteBodyInput) {
    noteBodyInput.classList.add('markdown-body');
    noteBodyInput.addEventListener('input', (e) => {
      updateNoteContent();
      handleLinkingInput();
    });
    noteBodyInput.addEventListener('keydown', handleEditorKeydown);
    noteBodyInput.addEventListener('keyup', handleMarkdownShortcuts);
  }
}

// Event Listeners
newNoteBtn.addEventListener('click', () => createNote());
newNoteBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  createProjectFolderWithFirstNote();
});
deleteNoteBtn.addEventListener('click', deleteNote);
if (exportNoteBtn) exportNoteBtn.addEventListener('click', exportNote);
noteTitleInput.addEventListener('input', updateNoteContent);

reattachNoteBodyListeners();

// Search
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderNotesList(e.target.value);
    });
  }
  
  if (homeSearchInput) {
    homeSearchInput.addEventListener('input', (e) => {
      renderHomeGrid(e.target.value);
    });
  }
  
  if (viewGridBtn) {
    viewGridBtn.addEventListener('click', () => {
      currentHomeView = 'grid';
      homeArchiveMode = false;
      showPanel('home-grid', 'nav-projects-btn');
      viewGridBtn.classList.add('active');
      renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
      if (graphAnimationFrame) cancelAnimationFrame(graphAnimationFrame);
    });
  }
  
  if (viewGraphBtn) {
    viewGraphBtn.addEventListener('click', () => {
      currentHomeView = 'graph';
      homeArchiveMode = false;
      showPanel('home-graph', 'nav-projects-btn');
      viewGraphBtn.classList.add('active');
      initGraph();
    });
  }

  if (viewArchivedBtn) {
    viewArchivedBtn.addEventListener('click', () => {
      currentHomeView = 'archived';
      homeArchiveMode = true;
      showPanel('home-grid', 'nav-projects-btn');
      viewArchivedBtn.classList.add('active');
      renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
      if (graphAnimationFrame) cancelAnimationFrame(graphAnimationFrame);
    });
  }

window.showPanel = function(panelId, btnId) {
  // Leaving the Session page? Stop the Safe Haven ambience so it doesn't play unseen.
  if (panelId !== 'home-session' && window.stopHaven) window.stopHaven();
  const dashboardBannerEl = document.getElementById('dashboard-banner');
  if (dashboardBannerEl) {
    if (panelId === 'home-grid' || panelId === 'home-graph') {
      dashboardBannerEl.classList.remove('expanded');
      dashboardBannerEl.classList.remove('thin');
    } else if (panelId === 'dashboard-expanded') {
      dashboardBannerEl.classList.add('expanded');
      dashboardBannerEl.classList.remove('thin');
    } else {
      dashboardBannerEl.classList.remove('expanded');
      dashboardBannerEl.classList.add('thin');
    }
  }

  const panels = ['home-grid', 'home-graph', 'home-tasks', 'home-session', 'home-settings', 'home-college', 'home-favourites'];
  panels.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = 'none';
  });
  
  if (panelId === 'home-grid') {
    if (typeof homeGrid !== 'undefined' && homeGrid) homeGrid.style.display = 'grid';
  } else if (panelId !== 'dashboard-expanded') {
    const activeEl = document.getElementById(panelId);
    if (activeEl) activeEl.style.display = 'flex';
  }

  const header = document.querySelector('.home-header');
  const controls = document.querySelector('.dashboard-controls');
  if (panelId === 'home-grid' || panelId === 'home-graph') {
    if (header) header.style.display = 'flex';
    if (controls) controls.style.display = 'flex';
  } else {
    if (header) header.style.display = 'none';
    if (controls) controls.style.display = 'none';
  }

  const navBtns = ['nav-dashboard-btn', 'nav-projects-btn', 'nav-tasks-btn', 'nav-session-btn', 'nav-settings-btn', 'nav-college-btn', 'nav-favourites-btn'];
  navBtns.forEach(b => {
    const el = document.getElementById(b);
    if (el) el.classList.remove('active');
  });

  const viewGridBtnEl = document.getElementById('view-grid-btn');
  const viewGraphBtnEl = document.getElementById('view-graph-btn');
  const viewArchivedBtnEl = document.getElementById('view-archived-btn');
  if (viewGridBtnEl) viewGridBtnEl.classList.remove('active');
  if (viewGraphBtnEl) viewGraphBtnEl.classList.remove('active');
  if (viewArchivedBtnEl) viewArchivedBtnEl.classList.remove('active');

  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }
};

// Unified "Back" target for every panel — returns to the Projects/dashboard grid
window.goToDashboard = function() {
  currentHomeView = 'grid';
  homeArchiveMode = false;
  setActiveNote(null);
  showPanel('home-grid', 'nav-projects-btn');
  const g = document.getElementById('view-grid-btn');
  if (g) g.classList.add('active');
  renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
};

window.toggleDashboardBanner = function(e) {
  if (e && e.target.closest('.edit-banner-btn')) return; // Ignore if clicking edit button
  
  const dashboardBannerEl = document.getElementById('dashboard-banner');
  if (dashboardBannerEl) {
    const isExpanded = dashboardBannerEl.classList.contains('expanded');
    if (isExpanded && e) return;
    showPanel('dashboard-expanded', 'nav-dashboard-btn');
  }
};

window.showInnerTaskTab = function(tabId) {
  const tabs = ['todo', 'habits', 'goals', 'books', 'projects'];
  tabs.forEach(t => {
    const el = document.getElementById(`inner-tab-${t}`);
    if (el) el.style.display = 'none';
    const nav = document.getElementById(`inner-nav-${t}`);
    if (nav) nav.classList.remove('active');
  });
  
  const activeEl = document.getElementById(`inner-tab-${tabId}`);
  if (activeEl) activeEl.style.display = 'flex';
  
  const activeNav = document.getElementById(`inner-nav-${tabId}`);
  if (activeNav) activeNav.classList.add('active');

  if (tabId === 'projects') {
    renderProjectCalendar();
  }
};

// -----------------------------------------
// Project Tracker Logic
// -----------------------------------------
let currentProjectCalendarDate = new Date();

window.openProjectNote = function(noteId) {
  setActiveNote(noteId);
};

function renderProjectCalendar() {
  const calendarGrid = document.getElementById('project-calendar-grid');
  const monthNameEl = document.getElementById('project-current-month-name');
  if (!calendarGrid) return;
  
  calendarGrid.innerHTML = '';
  
  const year = currentProjectCalendarDate.getFullYear();
  const month = currentProjectCalendarDate.getMonth();
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (monthNameEl) {
    monthNameEl.textContent = `${monthNames[month]} ${year}`;
  }
  
  const firstDay = new Date(year, month, 1).getDay(); // Sunday is 0, Monday is 1, etc.
  let startOffset = firstDay;
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDateNum = today.getDate();
  
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'project-calendar-cell';
    
    if (i < startOffset) {
      // Prev month days
      cell.classList.add('inactive');
      const dateNum = daysInPrevMonth - startOffset + i + 1;
      cell.innerHTML = `<div class="date-num">${dateNum}</div>`;
    } else if (i >= startOffset + daysInMonth) {
      // Next month days
      cell.classList.add('inactive');
      const dateNum = i - (startOffset + daysInMonth) + 1;
      cell.innerHTML = `<div class="date-num">${dateNum}</div>`;
    } else {
      // Current month days
      const dateNum = i - startOffset + 1;
      
      if (isCurrentMonth && dateNum === todayDateNum) {
        cell.classList.add('today');
      }
      
      // Filter projects/notes created on this date
      const dayNotes = notes.filter(note => {
        const created = new Date(note.createdAt);
        return created.getFullYear() === year && 
               created.getMonth() === month && 
               created.getDate() === dateNum;
      });
      dayNotes.sort((a, b) => b.createdAt - a.createdAt);
      
      let projectsHtml = '';
      if (dayNotes.length > 0) {
        projectsHtml = `<div class="project-items-container">`;
        
        // Show only the latest 1 project created on this date
        const note = dayNotes[0];
        const createdDate = new Date(note.createdAt);
        const dateStr = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '').trim() : '';
        const preview = plainText.length > 25 ? plainText.substring(0, 25) + '...' : plainText;
        
        projectsHtml += `
          <div class="project-calendar-item" onclick="event.stopPropagation(); window.openProjectNote('${note.id}')" title="${note.title || 'Untitled Note'}">
            <div class="project-calendar-item-header">
              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <span class="project-item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600;">${note.title || 'Untitled'}</span>
            </div>
            <div class="project-calendar-item-date">${dateStr}</div>
            ${preview ? `<div class="project-calendar-item-preview">${preview}</div>` : ''}
          </div>
        `;
        
        if (dayNotes.length > 1) {
          projectsHtml += `
            <div class="project-more-badge" style="font-size: 0.7rem; font-weight: 600; color: var(--accent-color); padding: 2px 6px; background: var(--overlay-light); border-radius: 4px; align-self: flex-start; margin-top: 4px;">
              + ${dayNotes.length - 1} more
            </div>
          `;
        }
        
        projectsHtml += `</div>`;
      }
      
      cell.innerHTML = `
        <div class="date-num">${dateNum}</div>
        ${projectsHtml}
      `;
      
      if (dayNotes.length > 0) {
        cell.style.cursor = 'pointer';
        cell.onclick = () => {
          openProjectDayModal(dayNotes, `${monthNames[month]} ${dateNum}, ${year}`);
        };
      }
    }
    
    calendarGrid.appendChild(cell);
  }
}

function openProjectDayModal(dayNotes, dateStr) {
  const modal = document.getElementById('project-day-modal');
  const titleEl = document.getElementById('project-day-modal-title');
  const listEl = document.getElementById('project-day-modal-list');
  if (!modal || !titleEl || !listEl) return;
  
  titleEl.textContent = `Projects on ${dateStr}`;
  listEl.innerHTML = '';
  
  dayNotes.forEach(note => {
    const createdDate = new Date(note.createdAt);
    const dateStrFormatted = createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '').trim() : '';
    const preview = plainText.length > 50 ? plainText.substring(0, 50) + '...' : plainText;
    
    const item = document.createElement('div');
    item.className = 'project-calendar-item';
    item.style.padding = '12px 16px';
    item.style.borderRadius = '12px';
    item.onclick = () => {
      modal.style.display = 'none';
      window.openProjectNote(note.id);
    };
    
    item.innerHTML = `
      <div class="project-calendar-item-header" style="font-size: 0.95rem; margin-bottom: 4px;">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <span class="project-item-title" style="font-weight: 700; color: var(--text-primary);">${note.title || 'Untitled'}</span>
      </div>
      <div class="project-calendar-item-date" style="font-size: 0.75rem; margin-bottom: 6px;">Created: ${dateStrFormatted}</div>
      ${preview ? `<div class="project-calendar-item-preview" style="font-size: 0.75rem; line-height: 1.3;">${preview}</div>` : ''}
    `;
    listEl.appendChild(item);
  });
  
  modal.style.display = 'flex';
}

// -----------------------------------------
// Tasks Panel Logic
// -----------------------------------------
let calendarTasks = JSON.parse(localStorage.getItem('opennotes_calendar_tasks')) || [];
let activeDateIndex = 20;

window.toggleTasksPanel = function() {
  showPanel('home-tasks', 'nav-tasks-btn');
  showInnerTaskTab('todo'); // Default inner tab
  renderCalendar();
  renderTasks();
};

let currentCalendarDate = new Date();

window.renderCalendar = function() {
  const calendarGrid = document.getElementById('calendar-grid');
  const monthNameEl = document.getElementById('current-month-name');
  const searchInput = document.getElementById('calendar-search-input');
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  if (!calendarGrid) return;
  
  calendarGrid.innerHTML = '';
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  if (monthNameEl) {
    monthNameEl.textContent = `${monthNames[month]} ${year}`;
  }
  
  const firstDay = new Date(year, month, 1).getDay();
  // Adjust for Monday start (0=Sun, 1=Mon, ..., 6=Sat) -> (0=Mon, 1=Tue, ..., 6=Sun)
  let startOffset = firstDay === 0 ? 6 : firstDay - 1;
  
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const todayDateNum = today.getDate();
  
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  
  for(let i = 0; i < totalCells; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-cell';
    
    if (i < startOffset) {
      // Prev month days
      cell.classList.add('inactive');
      cell.innerHTML = `<div class="date-num">${daysInPrevMonth - startOffset + i + 1}</div>`;
      if (query) cell.style.opacity = '0.1';
    } else if (i >= startOffset + daysInMonth) {
      // Next month days
      cell.classList.add('inactive');
      cell.innerHTML = `<div class="date-num">${i - (startOffset + daysInMonth) + 1}</div>`;
      if (query) cell.style.opacity = '0.1';
    } else {
      // Current month days
      const dateNum = i - startOffset + 1;
      
      if (isCurrentMonth && dateNum === todayDateNum) {
        cell.classList.add('today');
      } else if (dateNum === activeDateIndex && !isCurrentMonth) {
        cell.classList.add('today');
      }
      
      // Filter tasks for this date/month/year
      let dayTasks = calendarTasks.filter(t => t.date === dateNum && (t.month === undefined || (t.month === month && t.year === year)));
      
      if (query) {
        dayTasks = dayTasks.filter(t => t.event.toLowerCase().includes(query));
        if (dayTasks.length === 0) {
          cell.style.opacity = '0.15';
          cell.style.filter = 'grayscale(1)';
        } else {
          // Highlight matching cells if there's a query
          cell.style.boxShadow = '0 0 15px var(--accent-color)';
        }
      }
      
      let eventsHtml = '';
      if (dayTasks.length > 0) {
        eventsHtml = `<div class="event">${dayTasks[dayTasks.length - 1].event}</div>`;
      }
      
      cell.innerHTML = `
        <div class="date-num">${dateNum}</div>
        ${eventsHtml}
      `;
      
      cell.onclick = () => {
        activeDateIndex = dateNum;
        document.querySelectorAll('.calendar-cell').forEach(c => {
          const cellDateNum = parseInt(c.querySelector('.date-num')?.innerText || '0');
          if (isCurrentMonth && cellDateNum === todayDateNum && !c.classList.contains('inactive')) {
            c.classList.add('today');
          } else {
            c.classList.remove('today');
          }
        });
        cell.classList.add('today');
        openDayView(year, month, dateNum);
      };
    }
    
    calendarGrid.appendChild(cell);
  }
}

function openDayView(year, month, date) {
  document.getElementById('calendar-month-view').style.display = 'none';
  document.getElementById('calendar-day-view').style.display = 'flex';
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById('day-view-title').textContent = `${monthNames[month]} ${date}, ${year}`;
  
  renderDayEvents(year, month, date);
}

window.closeDayView = function() {
  document.getElementById('calendar-day-view').style.display = 'none';
  document.getElementById('calendar-month-view').style.display = 'block';
  renderCalendar();
};

function renderDayEvents(year, month, date) {
  const eventsListEl = document.getElementById('day-events-list');
  if (!eventsListEl) return;
  
  eventsListEl.innerHTML = '';
  
  let hasEvents = false;
  calendarTasks.forEach((task, index) => {
     if (task.date === date && (task.month === undefined || (task.month === month && task.year === year))) {
       hasEvents = true;
       const item = document.createElement('div');
       item.className = 'day-event-item';
       item.innerHTML = `
         <div class="day-event-text">${task.event}</div>
         <button class="task-delete" onclick="deleteCalendarEvent(${index}, ${year}, ${month}, ${date})" style="opacity: 1;">
           <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
         </button>
       `;
       eventsListEl.appendChild(item);
     }
  });
  
  if (!hasEvents) {
    eventsListEl.innerHTML = '<div style="color: #6b7280; text-align: center; margin-top: 20px; font-weight: 500;">No events for this day.</div>';
  }
}

window.deleteCalendarEvent = function(index, year, month, date) {
  calendarTasks.splice(index, 1);
  localStorage.setItem('opennotes_calendar_tasks', JSON.stringify(calendarTasks));
  renderDayEvents(year, month, date);
};

let tasks = JSON.parse(localStorage.getItem('opennotes_tasks')) || [];

function saveTasks() {
  localStorage.setItem('opennotes_tasks', JSON.stringify(tasks));
  renderTasks();
}

function renderTasks() {
  const tasksListEl = document.getElementById('tasks-list');
  const tasksCountEl = document.getElementById('tasks-count');
  if (!tasksListEl || !tasksCountEl) return;
  
  tasksListEl.innerHTML = '';
  
  let remaining = 0;
  tasks.forEach((task, index) => {
    if (!task.completed) remaining++;
    
    const item = document.createElement('div');
    item.className = 'task-item';
    
    item.innerHTML = `
      <div class="task-checkbox ${task.completed ? 'checked' : ''}" onclick="toggleTask(${index})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <div class="task-text ${task.completed ? 'completed' : ''}">${task.text}</div>
      <button class="task-delete" onclick="deleteTask(${index})">
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
    tasksListEl.appendChild(item);
  });
  
  tasksCountEl.textContent = `${remaining} Remaining`;
}

window.toggleTask = function(index) {
  if (tasks[index]) {
    tasks[index].completed = !tasks[index].completed;
    saveTasks();
  }
};

window.deleteTask = function(index) {
  if (tasks[index]) {
    tasks.splice(index, 1);
    saveTasks();
  }
};

// -----------------------------------------
// Habit Tracker Logic
// -----------------------------------------
let habits = JSON.parse(localStorage.getItem('opennotes_habits')) || [
  { text: 'Habit C', completed: false },
  { text: 'Habit A', completed: false },
  { text: 'Habit B', completed: false }
];

function saveHabits() {
  localStorage.setItem('opennotes_habits', JSON.stringify(habits));
  renderHabits();
}

renderHabits(); // Initial render on launch

function renderHabits() {
  const listEl = document.getElementById('habit-list');
  const progressText = document.getElementById('habit-progress-text');
  const progressFill = document.getElementById('habit-progress-fill');
  const habitDateEl = document.getElementById('habit-date');
  
  if (!listEl) return;
  listEl.innerHTML = '';
  
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const d = new Date();
  if (habitDateEl) {
    habitDateEl.textContent = `@${monthNames[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  
  let completedCount = 0;
  habits.forEach((habit, index) => {
    if (habit.completed) completedCount++;
    
    const item = document.createElement('div');
    item.className = 'habit-item';
    item.innerHTML = `
      <div class="habit-checkbox ${habit.completed ? 'checked' : ''}" onclick="toggleHabit(${index})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </div>
      <div class="habit-text" onclick="toggleHabit(${index})">${habit.text}</div>
      <button class="habit-delete" onclick="deleteHabit(${index})">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;
    listEl.appendChild(item);
  });
  
  const percentage = habits.length === 0 ? 0 : Math.round((completedCount / habits.length) * 100);
  
  if (progressText) progressText.textContent = `${percentage}%`;
  if (progressFill) progressFill.style.width = `${percentage}%`;
}

window.toggleHabit = function(index) {
  if (habits[index]) {
    habits[index].completed = !habits[index].completed;
    saveHabits();
  }
};

window.deleteHabit = function(index) {
  if (habits[index]) {
    habits.splice(index, 1);
    saveHabits();
  }
};

// -----------------------------------------
// Goals Tracker Logic
// -----------------------------------------
const defaultGoals = [
  {
    id: 'personal-dev',
    title: 'Personal Development',
    icon: '🌱',
    quote: 'Inspirational Quote',
    className: 'personal-dev',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  },
  {
    id: 'career',
    title: 'Career and/or Academic Growth',
    icon: '📚',
    quote: 'Inspirational Quote',
    className: 'career',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  },
  {
    id: 'health',
    title: 'Health & Wellness',
    icon: '💪',
    quote: 'Inspirational Quote',
    className: 'health',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  },
  {
    id: 'financial',
    title: 'Financial Goals',
    icon: '💰',
    quote: 'Inspirational Quote',
    className: 'financial',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  },
  {
    id: 'relationships',
    title: 'Relationships',
    icon: '❤️',
    quote: 'Inspirational Quote',
    className: 'relationships',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  },
  {
    id: 'travel',
    title: 'Travel & Adventure',
    icon: '✈️',
    quote: 'Inspirational Quote',
    className: 'travel',
    items: [
      { text: 'Goal 1', completed: false },
      { text: 'Goal 2', completed: false },
      { text: 'Goal 3', completed: false }
    ]
  }
];

let goalsData = JSON.parse(localStorage.getItem('opennotes_goals')) || defaultGoals;

function saveGoals() {
  localStorage.setItem('opennotes_goals', JSON.stringify(goalsData));
  renderGoals();
}

function renderGoals() {
  const listEl = document.getElementById('goals-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  goalsData.forEach((category, catIndex) => {
    const catDiv = document.createElement('div');
    catDiv.className = 'goal-category-container';
    
    let itemsHtml = '';
    category.items.forEach((item, itemIndex) => {
      itemsHtml += `
        <div class="goal-item ${item.completed ? 'completed' : ''}">
          <div class="goal-checkbox" onclick="toggleGoal(${catIndex}, ${itemIndex})">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <span class="goal-text" contenteditable="true" onblur="updateGoalText(${catIndex}, ${itemIndex}, this.innerText)" onkeydown="if(event.key==='Enter'){this.blur(); event.preventDefault();}">${item.text}</span>
        </div>
      `;
    });
    
    catDiv.innerHTML = `
      <h4 class="goal-category-title">${category.title}</h4>
      <div class="goal-card ${category.className}">
        <div class="goal-quote">
          <span>${category.icon}</span>
          <span class="editable-quote" contenteditable="true" onblur="updateGoalQuote(${catIndex}, this.innerText)" onkeydown="if(event.key==='Enter'){this.blur(); event.preventDefault();}">${category.quote}</span>
        </div>
        <div class="goal-items">
          ${itemsHtml}
        </div>
      </div>
    `;
    listEl.appendChild(catDiv);
  });
}

window.toggleGoal = function(catIndex, itemIndex) {
  goalsData[catIndex].items[itemIndex].completed = !goalsData[catIndex].items[itemIndex].completed;
  saveGoals();
};

window.updateGoalText = function(catIndex, itemIndex, newText) {
  goalsData[catIndex].items[itemIndex].text = newText;
  saveGoals();
};

window.updateGoalQuote = function(catIndex, newQuote) {
  goalsData[catIndex].quote = newQuote;
  saveGoals();
};

renderGoals(); // Initial render on launch

// -----------------------------------------
// Book Tracker Logic
// -----------------------------------------
let books = JSON.parse(localStorage.getItem('opennotes_books')) || [];
let editingBookIndex = -1;

function saveBooks() {
  localStorage.setItem('opennotes_books', JSON.stringify(books));
  renderBooks();
}

renderBooks(); // Initial render on launch

function renderBooks() {
  const listEl = document.getElementById('books-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  
  if (books.length === 0) {
    listEl.innerHTML = '<p style="color: #6b7280; font-size: 0.95rem;">No books in your library. Add one to start tracking!</p>';
    return;
  }
  
  books.forEach((book, index) => {
    const card = document.createElement('div');
    card.className = 'book-card';
    
    let starsHtml = '';
    if (book.rating > 0) {
      starsHtml = '<div class="book-rating-display">';
      for(let i=0; i<5; i++) {
        starsHtml += i < book.rating ? '★' : '☆';
      }
      starsHtml += '</div>';
    }
    
    card.innerHTML = `
      <div class="book-cover">
        <img src="${book.cover || 'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?q=80&w=300&auto=format&fit=crop'}" alt="${book.title}" />
      </div>
      <div class="book-details">
        <h4 class="book-title">${book.title}</h4>
        <p class="book-author">${book.author}</p>
        ${starsHtml}
        <div class="book-progress-container">
          <span class="book-progress-text">${book.pagesRead || 0} / ${book.totalPages || 0}</span>
          <div class="book-progress-bar">
            <div class="book-progress-fill" style="width: ${book.progress || 0}%;"></div>
          </div>
        </div>
        ${book.review ? `<p class="book-review-text">"${book.review}"</p>` : ''}
      </div>
      <div class="book-card-actions">
        <button class="book-action-btn" onclick="editBook(${index})" title="Edit">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="book-action-btn delete" onclick="deleteBook(${index})" title="Delete">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

window.deleteBook = function(index) {
  if (confirm("Delete this book?")) {
    books.splice(index, 1);
    saveBooks();
  }
};

window.editBook = function(index) {
  editingBookIndex = index;
  const book = books[index];
  
  document.getElementById('book-title').value = book.title || '';
  document.getElementById('book-author').value = book.author || '';
  document.getElementById('book-cover').value = book.cover || '';
  document.getElementById('book-pages-read').value = book.pagesRead || 0;
  document.getElementById('book-total-pages').value = book.totalPages || 1;
  document.getElementById('book-review').value = book.review || '';
  
  setBookRating(book.rating || 0);
  
  document.getElementById('book-modal').style.display = 'flex';
};

window.setBookRating = function(rating) {
  const stars = document.querySelectorAll('#book-rating span');
  stars.forEach((star, idx) => {
    if (idx < rating) star.classList.add('active');
    else star.classList.remove('active');
  });
  document.getElementById('book-rating').dataset.rating = rating;
};

document.addEventListener('DOMContentLoaded', () => {
  const taskInput = document.getElementById('new-task-input');
  const addTodoBtn = document.getElementById('add-todo-btn');
  
  function addTodoTask() {
    if (!taskInput) return;
    const text = taskInput.value.trim();
    if (text) {
      tasks.unshift({ text, completed: false, id: Date.now() });
      taskInput.value = '';
      saveTasks();
      
      // Also add to calendar on current date
      const today = new Date();
      const tDate = today.getDate();
      const tMonth = today.getMonth();
      const tYear = today.getFullYear();
      
      calendarTasks.push({ date: tDate, month: tMonth, year: tYear, event: text });
      localStorage.setItem('opennotes_calendar_tasks', JSON.stringify(calendarTasks));
      
      if (typeof renderCalendar === 'function') {
        renderCalendar();
      }
      
      const dayView = document.getElementById('calendar-day-view');
      if (dayView && dayView.style.display !== 'none' && 
          currentCalendarDate.getFullYear() === tYear && 
          currentCalendarDate.getMonth() === tMonth && 
          activeDateIndex === tDate) {
        if (typeof renderDayEvents === 'function') {
          renderDayEvents(tYear, tMonth, tDate);
        }
      }
    }
  }
  
  if (addTodoBtn) addTodoBtn.addEventListener('click', addTodoTask);
  if (taskInput) {
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTodoTask();
    });
  }

  const habitInput = document.getElementById('new-habit-input');
  const addHabitBtn = document.getElementById('add-habit-btn');
  
  function addNewHabit() {
    if (!habitInput) return;
    const text = habitInput.value.trim();
    if (text) {
      habits.push({ text, completed: false });
      habitInput.value = '';
      saveHabits();
    }
  }
  
  if (addHabitBtn) addHabitBtn.addEventListener('click', addNewHabit);
  if (habitInput) {
    habitInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addNewHabit();
    });
  }
  
  // Banner Color Toggles
  const colorToggleWhite = document.getElementById('color-toggle-white');
  const colorToggleBlack = document.getElementById('color-toggle-black');
  
  if (colorToggleWhite) {
    colorToggleWhite.addEventListener('click', (e) => {
      e.stopPropagation();
      setBannerTextColor('white');
    });
  }
  
  if (colorToggleBlack) {
    colorToggleBlack.addEventListener('click', (e) => {
      e.stopPropagation();
      setBannerTextColor('black');
    });
  }
  
  // Calendar Nav
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  
  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
      renderCalendar();
    });
  }
  
  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
      renderCalendar();
    });
  }
  
  // Project Calendar Nav
  const projectPrevMonthBtn = document.getElementById('project-prev-month-btn');
  const projectNextMonthBtn = document.getElementById('project-next-month-btn');
  
  if (projectPrevMonthBtn) {
    projectPrevMonthBtn.addEventListener('click', () => {
      currentProjectCalendarDate.setMonth(currentProjectCalendarDate.getMonth() - 1);
      renderProjectCalendar();
    });
  }
  
  if (projectNextMonthBtn) {
    projectNextMonthBtn.addEventListener('click', () => {
      currentProjectCalendarDate.setMonth(currentProjectCalendarDate.getMonth() + 1);
      renderProjectCalendar();
    });
  }
  
  // Calendar Day View Actions
  const backToMonthBtn = document.getElementById('back-to-month-btn');
  if (backToMonthBtn) backToMonthBtn.addEventListener('click', closeDayView);
  
  const addEventBtn = document.getElementById('add-event-btn');
  const newEventInput = document.getElementById('new-event-input');
  
  function addDayEvent() {
    if (!newEventInput) return;
    const text = newEventInput.value.trim();
    if (text) {
      const year = currentCalendarDate.getFullYear();
      const month = currentCalendarDate.getMonth();
      calendarTasks.push({ date: activeDateIndex, month: month, year: year, event: text });
      localStorage.setItem('opennotes_calendar_tasks', JSON.stringify(calendarTasks));
      newEventInput.value = '';
      renderDayEvents(year, month, activeDateIndex);
    }
  }
  
  if (addEventBtn) addEventBtn.addEventListener('click', addDayEvent);
  if (newEventInput) {
    newEventInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addDayEvent();
    });
  }
  
  // Book Modal Handlers
  const bookModal = document.getElementById('book-modal');
  const openBookModalBtn = document.getElementById('add-book-btn');
  const closeBookModalBtn = document.getElementById('close-book-modal');
  const saveBookBtn = document.getElementById('save-book-btn');
  const ratingStars = document.querySelectorAll('#book-rating span');
  
  if (ratingStars) {
    ratingStars.forEach(star => {
      star.addEventListener('click', (e) => {
        const rating = parseInt(e.target.dataset.val);
        setBookRating(rating);
      });
    });
  }
  
  if (openBookModalBtn) {
    openBookModalBtn.addEventListener('click', () => {
      editingBookIndex = -1;
      document.getElementById('book-title').value = '';
      document.getElementById('book-author').value = '';
      document.getElementById('book-cover').value = '';
      document.getElementById('book-pages-read').value = '';
      document.getElementById('book-total-pages').value = '';
      document.getElementById('book-review').value = '';
      setBookRating(0);
      if(bookModal) bookModal.style.display = 'flex';
    });
  }
  
  if (closeBookModalBtn) closeBookModalBtn.addEventListener('click', () => {
    if(bookModal) bookModal.style.display = 'none';
  });
  
  const closeProjectDayModalBtn = document.getElementById('close-project-day-modal');
  if (closeProjectDayModalBtn) {
    closeProjectDayModalBtn.addEventListener('click', () => {
      const modal = document.getElementById('project-day-modal');
      if (modal) modal.style.display = 'none';
    });
  }
  
  if (saveBookBtn) {
    saveBookBtn.addEventListener('click', () => {
      const title = document.getElementById('book-title').value.trim();
      const author = document.getElementById('book-author').value.trim();
      const cover = document.getElementById('book-cover').value.trim();
      let pagesRead = parseInt(document.getElementById('book-pages-read').value);
      let totalPages = parseInt(document.getElementById('book-total-pages').value);
      const review = document.getElementById('book-review').value.trim();
      const rating = parseInt(document.getElementById('book-rating').dataset.rating || 0);
      
      if (!title) {
        alert("Please enter a title.");
        return;
      }
      
      if (isNaN(pagesRead) || pagesRead < 0) pagesRead = 0;
      if (isNaN(totalPages) || totalPages < 1) totalPages = 1;
      if (pagesRead > totalPages) pagesRead = totalPages;
      
      const progress = Math.round((pagesRead / totalPages) * 100);
      
      const bookData = { title, author, cover, pagesRead, totalPages, progress, review, rating };
      
      if (editingBookIndex > -1) {
        books[editingBookIndex] = bookData;
      } else {
        books.push(bookData);
      }
      
      saveBooks();
      if(bookModal) bookModal.style.display = 'none';
    });
  }
});

// -----------------------------------------
// Floating Toolbar
// -----------------------------------------
document.addEventListener('selectionchange', () => {
  if (!activeNoteId || !floatingToolbar) return;
  if (currentHomeView === 'graph' && homePage.style.display === 'flex') {
    hideToolbar();
    return;
  }

  const selection = window.getSelection();
  if (selection.isCollapsed || !selection.rangeCount) {
    hideToolbar();
    return;
  }

  if (!noteBodyInput || !noteBodyInput.contains(selection.focusNode)) {
    hideToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  if (range.toString().trim() === '') {
    hideToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  const editorArea = document.querySelector('.editor-area');
  const editorRect = editorArea.getBoundingClientRect();

  // Position toolbar 44px above selection
  let top = rect.top - editorRect.top - 44;
  
  // If too close to the top, position it below the text instead
  if (top < 10) {
    top = rect.bottom - editorRect.top + 10;
  }
  
  // Center horizontally over selection
  let left = rect.left - editorRect.left + (rect.width / 2);
  
  // Clamp horizontal position so it doesn't overflow editor boundaries
  // Approximate toolbar width is ~300px
  const toolbarWidth = floatingToolbar.offsetWidth || 290;
  const minLeft = (toolbarWidth / 2) + 16;
  const maxLeft = editorRect.width - (toolbarWidth / 2) - 16;
  
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  floatingToolbar.style.top = `${top}px`;
  floatingToolbar.style.left = `${left}px`;
  floatingToolbar.style.transform = `translateX(-50%)`;
  floatingToolbar.classList.add('show');
});

function hideToolbar() {
  if (floatingToolbar) {
    floatingToolbar.classList.remove('show');
    floatingToolbar.style.transform = `translateX(-50%) translateY(8px)`;
  }
}

if (floatingToolbar) {
  floatingToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevents selection from being lost when clicking
      
      const command = btn.dataset.command;
      const value = btn.dataset.value || null;
      
      if (command === 'hiliteColor') {
        if (!document.execCommand('hiliteColor', false, value)) {
          document.execCommand('backColor', false, value);
        }
      } else if (command === 'foreColor' && value === 'reset') {
        // "Default Text" resolves to the current theme's text color so it stays
        // readable in both light and dark mode.
        const themeColor = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#4a3c31';
        document.execCommand('foreColor', false, themeColor);
      } else {
        document.execCommand(command, false, value);
      }

      updateNoteContent();
    });
  });
}

// Start app
init();

// -----------------------------------------
// Interactive Graph View Physics Engine
// -----------------------------------------
let graphAnimationFrame;
function initGraph() {
  if (!graphCanvas) return;
  const ctx = graphCanvas.getContext('2d');

  // Theme-aware colors (resolved once per open)
  const _css = getComputedStyle(document.body);
  const GC = {
    bg: (_css.getPropertyValue('--bg-color') || '#12100e').trim(),
    node: (_css.getPropertyValue('--accent-color') || '#a87b51').trim(),
    stroke: (_css.getPropertyValue('--accent-hover') || '#8e623a').trim(),
    text: (_css.getPropertyValue('--text-primary') || '#4a3c31').trim(),
    edge: (_css.getPropertyValue('--accent-color') || '#a87b51').trim()
  };
  const hexToRgb = (h) => {
    const m = h.replace('#', '');
    const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const int = parseInt(n, 16);
    return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
  };
  const edgeRgb = GC.edge.startsWith('#') ? hexToRgb(GC.edge) : '168, 123, 81';

  const rect = homeGraph.getBoundingClientRect();
  // The panel can still be display:none/zero-sized for a frame when switching
  // views — initialising a 0-sized world pins every node into a corner (the
  // "glitched blob"). Wait for real dimensions instead.
  if (rect.width < 50 || rect.height < 50) {
    initGraph._retries = (initGraph._retries || 0) + 1;
    if (initGraph._retries < 30) requestAnimationFrame(initGraph);
    return;
  }
  initGraph._retries = 0;
  // Render at devicePixelRatio so nodes/labels are crisp, not blurry
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let cssW = rect.width, cssH = rect.height;
  graphCanvas.width = Math.round(cssW * dpr);
  graphCanvas.height = Math.round(cssH * dpr);
  graphCanvas.style.width = cssW + 'px';
  graphCanvas.style.height = cssH + 'px';
  const graphNotes = notes.filter(note => !isNoteArchived(note));
  
  // Give the layout a world larger than the viewport when there are many notes so
  // they spread out instead of packing into a cluttered blob; the view then
  // auto-fits (zooms out) to frame everything.
  const spread = Math.min(2.2, Math.max(1, Math.sqrt(graphNotes.length) / 5));
  const worldW = rect.width * spread, worldH = rect.height * spread;
  const cx = worldW / 2, cy = worldH / 2;
  const gNodes = graphNotes.map(n => ({
    id: n.id,
    title: n.title || 'Untitled',
    // spread across the world so the layout starts open, not collapsed in a ball
    x: cx + (Math.random() - 0.5) * worldW * 0.45,
    y: cy + (Math.random() - 0.5) * worldH * 0.45,
    vx: 0,
    vy: 0,
    radius: 14
  }));
  
  const gEdges = [];
  graphNotes.forEach(n => {
    if (!n.body) return;
    const regex = /data-id="([^"]+)"/g;
    let match;
    while ((match = regex.exec(n.body)) !== null) {
      if (gNodes.find(node => node.id === match[1])) {
        gEdges.push({ source: n.id, target: match[1] });
      }
    }
  });

  gNodes.forEach(node => {
    const connections = gEdges.filter(e => e.source === node.id || e.target === node.id).length;
    node.radius = 8 + Math.min(connections * 2, 10);
  });

  // Scale forces to node count. With many notes: smaller nodes, stronger repulsion and
  // weaker centering so they spread into readable clusters (the view auto-fits to frame them).
  const many = gNodes.length > 25;
  const repelDist = many ? 220 : 250;
  const repelForce = many ? 1.4 : 1.2;
  const linkDist = many ? 110 : 150;
  const linkForce = many ? 0.045 : 0.08;
  const centerForce = many ? 0.02 : 0.03;
  const friction = 0.85;
  
  let draggedNode = null;
  let hoveredNode = null;

  // View transform: nodes live in "world" space (canvas size at scale 1); pan/zoom
  // only affect how the world is drawn. screen = world * scale + pan.
  let scale = 1, panX = 0, panY = 0;
  let panning = false, panStart = null;
  let userAdjusted = false; // once the user pans/zooms/drags, stop auto-fitting
  let lastEnergy = Infinity; // physics settles → freeze integration (no micro-jitter)
  let labelsOn = false, labelFade = 0; // hysteresis + fade so labels never flicker

  // Keep the canvas matched to the panel if the window resizes while open
  if (window.__graphRO) { try { window.__graphRO.disconnect(); } catch (_) {} }
  window.__graphRO = new ResizeObserver(() => {
    const r = homeGraph.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    cssW = r.width; cssH = r.height;
    graphCanvas.width = Math.round(cssW * dpr);
    graphCanvas.height = Math.round(cssH * dpr);
    graphCanvas.style.width = cssW + 'px';
    graphCanvas.style.height = cssH + 'px';
    lastEnergy = Infinity; // let the auto-fit reframe for the new size
  });
  window.__graphRO.observe(homeGraph);
  const screenXY = (e) => { const r = graphCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toWorld = (sx, sy) => [(sx - panX) / scale, (sy - panY) / scale];
  const nodeAt = (wx, wy) => {
    for (let i = gNodes.length - 1; i >= 0; i--) {
      const n = gNodes[i];
      const dx = wx - n.x, dy = wy - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius) return n;
    }
    return null;
  };

  graphCanvas.onmousedown = (e) => {
    const [sx, sy] = screenXY(e);
    const [wx, wy] = toWorld(sx, sy);
    const hit = nodeAt(wx, wy);
    if (hit) { draggedNode = hit; hoveredNode = hit; userAdjusted = true; }
    else { panning = true; panStart = { sx, sy, panX, panY }; graphCanvas.style.cursor = 'grabbing'; userAdjusted = true; }
  };

  graphCanvas.onmousemove = (e) => {
    const [sx, sy] = screenXY(e);
    if (draggedNode) {
      const [wx, wy] = toWorld(sx, sy);
      draggedNode.x = wx; draggedNode.y = wy; draggedNode.vx = 0; draggedNode.vy = 0;
      return;
    }
    if (panning) { panX = panStart.panX + (sx - panStart.sx); panY = panStart.panY + (sy - panStart.sy); return; }
    const [wx, wy] = toWorld(sx, sy);
    hoveredNode = nodeAt(wx, wy);
    graphCanvas.style.cursor = hoveredNode ? 'grab' : 'move';
  };

  window.addEventListener('mouseup', () => { draggedNode = null; panning = false; });

  // Wheel to zoom toward the cursor
  graphCanvas.onwheel = (e) => {
    e.preventDefault();
    const [sx, sy] = screenXY(e);
    userAdjusted = true;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.max(0.25, Math.min(4, scale * factor));
    // keep the world point under the cursor fixed
    panX = sx - ((sx - panX) * (newScale / scale));
    panY = sy - ((sy - panY) * (newScale / scale));
    scale = newScale;
  };

  graphCanvas.ondblclick = (e) => {
    const [sx, sy] = screenXY(e);
    const hit = nodeAt(...toWorld(sx, sy));
    if (hit) setActiveNote(hit.id);
  };

  if (graphAnimationFrame) cancelAnimationFrame(graphAnimationFrame);

  function draw() {
    // clear in device space, then draw the world under the pan/zoom transform (dpr-aware)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * panX, dpr * panY);

    // Once the layout settles, freeze the physics entirely — no perpetual
    // micro-jitter. Dragging a node injects energy and wakes it back up.
    const frozen = !draggedNode && lastEnergy < Math.max(2, gNodes.length * 0.05);

    if (!frozen) {
      for (let i = 0; i < gNodes.length; i++) {
        for (let j = i + 1; j < gNodes.length; j++) {
          let dx = gNodes[i].x - gNodes[j].x;
          let dy = gNodes[i].y - gNodes[j].y;
          let dist = Math.sqrt(dx*dx + dy*dy) || 1;
          if (dist < repelDist) {
            let force = (repelDist - dist) / repelDist * repelForce;
            let fx = (dx / dist) * force;
            let fy = (dy / dist) * force;
            if (draggedNode !== gNodes[i]) { gNodes[i].vx += fx; gNodes[i].vy += fy; }
            if (draggedNode !== gNodes[j]) { gNodes[j].vx -= fx; gNodes[j].vy -= fy; }
          }
        }
      }

      gEdges.forEach(edge => {
        let s = gNodes.find(n => n.id === edge.source);
        let t = gNodes.find(n => n.id === edge.target);
        if (!s || !t) return;
        let dx = t.x - s.x;
        let dy = t.y - s.y;
        let dist = Math.sqrt(dx*dx + dy*dy) || 1;
        let force = (dist - linkDist) * linkForce;
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;
        if (draggedNode !== s) { s.vx += fx; s.vy += fy; }
        if (draggedNode !== t) { t.vx -= fx; t.vy -= fy; }
      });

      let energy = 0;
      gNodes.forEach(n => {
        if (n !== draggedNode) {
          n.vx += (cx - n.x) * centerForce;
          n.vy += (cy - n.y) * centerForce;
          n.x += n.vx;
          n.y += n.vy;
          n.vx *= friction;
          n.vy *= friction;
        }
        // Keep every node inside the world so nothing flies off
        const pad = n.radius + 24;
        if (n.x < pad) { n.x = pad; n.vx *= -0.5; }
        if (n.x > worldW - pad) { n.x = worldW - pad; n.vx *= -0.5; }
        if (n.y < pad) { n.y = pad; n.vy *= -0.5; }
        if (n.y > worldH - pad) { n.y = worldH - pad; n.vy *= -0.5; }
        energy += Math.abs(n.vx) + Math.abs(n.vy);
      });
      lastEnergy = energy;
    }

    // Auto-fit: keep the whole graph framed (zoomed out to fit) until the user
    // pans, zooms or drags. Once both physics and camera converge, hold the
    // frame perfectly still instead of endlessly chasing (that was the shimmer).
    if (!userAdjusted && gNodes.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of gNodes) {
        minX = Math.min(minX, n.x - n.radius); minY = Math.min(minY, n.y - n.radius);
        maxX = Math.max(maxX, n.x + n.radius); maxY = Math.max(maxY, n.y + n.radius);
      }
      const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY), fitPad = 50;
      const targetScale = Math.max(0.25, Math.min(0.95, Math.min((cssW - fitPad * 2) / bw, (cssH - fitPad * 2) / bh)));
      const targetPanX = (cssW - bw * targetScale) / 2 - minX * targetScale;
      const targetPanY = (cssH - bh * targetScale) / 2 - minY * targetScale;
      const converged = frozen && Math.abs(targetScale - scale) < 0.02 && Math.abs(targetPanX - panX) < 3 && Math.abs(targetPanY - panY) < 3;
      if (!converged) {
        const k = frozen ? 0.06 : 0.12;
        scale += (targetScale - scale) * k;
        panX += (targetPanX - panX) * k;
        panY += (targetPanY - panY) * k;
      }
    }

    // Determine active set for hovering and searching
    const searchTerm = (homeSearchInput ? homeSearchInput.value.toLowerCase().trim() : '');
    const isSearching = searchTerm.length > 0;
    
    let activeNodes = new Set();
    let activeEdges = new Set();
    let searchMatchNodes = new Set();
    
    if (isSearching) {
      gNodes.forEach(n => {
        const title = (n.title || '').toLowerCase();
        const originalNote = notes.find(note => note.id === n.id);
        const body = originalNote && originalNote.body ? originalNote.body.toLowerCase() : '';
        if (title.includes(searchTerm) || body.includes(searchTerm)) {
          searchMatchNodes.add(n);
        }
      });
    } else if (hoveredNode) {
      activeNodes.add(hoveredNode);
      gEdges.forEach(edge => {
        if (edge.source === hoveredNode.id || edge.target === hoveredNode.id) {
          activeEdges.add(edge);
          activeNodes.add(gNodes.find(n => n.id === edge.source));
          activeNodes.add(gNodes.find(n => n.id === edge.target));
        }
      });
    }
    
    ctx.lineWidth = 2;
    gEdges.forEach(edge => {
      if (edge.currentAlpha === undefined) edge.currentAlpha = 0.4;
      
      let s = gNodes.find(n => n.id === edge.source);
      let t = gNodes.find(n => n.id === edge.target);
      if (!s || !t) return;
      
      let targetAlpha;
      if (isSearching) {
        targetAlpha = (searchMatchNodes.has(s) && searchMatchNodes.has(t)) ? 0.4 : 0.05;
      } else {
        targetAlpha = (!hoveredNode || activeEdges.has(edge)) ? 0.4 : 0.05;
      }
      
      edge.currentAlpha += (targetAlpha - edge.currentAlpha) * 0.15; // Smooth interpolation
      
      ctx.strokeStyle = `rgba(${edgeRgb}, ${edge.currentAlpha})`;
      
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    });
    
    gNodes.forEach(n => {
      if (n.currentAlpha === undefined) n.currentAlpha = 1;
      
      let isFaded = false;
      if (isSearching) {
        isFaded = !searchMatchNodes.has(n);
      } else if (hoveredNode) {
        isFaded = !activeNodes.has(n);
      }
      
      let targetAlpha = isFaded ? 0.15 : 1;
      n.currentAlpha += (targetAlpha - n.currentAlpha) * 0.15; // Smooth interpolation
      
      // Solid background mask to hide edges passing behind
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius + 1, 0, Math.PI * 2);
      ctx.fillStyle = GC.bg;
      ctx.fill();

      // Draw actual node with interpolated alpha
      ctx.globalAlpha = n.currentAlpha;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = GC.node;
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = GC.stroke;
      ctx.stroke();

      ctx.fillStyle = GC.text;
      ctx.font = '600 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let txt = n.title;
      if (txt.length > 24) txt = txt.substring(0, 22) + '...';

      // Zoom-dependent labels fade in/out with hysteresis (no flicker at the
      // threshold). Hovered/searched/hub nodes are always labelled.
      const always = activeNodes.has(n) || searchMatchNodes.has(n) || n.radius >= 22;
      const labelAlpha = n.currentAlpha <= 0.4 ? 0 : (always ? 1 : labelFade);
      if (labelAlpha > 0.04) {
        ctx.globalAlpha = n.currentAlpha * labelAlpha;
        ctx.shadowColor = GC.bg;
        ctx.shadowBlur = 4;
        ctx.lineWidth = 4;
        ctx.strokeStyle = GC.bg;
        ctx.strokeText(txt, n.x, n.y + n.radius + 8);
        ctx.shadowBlur = 0;
        ctx.fillText(txt, n.x, n.y + n.radius + 8);
      }
      ctx.globalAlpha = 1.0; // Reset
    });

    // advance the shared label fade once per frame (hysteresis band 0.70–0.78)
    if (scale > 0.78) labelsOn = true; else if (scale < 0.70) labelsOn = false;
    labelFade += ((labelsOn ? 1 : 0) - labelFade) * 0.12;
    
    graphAnimationFrame = requestAnimationFrame(draw);
  }
  
  draw();
}

// -----------------------------------------
// Ambient Time Logic
// -----------------------------------------
function updateAmbientTime() {
  const now = new Date();
  const timeEl = document.getElementById('ambient-time');
  const dateEl = document.getElementById('ambient-date');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
}
setInterval(updateAmbientTime, 1000);
updateAmbientTime();

// -----------------------------------------
// Pomodoro Logic
// -----------------------------------------
let pomodoroTime = 25 * 60;
let pomodoroInterval = null;
const pomodoroDisplay = document.getElementById('pomodoro-display');
const pomodoroLargeDisplay = document.getElementById('pomodoro-large-display');
const pomodoroModal = document.getElementById('pomodoro-fullscreen-modal');

function updatePomodoroDisplay() {
  const mins = Math.floor(pomodoroTime / 60);
  const secs = pomodoroTime % 60;
  const timeString = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  
  if (pomodoroDisplay) pomodoroDisplay.textContent = timeString;
  if (pomodoroLargeDisplay) pomodoroLargeDisplay.textContent = timeString;
}

window.startPomodoro = function(minutes = 25) {
  if (pomodoroModal) pomodoroModal.style.display = 'flex';
  
  if (pomodoroInterval) {
    clearInterval(pomodoroInterval);
  }
  pomodoroTime = minutes * 60;
  updatePomodoroDisplay();
  
  pomodoroInterval = setInterval(() => {
    if (pomodoroTime > 0) {
      pomodoroTime--;
      updatePomodoroDisplay();
    } else {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
      alert("Focus session complete!");
    }
  }, 1000);
};

window.updatePomodoroActive = function(btn) {
  const container = document.getElementById('pomodoro-buttons');
  if (!container) return;
  const buttons = container.querySelectorAll('button');
  buttons.forEach(b => {
    b.style.background = 'var(--overlay-medium)';
    b.style.color = 'var(--text-primary)';
  });
  btn.style.background = 'var(--text-primary)';
  btn.style.color = 'var(--bg-color)';
};

window.restPomodoro = function() {
  clearInterval(pomodoroInterval);
  pomodoroInterval = null;
  pomodoroTime = 5 * 60; // 5 min rest
  updatePomodoroDisplay();
  
  // Auto start the rest timer
  pomodoroInterval = setInterval(() => {
    if (pomodoroTime > 0) {
      pomodoroTime--;
      updatePomodoroDisplay();
    } else {
      clearInterval(pomodoroInterval);
      pomodoroInterval = null;
      alert("Rest complete! Time to focus.");
    }
  }, 1000);
};

window.exitFullscreenPomodoro = function() {
  if (pomodoroModal) pomodoroModal.style.display = 'none';
  if (pomodoroInterval) {
    clearInterval(pomodoroInterval);
    pomodoroInterval = null;
  }
  pomodoroTime = 25 * 60;
  updatePomodoroDisplay();
};

// -----------------------------------------
// Daily Journal Logic
// -----------------------------------------
let currentMood = null;

// Map moods to colors for the heatmap
const moodColors = {
  '😊': '#10b981', // green
  '😐': '#6b7280', // gray
  '😔': '#f59e0b', // orange
  '😫': '#ef4444'  // red
};

window.selectMood = function(el, mood) {
  currentMood = mood;
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.style.opacity = '0.5';
    btn.style.border = 'none';
  });
  el.style.opacity = '1';
  el.style.border = '2px solid var(--accent-color)';
};

// Helper for reliable local timezone date strings
function getLocalDateStr(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

window.saveJournal = function() {
  const textEl = document.getElementById('journal-textarea');
  if (textEl) {
    localStorage.setItem('opennotes_journal_text', textEl.value);
    localStorage.setItem('opennotes_journal_mood', currentMood || '');
    
    // Save to history for the heatmap
    if (currentMood) {
      const history = JSON.parse(localStorage.getItem('opennotes_mood_history')) || {};
      const todayStr = getLocalDateStr(new Date());
      history[todayStr] = currentMood;
      localStorage.setItem('opennotes_mood_history', JSON.stringify(history));
      renderMoodHeatmap();
    }
    
    alert("Daily log saved successfully!");
  }
};

function renderMoodHeatmap() {
  const heatmapEl = document.getElementById('mood-heatmap');
  if (!heatmapEl) return;
  
  heatmapEl.innerHTML = '';
  const history = JSON.parse(localStorage.getItem('opennotes_mood_history')) || {};
  
  // Create 52 columns (weeks)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(today);
  // Start from exactly 52 weeks minus 1 day ago so the very last cell is today
  startDate.setDate(startDate.getDate() - (51 * 7) - 6);
  
  for (let week = 0; week < 52; week++) {
    const col = document.createElement('div');
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '3px';
    
    for (let day = 0; day < 7; day++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(cellDate.getDate() + (week * 7) + day);
      const dateStr = getLocalDateStr(cellDate);
      
      const cell = document.createElement('div');
      cell.style.width = '10px';
      cell.style.height = '10px';
      cell.style.borderRadius = '2px';
      cell.title = dateStr + (history[dateStr] ? ` : ${history[dateStr]}` : '');
      
      if (history[dateStr]) {
        cell.style.backgroundColor = moodColors[history[dateStr]] || 'var(--overlay-medium)';
      } else {
        cell.style.backgroundColor = 'var(--overlay-medium)';
      }
      
      col.appendChild(cell);
    }
    heatmapEl.appendChild(col);
  }
}

const savedJournalText = localStorage.getItem('opennotes_journal_text');
const savedJournalMood = localStorage.getItem('opennotes_journal_mood');
const journalTextEl = document.getElementById('journal-textarea');
if (journalTextEl && savedJournalText) journalTextEl.value = savedJournalText;
if (savedJournalMood) {
  document.querySelectorAll('.mood-btn').forEach(btn => {
    if (btn.innerText.includes(savedJournalMood)) {
      window.selectMood(btn, savedJournalMood);
    }
  });
}
renderMoodHeatmap();

// -----------------------------------------
// Expense Tracker Logic
// -----------------------------------------
let expenses = JSON.parse(localStorage.getItem('opennotes_expenses')) || [];

window.addExpense = function() {
  const titleEl = document.getElementById('new-expense-title');
  const amountEl = document.getElementById('new-expense-amount');
  
  if (!titleEl || !amountEl) return;
  
  const title = titleEl.value.trim();
  const amount = parseFloat(amountEl.value);
  
  if (!title || isNaN(amount)) {
    alert("Please enter a valid title and amount.");
    return;
  }
  
  expenses.push({ id: Date.now(), title, amount });
  localStorage.setItem('opennotes_expenses', JSON.stringify(expenses));
  
  titleEl.value = '';
  amountEl.value = '';
  renderExpenses();
};

window.editExpense = function(id, field, value) {
  const exp = expenses.find(e => e.id === id);
  if (exp) {
    if (field === 'amount') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) exp.amount = parsed;
    } else {
      exp.title = value;
    }
    localStorage.setItem('opennotes_expenses', JSON.stringify(expenses));
    updateExpenseTotal();
  }
};

window.deleteExpense = function(id) {
  expenses = expenses.filter(e => e.id !== id);
  localStorage.setItem('opennotes_expenses', JSON.stringify(expenses));
  renderExpenses();
};

function updateExpenseTotal() {
  const totalEl = document.getElementById('expense-total');
  const currency = localStorage.getItem('opennotes_currency') || '₹';
  if (totalEl) {
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    totalEl.textContent = `${currency}${total.toFixed(2)}`;
  }
}

function renderExpenses() {
  const listEl = document.getElementById('expense-list');
  const currency = localStorage.getItem('opennotes_currency') || '₹';
  if (!listEl) return;
  
  listEl.innerHTML = '';
  
  expenses.forEach(e => {
    const div = document.createElement('div');
    div.style = "display: flex; gap: 8px; align-items: center;";
    div.innerHTML = `
      <input type="text" value="${e.title.replace(/"/g, '&quot;')}" onchange="editExpense(${e.id}, 'title', this.value)" style="flex: 2; padding: 6px 10px; border-radius: 6px; border: 1px solid transparent; font-family: inherit; font-size: 0.95rem; font-weight: 500; outline: none; background: transparent; transition: all 0.2s; color: var(--text-primary);" onfocus="this.style.background='#fff'; this.style.borderColor='var(--panel-border)';" onblur="this.style.background='transparent'; this.style.borderColor='transparent'; renderExpenses();" />
      <div style="flex: 1; position: relative;">
        <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-weight: 600; color: var(--text-secondary); pointer-events: none;">${currency}</span>
        <input type="number" value="${e.amount}" onchange="editExpense(${e.id}, 'amount', this.value)" style="width: 100%; padding: 6px 10px 6px 20px; border-radius: 6px; border: 1px solid transparent; font-family: inherit; font-size: 0.95rem; font-weight: 600; outline: none; background: transparent; transition: all 0.2s; color: var(--text-primary);" onfocus="this.style.background='#fff'; this.style.borderColor='var(--panel-border)';" onblur="this.style.background='transparent'; this.style.borderColor='transparent'; renderExpenses();" />
      </div>
      <button onclick="deleteExpense(${e.id})" style="background: rgba(239, 68, 68, 0.1); border: none; color: #ef4444; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">&times;</button>
    `;
    listEl.appendChild(div);
  });
  
  updateExpenseTotal();
}

// Initial render
renderExpenses();

// -----------------------------------------
// Quicklinks Logic
// -----------------------------------------
let quicklinks = JSON.parse(localStorage.getItem('opennotes_quicklinks')) || [
  { id: 1, title: 'GitHub', url: 'https://github.com' }
];

window.toggleQuicklinkForm = function() {
  const form = document.getElementById('quicklink-form');
  if (form) {
    form.style.display = form.style.display === 'none' ? 'flex' : 'none';
  }
};

window.saveNewQuicklink = function() {
  const titleEl = document.getElementById('new-quicklink-title');
  const urlEl = document.getElementById('new-quicklink-url');
  
  if (!titleEl || !urlEl) return;
  
  const title = titleEl.value.trim();
  const url = urlEl.value.trim();
  
  if (!title || !url) {
    return;
  }
  
  quicklinks.push({ id: Date.now(), title, url });
  localStorage.setItem('opennotes_quicklinks', JSON.stringify(quicklinks));
  
  titleEl.value = '';
  urlEl.value = '';
  document.getElementById('quicklink-form').style.display = 'none';
  renderQuicklinks();
};

window.deleteQuicklink = function(e, id) {
  e.preventDefault();
  e.stopPropagation();
  quicklinks = quicklinks.filter(q => q.id !== id);
  localStorage.setItem('opennotes_quicklinks', JSON.stringify(quicklinks));
  renderQuicklinks();
};

let editingQuicklinkId = null;
const qlEsc = (s) => String(s).replace(/"/g, '&quot;');
const qlSave = () => localStorage.setItem('opennotes_quicklinks', JSON.stringify(quicklinks));
const qlInputStyle = "padding: 6px 10px; border-radius: 6px; border: 1px solid var(--panel-border); font-family: inherit; font-size: 0.85rem; outline: none; background: var(--bg-color); color: var(--text-primary);";

function renderQuicklinks() {
  const container = document.getElementById('quicklinks-container');
  if (!container) return;
  container.innerHTML = '';
  const sorted = [...quicklinks].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  sorted.forEach(q => {
    // Inline edit form (window.prompt is disabled in Electron, so we edit in place)
    if (editingQuicklinkId === q.id) {
      const box = document.createElement('div');
      box.style = 'display: flex; flex-direction: column; gap: 6px; padding: 8px 12px;';
      box.innerHTML = `
        <input id="ql-edit-title-${q.id}" value="${qlEsc(q.title)}" placeholder="Title" style="${qlInputStyle}" />
        <input id="ql-edit-url-${q.id}" value="${qlEsc(q.url)}" placeholder="URL" style="${qlInputStyle}" />
        <div style="display: flex; gap: 6px;">
          <button onclick="saveQuicklinkEdit(${q.id})" style="flex:1; background: var(--accent-color); color: #fff; border: none; padding: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.8rem;">Save</button>
          <button onclick="cancelQuicklinkEdit()" style="flex:1; background: var(--overlay-medium); color: var(--text-primary); border: none; padding: 6px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.8rem;">Cancel</button>
        </div>`;
      container.appendChild(box);
      return;
    }
    const targetUrl = q.url.startsWith('http') ? q.url : 'https://' + q.url;
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = "_blank";
    a.className = "nav-link";
    a.style = "display: flex; justify-content: space-between; align-items: center; padding: 8px 16px;";
    a.innerHTML = `
      <span style="display: flex; align-items: center; gap: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        ${q.title}
      </span>
      <span class="quicklink-actions" style="display: flex; align-items: center; gap: 6px; opacity: ${q.pinned ? '1' : '0'}; transition: opacity 0.2s;">
        <button onclick="togglePinQuicklink(event, ${q.id})" title="${q.pinned ? 'Unpin' : 'Pin'}" style="background: none; border: none; color: ${q.pinned ? 'var(--accent-color)' : 'var(--text-secondary)'}; cursor: pointer; display: flex; align-items: center;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="${q.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14l-1.5-4.5V5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7.5L5 17z"></path></svg>
        </button>
        <button onclick="editQuicklink(event, ${q.id})" title="Edit" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center;">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button onclick="deleteQuicklink(event, ${q.id})" title="Delete" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.1rem; display: flex; align-items: center;">&times;</button>
      </span>
    `;
    a.onmouseenter = () => { const acts = a.querySelector('.quicklink-actions'); if (acts) acts.style.opacity = '1'; };
    a.onmouseleave = () => { const acts = a.querySelector('.quicklink-actions'); if (acts && !q.pinned) acts.style.opacity = '0'; };
    container.appendChild(a);
  });
}

window.editQuicklink = function(e, id) {
  e.preventDefault(); e.stopPropagation();
  editingQuicklinkId = id;
  renderQuicklinks();
  const t = document.getElementById('ql-edit-title-' + id);
  if (t) t.focus();
};
window.saveQuicklinkEdit = function(id) {
  const q = quicklinks.find(x => x.id === id);
  if (q) {
    const t = document.getElementById('ql-edit-title-' + id);
    const u = document.getElementById('ql-edit-url-' + id);
    if (t && t.value.trim()) q.title = t.value.trim();
    if (u && u.value.trim()) q.url = u.value.trim();
    qlSave();
  }
  editingQuicklinkId = null;
  renderQuicklinks();
};
window.cancelQuicklinkEdit = function() { editingQuicklinkId = null; renderQuicklinks(); };
window.togglePinQuicklink = function(e, id) {
  e.preventDefault(); e.stopPropagation();
  const q = quicklinks.find(x => x.id === id);
  if (q) { q.pinned = !q.pinned; qlSave(); renderQuicklinks(); }
};

renderQuicklinks();

// -----------------------------------------
// Settings Logic
// -----------------------------------------
window.saveSettings = function(notify) {
  const name = document.getElementById('settings-name').value.trim();
  const desig = document.getElementById('settings-designation').value.trim();
  const theme = document.getElementById('settings-theme').value;
  const currencyCode = document.getElementById('settings-currency').value;
  const language = document.getElementById('settings-language').value;
  const tempUnit = document.getElementById('settings-temp-unit').value;

  if (name) localStorage.setItem('opennotes_profile_name', name);
  if (desig) localStorage.setItem('opennotes_profile_type', desig);
  localStorage.setItem('opennotes_theme', theme);
  localStorage.setItem('opennotes_currency_code', currencyCode);
  localStorage.setItem('opennotes_currency', symbolForCode(currencyCode));
  localStorage.setItem('opennotes_language', language);
  localStorage.setItem('opennotes_temp_unit', tempUnit);

  applySettings();

  if (notify === true) {
    const btn = document.getElementById('settings-save-btn');
    if (btn) {
      const dict = translations[language] || translations.en;
      btn.textContent = dict['settings.saved'] || 'Saved ✓';
      btn.style.background = '#16a34a';
      clearTimeout(btn._t);
      btn._t = setTimeout(() => {
        btn.textContent = dict['settings.save'] || 'Save Settings';
        btn.style.background = 'var(--accent-color)';
      }, 1600);
    }
  }
};

window.applySettings = function() {
  // Harmonize with onboarding keys (userName/userRole) so the name set during onboarding sticks.
  const name = localStorage.getItem('opennotes_profile_name') || localStorage.getItem('userName') || 'Guest';
  const desig = localStorage.getItem('opennotes_profile_type') || localStorage.getItem('userRole') || 'Job';
  const theme = localStorage.getItem('opennotes_theme') || 'light';
  // Currency is keyed by ISO code (unique). Migrate older installs that only stored a symbol.
  let currencyCode = localStorage.getItem('opennotes_currency_code');
  if (!currencyCode) {
    const oldSym = localStorage.getItem('opennotes_currency');
    const match = oldSym && CURRENCIES.find(c => c[2] === oldSym);
    currencyCode = match ? match[0] : 'INR';
  }
  const currency = symbolForCode(currencyCode);
  localStorage.setItem('opennotes_currency', currency); // keep symbol in sync for the expense tracker
  const language = localStorage.getItem('opennotes_language') || 'en';
  const tempUnit = localStorage.getItem('opennotes_temp_unit') || 'F';

  const nameEls = document.querySelectorAll('#sidebar-profile-name');
  const desigEls = document.querySelectorAll('#sidebar-profile-type');

  nameEls.forEach(el => el.textContent = name);
  desigEls.forEach(el => el.textContent = desig);

  const bannerNameText = document.getElementById('banner-name-text');
  const bannerRoleText = document.getElementById('banner-role-text');
  if (bannerNameText) bannerNameText.textContent = `${name}.`;
  if (bannerRoleText) bannerRoleText.textContent = desig;

  if (theme === 'dark') {
    document.body.classList.add('theme-dark');
  } else {
    document.body.classList.remove('theme-dark');
  }

  populateCurrencies(currencyCode);

  const nameInput = document.getElementById('settings-name');
  const desigInput = document.getElementById('settings-designation');
  const themeInput = document.getElementById('settings-theme');
  const currencyInput = document.getElementById('settings-currency');
  const languageInput = document.getElementById('settings-language');
  const tempInput = document.getElementById('settings-temp-unit');

  if (nameInput) nameInput.value = name;
  if (desigInput) desigInput.value = desig;
  if (themeInput) themeInput.value = theme;
  if (currencyInput) currencyInput.value = currencyCode;
  if (languageInput) languageInput.value = language;
  if (tempInput) tempInput.value = tempUnit;

  const newExpenseAmount = document.getElementById('new-expense-amount');
  if (newExpenseAmount) newExpenseAmount.placeholder = `Amount (${currency})`;

  applyLanguage(language);
  updateAmbientTemp();
  updateExpenseTotal();
  renderExpenses();
  if (typeof refreshSelects === 'function') refreshSelects();
};

window.resetEverything = function() {
  const overlay = document.createElement('div');
  overlay.style = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(5px);';
  overlay.innerHTML = `
    <div style="background: var(--bg-color); padding: 32px; border-radius: 16px; max-width: 400px; text-align: center; border: 1px solid var(--panel-border);">
      <h3 style="color: var(--danger-color); margin-bottom: 16px;">Are you absolutely sure?</h3>
      <p style="color: var(--text-secondary); margin-bottom: 24px;">This will permanently delete all your projects, notes, expenses, and settings. This cannot be undone.</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="cancel-reset" style="padding: 10px 24px; border-radius: 8px; border: 1px solid var(--panel-border); background: transparent; cursor: pointer; color: var(--text-primary); font-weight: 600;">Cancel</button>
        <button id="confirm-reset" style="padding: 10px 24px; border-radius: 8px; border: none; background: var(--danger-color); color: #fff; cursor: pointer; font-weight: 600;">Yes, Delete Everything</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  document.getElementById('cancel-reset').onclick = () => overlay.remove();
  document.getElementById('confirm-reset').onclick = () => {
    localStorage.clear();
    location.reload();
  };
};

// -----------------------------------------
// Currencies (ISO 4217 — full active list)
// value = the symbol used to prefix amounts; label shows name + code + symbol
// -----------------------------------------
const CURRENCIES = [
  ['AED','UAE Dirham','د.إ'],['AFN','Afghan Afghani','؋'],['ALL','Albanian Lek','L'],['AMD','Armenian Dram','֏'],
  ['ANG','Netherlands Antillean Guilder','ƒ'],['AOA','Angolan Kwanza','Kz'],['ARS','Argentine Peso','$'],['AUD','Australian Dollar','A$'],
  ['AWG','Aruban Florin','ƒ'],['AZN','Azerbaijani Manat','₼'],['BAM','Bosnia-Herzegovina Mark','KM'],['BBD','Barbadian Dollar','Bds$'],
  ['BDT','Bangladeshi Taka','৳'],['BGN','Bulgarian Lev','лв'],['BHD','Bahraini Dinar','.د.ب'],['BIF','Burundian Franc','FBu'],
  ['BMD','Bermudan Dollar','$'],['BND','Brunei Dollar','B$'],['BOB','Bolivian Boliviano','Bs.'],['BRL','Brazilian Real','R$'],
  ['BSD','Bahamian Dollar','$'],['BTN','Bhutanese Ngultrum','Nu.'],['BWP','Botswanan Pula','P'],['BYN','Belarusian Ruble','Br'],
  ['BZD','Belize Dollar','BZ$'],['CAD','Canadian Dollar','C$'],['CDF','Congolese Franc','FC'],['CHF','Swiss Franc','CHF'],
  ['CLP','Chilean Peso','$'],['CNY','Chinese Yuan','¥'],['COP','Colombian Peso','$'],['CRC','Costa Rican Colón','₡'],
  ['CUP','Cuban Peso','$'],['CVE','Cape Verdean Escudo','$'],['CZK','Czech Koruna','Kč'],['DJF','Djiboutian Franc','Fdj'],
  ['DKK','Danish Krone','kr'],['DOP','Dominican Peso','RD$'],['DZD','Algerian Dinar','دج'],['EGP','Egyptian Pound','£'],
  ['ERN','Eritrean Nakfa','Nfk'],['ETB','Ethiopian Birr','Br'],['EUR','Euro','€'],['FJD','Fijian Dollar','FJ$'],
  ['FKP','Falkland Islands Pound','£'],['GBP','British Pound','£'],['GEL','Georgian Lari','₾'],['GHS','Ghanaian Cedi','₵'],
  ['GIP','Gibraltar Pound','£'],['GMD','Gambian Dalasi','D'],['GNF','Guinean Franc','FG'],['GTQ','Guatemalan Quetzal','Q'],
  ['GYD','Guyanaese Dollar','G$'],['HKD','Hong Kong Dollar','HK$'],['HNL','Honduran Lempira','L'],['HRK','Croatian Kuna','kn'],
  ['HTG','Haitian Gourde','G'],['HUF','Hungarian Forint','Ft'],['IDR','Indonesian Rupiah','Rp'],['ILS','Israeli New Shekel','₪'],
  ['INR','Indian Rupee','₹'],['IQD','Iraqi Dinar','ع.د'],['IRR','Iranian Rial','﷼'],['ISK','Icelandic Króna','kr'],
  ['JMD','Jamaican Dollar','J$'],['JOD','Jordanian Dinar','د.ا'],['JPY','Japanese Yen','¥'],['KES','Kenyan Shilling','KSh'],
  ['KGS','Kyrgystani Som','с'],['KHR','Cambodian Riel','៛'],['KMF','Comorian Franc','CF'],['KPW','North Korean Won','₩'],
  ['KRW','South Korean Won','₩'],['KWD','Kuwaiti Dinar','د.ك'],['KYD','Cayman Islands Dollar','$'],['KZT','Kazakhstani Tenge','₸'],
  ['LAK','Laotian Kip','₭'],['LBP','Lebanese Pound','ل.ل'],['LKR','Sri Lankan Rupee','Rs'],['LRD','Liberian Dollar','L$'],
  ['LSL','Lesotho Loti','L'],['LYD','Libyan Dinar','ل.د'],['MAD','Moroccan Dirham','د.م.'],['MDL','Moldovan Leu','L'],
  ['MGA','Malagasy Ariary','Ar'],['MKD','Macedonian Denar','ден'],['MMK','Myanmar Kyat','K'],['MNT','Mongolian Tugrik','₮'],
  ['MOP','Macanese Pataca','MOP$'],['MRU','Mauritanian Ouguiya','UM'],['MUR','Mauritian Rupee','₨'],['MVR','Maldivian Rufiyaa','Rf'],
  ['MWK','Malawian Kwacha','MK'],['MXN','Mexican Peso','$'],['MYR','Malaysian Ringgit','RM'],['MZN','Mozambican Metical','MT'],
  ['NAD','Namibian Dollar','N$'],['NGN','Nigerian Naira','₦'],['NIO','Nicaraguan Córdoba','C$'],['NOK','Norwegian Krone','kr'],
  ['NPR','Nepalese Rupee','₨'],['NZD','New Zealand Dollar','NZ$'],['OMR','Omani Rial','ر.ع.'],['PAB','Panamanian Balboa','B/.'],
  ['PEN','Peruvian Sol','S/'],['PGK','Papua New Guinean Kina','K'],['PHP','Philippine Peso','₱'],['PKR','Pakistani Rupee','₨'],
  ['PLN','Polish Zloty','zł'],['PYG','Paraguayan Guarani','₲'],['QAR','Qatari Rial','ر.ق'],['RON','Romanian Leu','lei'],
  ['RSD','Serbian Dinar','дин.'],['RUB','Russian Ruble','₽'],['RWF','Rwandan Franc','FRw'],['SAR','Saudi Riyal','ر.س'],
  ['SBD','Solomon Islands Dollar','SI$'],['SCR','Seychellois Rupee','₨'],['SDG','Sudanese Pound','ج.س.'],['SEK','Swedish Krona','kr'],
  ['SGD','Singapore Dollar','S$'],['SHP','Saint Helena Pound','£'],['SLL','Sierra Leonean Leone','Le'],['SOS','Somali Shilling','Sh'],
  ['SRD','Surinamese Dollar','$'],['SSP','South Sudanese Pound','£'],['STN','São Tomé Dobra','Db'],['SYP','Syrian Pound','£'],
  ['SZL','Swazi Lilangeni','L'],['THB','Thai Baht','฿'],['TJS','Tajikistani Somoni','ЅМ'],['TMT','Turkmenistani Manat','m'],
  ['TND','Tunisian Dinar','د.ت'],['TOP','Tongan Paʻanga','T$'],['TRY','Turkish Lira','₺'],['TTD','Trinidad & Tobago Dollar','TT$'],
  ['TWD','New Taiwan Dollar','NT$'],['TZS','Tanzanian Shilling','TSh'],['UAH','Ukrainian Hryvnia','₴'],['UGX','Ugandan Shilling','USh'],
  ['USD','US Dollar','$'],['UYU','Uruguayan Peso','$U'],['UZS','Uzbekistani Som','soʼm'],['VES','Venezuelan Bolívar','Bs.'],
  ['VND','Vietnamese Dong','₫'],['VUV','Vanuatu Vatu','VT'],['WST','Samoan Tala','WS$'],['XAF','Central African CFA Franc','FCFA'],
  ['XCD','East Caribbean Dollar','EC$'],['XOF','West African CFA Franc','CFA'],['XPF','CFP Franc','₣'],['YER','Yemeni Rial','﷼'],
  ['ZAR','South African Rand','R'],['ZMW','Zambian Kwacha','ZK'],['ZWL','Zimbabwean Dollar','Z$']
];

// option value = ISO code (unique); the symbol is looked up separately for display.
function symbolForCode(code) {
  const e = CURRENCIES.find(c => c[0] === code);
  return e ? e[2] : '₹';
}

function populateCurrencies(selectedCode) {
  const sel = document.getElementById('settings-currency');
  if (!sel) return;
  if (!sel.dataset.filled) {
    const frag = document.createDocumentFragment();
    CURRENCIES.forEach(([code, name, symbol]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = `${name} (${code}) ${symbol}`;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);
    sel.dataset.filled = '1';
  }
  if (selectedCode) sel.value = selectedCode;
}

// -----------------------------------------
// i18n — translates the visible UI chrome.
// ponytail: covers static chrome (nav, onboarding, settings, panel headers, back buttons).
// JS-generated text (alerts, toasts, dynamic lists) and user note content stay as-is — that is
// the known ceiling; extend the dictionaries + add data-i18n hooks to widen coverage.
// -----------------------------------------
const translations = {
  en: {
    'common.back':'Back',
    'onboarding.welcome':'Welcome to YourNotes','onboarding.subtitle':"Let's set up your personal workspace.",
    'onboarding.name_q':"What's your name?",'onboarding.name_ph':'e.g. John Doe',
    'onboarding.job_q':"What's your job?",'onboarding.job_ph':'e.g. Software Engineer','onboarding.enter':'Enter Workspace',
    'nav.workspace':'Workspace','nav.dashboard':'Dashboard','nav.projects':'Projects','nav.tasks':'Tasks',
    'nav.session':'Session','nav.scratchpad':'Scratchpad','nav.college':'College Notes','nav.quicklinks':'Quicklinks',
    'nav.add_link':'Add Link','nav.settings':'Settings',
    'session.title':'Dashboard Session','session.subtitle':'Focus, log, and track your daily rhythm.',
    'session.focus':'Focus Session','session.focus_sub':'Deep work in progress',
    'session.lofi':'Lofi Music','session.lofi_sub':'Royalty-free focus beats','session.lofi_load':'Load your own track',
    'scratchpad.title':'Scratchpad','scratchpad.saving':'Auto-saving...',
    'settings.title':'Settings','settings.subtitle':'Manage your preferences','settings.name':'Your Name','settings.job':'Job',
    'settings.job_ph':'e.g. Software Engineer','settings.language':'Language','settings.theme':'Theme',
    'settings.theme_light':'Day (Light)','settings.theme_dark':'Night (Dark)','settings.temp_unit':'Temperature Unit',
    'settings.currency':'Currency','settings.save':'Save Settings','settings.saved':'Saved ✓','settings.reset':'⚠️ Factory Reset','settings.reset_note':'This will permanently delete all data.',
    'college.title':'College Notes','college.subtitle':'Organize your college lectures, curriculum, and study PDF notes.',
    'nav.favourites':'Favourites','favourites.subtitle':'Your starred notes, project folders, and college files — all in one place.',
    'tasks.menu':'Tasks Menu'
  },
  ar: {
    'common.back':'رجوع',
    'onboarding.welcome':'مرحبًا بك في YourNotes','onboarding.subtitle':'لنُجهّز مساحة عملك الشخصية.',
    'onboarding.name_q':'ما اسمك؟','onboarding.name_ph':'مثال: محمد أحمد',
    'onboarding.job_q':'ما هي وظيفتك؟','onboarding.job_ph':'مثال: مهندس برمجيات','onboarding.enter':'ادخل إلى مساحة العمل',
    'nav.workspace':'مساحة العمل','nav.dashboard':'لوحة التحكم','nav.projects':'المشاريع','nav.tasks':'المهام',
    'nav.session':'الجلسة','nav.scratchpad':'المسودة','nav.college':'ملاحظات الكلية','nav.quicklinks':'روابط سريعة',
    'nav.add_link':'إضافة رابط','nav.settings':'الإعدادات',
    'session.title':'جلسة لوحة التحكم','session.subtitle':'ركّز وسجّل وتابع إيقاع يومك.',
    'session.focus':'جلسة تركيز','session.focus_sub':'عمل عميق قيد التنفيذ',
    'session.lofi':'موسيقى لو-فاي','session.lofi_sub':'إيقاعات تركيز خالية من حقوق الملكية','session.lofi_load':'حمّل مقطعك الخاص',
    'scratchpad.title':'المسودة','scratchpad.saving':'جارٍ الحفظ التلقائي...',
    'settings.title':'الإعدادات','settings.subtitle':'إدارة تفضيلاتك','settings.name':'اسمك','settings.job':'الوظيفة',
    'settings.job_ph':'مثال: مهندس برمجيات','settings.language':'اللغة','settings.theme':'المظهر',
    'settings.theme_light':'نهاري (فاتح)','settings.theme_dark':'ليلي (داكن)','settings.temp_unit':'وحدة الحرارة',
    'settings.currency':'العملة','settings.save':'حفظ الإعدادات','settings.saved':'تم الحفظ ✓','settings.reset':'⚠️ إعادة ضبط المصنع','settings.reset_note':'سيؤدي هذا إلى حذف جميع البيانات نهائيًا.',
    'college.title':'ملاحظات الكلية','college.subtitle':'نظّم محاضرات كليتك ومناهجك وملاحظات الدراسة بصيغة PDF.',
    'nav.favourites':'المفضلة','favourites.subtitle':'ملاحظاتك ومجلداتك وملفاتك المميّزة بنجمة في مكان واحد.',
    'tasks.menu':'قائمة المهام'
  },
  zh: {
    'common.back':'返回',
    'onboarding.welcome':'欢迎使用 YourNotes','onboarding.subtitle':'让我们设置你的个人工作区。',
    'onboarding.name_q':'你叫什么名字？','onboarding.name_ph':'例如：张伟',
    'onboarding.job_q':'你的职业是什么？','onboarding.job_ph':'例如：软件工程师','onboarding.enter':'进入工作区',
    'nav.workspace':'工作区','nav.dashboard':'仪表板','nav.projects':'项目','nav.tasks':'任务',
    'nav.session':'专注','nav.scratchpad':'便签','nav.college':'课堂笔记','nav.quicklinks':'快捷链接',
    'nav.add_link':'添加链接','nav.settings':'设置',
    'session.title':'仪表板专注','session.subtitle':'专注、记录并跟踪你的日常节奏。',
    'session.focus':'专注时段','session.focus_sub':'深度工作进行中',
    'session.lofi':'Lofi 音乐','session.lofi_sub':'可商用的专注节拍','session.lofi_load':'加载你自己的音轨',
    'scratchpad.title':'便签','scratchpad.saving':'自动保存中...',
    'settings.title':'设置','settings.subtitle':'管理你的偏好','settings.name':'你的名字','settings.job':'职业',
    'settings.job_ph':'例如：软件工程师','settings.language':'语言','settings.theme':'主题',
    'settings.theme_light':'白天（浅色）','settings.theme_dark':'夜间（深色）','settings.temp_unit':'温度单位',
    'settings.currency':'货币','settings.save':'保存设置','settings.saved':'已保存 ✓','settings.reset':'⚠️ 恢复出厂设置','settings.reset_note':'这将永久删除所有数据。',
    'college.title':'课堂笔记','college.subtitle':'整理你的大学讲座、课程和学习 PDF 笔记。',
    'nav.favourites':'收藏','favourites.subtitle':'你收藏的笔记、项目文件夹和大学文件，尽在一处。',
    'tasks.menu':'任务菜单'
  },
  ms: {
    'common.back':'Kembali',
    'onboarding.welcome':'Selamat datang ke YourNotes','onboarding.subtitle':'Mari sediakan ruang kerja peribadi anda.',
    'onboarding.name_q':'Siapa nama anda?','onboarding.name_ph':'cth. Ahmad bin Ali',
    'onboarding.job_q':'Apakah pekerjaan anda?','onboarding.job_ph':'cth. Jurutera Perisian','onboarding.enter':'Masuk Ruang Kerja',
    'nav.workspace':'Ruang Kerja','nav.dashboard':'Papan Pemuka','nav.projects':'Projek','nav.tasks':'Tugasan',
    'nav.session':'Sesi','nav.scratchpad':'Buku Nota','nav.college':'Nota Kolej','nav.quicklinks':'Pautan Pantas',
    'nav.add_link':'Tambah Pautan','nav.settings':'Tetapan',
    'session.title':'Sesi Papan Pemuka','session.subtitle':'Fokus, log, dan jejaki rutin harian anda.',
    'session.focus':'Sesi Fokus','session.focus_sub':'Kerja mendalam sedang berjalan',
    'session.lofi':'Muzik Lofi','session.lofi_sub':'Rentak fokus bebas royalti','session.lofi_load':'Muat trek anda sendiri',
    'scratchpad.title':'Buku Nota','scratchpad.saving':'Menyimpan automatik...',
    'settings.title':'Tetapan','settings.subtitle':'Urus pilihan anda','settings.name':'Nama Anda','settings.job':'Pekerjaan',
    'settings.job_ph':'cth. Jurutera Perisian','settings.language':'Bahasa','settings.theme':'Tema',
    'settings.theme_light':'Siang (Cerah)','settings.theme_dark':'Malam (Gelap)','settings.temp_unit':'Unit Suhu',
    'settings.currency':'Mata Wang','settings.save':'Simpan Tetapan','settings.saved':'Disimpan ✓','settings.reset':'⚠️ Set Semula Kilang','settings.reset_note':'Ini akan memadam semua data secara kekal.',
    'college.title':'Nota Kolej','college.subtitle':'Susun kuliah, kurikulum dan nota PDF pembelajaran kolej anda.',
    'nav.favourites':'Kegemaran','favourites.subtitle':'Nota, folder projek dan fail kolej kegemaran anda di satu tempat.',
    'tasks.menu':'Menu Tugasan'
  }
};

function applyLanguage(lang) {
  const dict = translations[lang] || translations.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key] != null) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if (dict[key] != null) el.setAttribute('placeholder', dict[key]);
  });
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === 'ar') ? 'rtl' : 'ltr';
}

// -----------------------------------------
// Ambient temperature (F/C). No live weather feed exists — 72°F is the original
// placeholder; we just convert the fixed base to the chosen unit.
// -----------------------------------------
function updateAmbientTemp() {
  const el = document.getElementById('ambient-temp');
  if (!el) return;
  const unit = localStorage.getItem('opennotes_temp_unit') || 'F';
  const baseF = 72;
  el.textContent = unit === 'C' ? `${Math.round((baseF - 32) * 5 / 9)}°C` : `${baseF}°F`;
}

// -----------------------------------------
// Lofi player (beside Focus Session)
// -----------------------------------------
let lofiPlaying = false;
function lofiEl() { return document.getElementById('lofi-audio'); }
function lofiVol() { const v = document.getElementById('lofi-volume'); return v ? parseFloat(v.value) : 0.6; }

// Update every lofi play/pause button (Session panel + Focus fullscreen share one audio)
function setLofiIcon(playing) {
  const html = playing
    ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  document.querySelectorAll('.lofi-toggle').forEach(b => { b.innerHTML = html; });
}
function setLofiNowPlaying(text) {
  document.querySelectorAll('.lofi-now-playing').forEach(el => { el.textContent = text; });
}

window.toggleLofi = function() {
  const audio = lofiEl();
  const sel = document.getElementById('lofi-track');
  if (!audio) return;
  if (!audio.src && sel) audio.src = sel.value;
  if (audio.paused) {
    audio.volume = lofiVol();
    audio.play().then(() => { lofiPlaying = true; setLofiIcon(true); })
      .catch(() => alert('Could not play this track. Check your connection, or use "Load your own track".'));
  } else {
    audio.pause();
    lofiPlaying = false;
    setLofiIcon(false);
  }
};

window.changeLofiTrack = function() {
  const sel = document.getElementById('lofi-track');
  const audio = lofiEl();
  if (!sel || !audio) return;
  audio.src = sel.value;
  setLofiNowPlaying(sel.options[sel.selectedIndex].text);
  if (lofiPlaying) { audio.volume = lofiVol(); audio.play().catch(() => {}); }
};

// Advance to the next built-in track (used by the Focus fullscreen control)
window.nextLofiTrack = function() {
  const sel = document.getElementById('lofi-track');
  if (!sel || !sel.options.length) return;
  sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
  changeLofiTrack();
  if (!lofiPlaying) toggleLofi();
};

window.setLofiVolume = function(v) {
  const a = lofiEl();
  if (a) a.volume = parseFloat(v);
  document.querySelectorAll('#lofi-volume, .lofi-vol, input[oninput*="setLofiVolume"]').forEach(s => { if (s.value !== v) s.value = v; });
};

window.loadLofiFile = function(e) {
  const file = e.target.files[0];
  const audio = lofiEl();
  if (!file || !audio) return;
  audio.src = URL.createObjectURL(file);
  setLofiNowPlaying(file.name);
  audio.volume = lofiVol();
  audio.play().then(() => { lofiPlaying = true; setLofiIcon(true); }).catch(() => {});
};

// -----------------------------------------
// Dashboard Board — drop files/images/notes; move + resize; persistent.
// Files are saved to disk (path only in the store) so the store stays small.
// -----------------------------------------
let boardItems = JSON.parse(localStorage.getItem('opennotes_board') || '[]');
function saveBoard() { localStorage.setItem('opennotes_board', JSON.stringify(boardItems)); }
// board_files names are safe (timestamp+random+ext) and userData has no spaces
const fileUrlOf = (p) => 'file:///' + String(p).replace(/\\/g, '/');

window.boardDragOver = function(e) { e.preventDefault(); const b = document.getElementById('dashboard-banner'); if (b) b.classList.add('board-dragover'); };
window.boardDragLeave = function(e) { const b = document.getElementById('dashboard-banner'); if (b && !b.contains(e.relatedTarget)) b.classList.remove('board-dragover'); };
window.boardDrop = async function(e) {
  e.preventDefault(); e.stopPropagation();
  const banner = document.getElementById('dashboard-banner');
  if (banner) banner.classList.remove('board-dragover');
  const rect = banner.getBoundingClientRect();
  let x = Math.max(6, e.clientX - rect.left - 90);
  let y = Math.max(6, e.clientY - rect.top - 60);
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length && window.electronAPI && window.electronAPI.saveBoardFile) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const buf = await f.arrayBuffer();
        const osPath = await window.electronAPI.saveBoardFile(f.name, buf);
        const isImg = /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name);
        boardItems.push({ id: 'b' + Date.now() + '-' + i, type: isImg ? 'image' : 'file', path: osPath, name: f.name, x: x + i * 26, y: y + i * 26, w: isImg ? 220 : 190, h: isImg ? 160 : 90 });
      } catch (_) {}
    }
    saveBoard(); renderBoard();
  } else {
    const text = (e.dataTransfer.getData('text/plain') || '').trim();
    if (text) { boardItems.push({ id: 'b' + Date.now(), type: 'text', text, x, y, w: 210, h: 130 }); saveBoard(); renderBoard(); }
  }
};

const BOARD_PIN_COLORS = ['#e0584f', '#e0a24f', '#4f8fe0', '#5bb15b', '#b06fd0', '#e05f97'];
function boardPinSvg(color) {
  // A little cartoon/sketchy pushpin: head, collar and needle, hand-drawn outline.
  return '<svg viewBox="0 0 44 56" width="27" height="34" fill="none">'
    + '<path d="M22 55 L22 32" stroke="#2e2620" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path d="M13 30 Q22 37 31 30 L27.5 21 L16.5 21 Z" fill="' + color + '" stroke="#2e2620" stroke-width="2.4" stroke-linejoin="round"/>'
    + '<ellipse cx="22" cy="14.5" rx="13" ry="11" fill="' + color + '" stroke="#2e2620" stroke-width="2.6"/>'
    + '<ellipse cx="17.5" cy="11" rx="4.5" ry="3" fill="rgba(255,255,255,0.5)"/>'
    + '</svg>';
}
function renderBoard() {
  const board = document.getElementById('dashboard-board');
  if (!board) return;
  board.innerHTML = '';
  const hint = document.getElementById('board-drop-hint');
  if (hint) hint.style.display = boardItems.length ? 'none' : '';
  let assigned = false;
  boardItems.forEach(item => {
    // Give each pinned item a stable slight tilt + pin colour once (never upside-down/90°).
    if (item.rot === undefined) { item.rot = Math.round((Math.random() * 20 - 10) * 10) / 10; item.pin = Math.floor(Math.random() * BOARD_PIN_COLORS.length); assigned = true; }
    const card = document.createElement('div');
    card.className = 'board-card board-' + item.type;
    card.style.left = item.x + 'px'; card.style.top = item.y + 'px';
    card.style.width = item.w + 'px'; card.style.height = item.h + 'px';
    card.style.transform = 'rotate(' + (item.rot || 0) + 'deg)';
    let inner = '';
    if (item.type === 'image') inner = `<div class="board-body board-img" style="background-image:url('${window.resolveFileUrl ? window.resolveFileUrl(fileUrlOf(item.path)) : fileUrlOf(item.path)}')"></div>`;
    else if (item.type === 'file') inner = `<div class="board-body board-file"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg><span>${gsEscape(item.name || 'File')}</span></div>`;
    else inner = `<div class="board-body board-text" contenteditable="true">${gsEscape(item.text || '')}</div>`;
    card.innerHTML = `<div class="board-pin">${boardPinSvg(BOARD_PIN_COLORS[item.pin || 0])}</div>` + inner + `<button class="board-del" title="Remove">&times;</button><div class="board-resize"></div>`;
    card.onclick = (ev) => ev.stopPropagation();
    const bodyEl = card.querySelector('.board-body');
    if (item.type === 'text') bodyEl.onblur = () => { item.text = bodyEl.innerText; saveBoard(); };
    card.querySelector('.board-del').onclick = (ev) => { ev.stopPropagation(); boardItems = boardItems.filter(b => b.id !== item.id); saveBoard(); renderBoard(); };
    makeBoardCardInteractive(card, item);
    board.appendChild(card);
  });
  if (assigned) saveBoard();
}

function makeBoardCardInteractive(card, item) {
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.board-resize') || e.target.closest('.board-del')) return;
    if (item.type === 'text' && e.target.closest('.board-text')) return; // let text editing work
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = item.x, oy = item.y;
    const rot = item.rot || 0;
    let moved = false; // a real drag only once the pointer travels past a small threshold
    card.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 4) return; // still a click
        moved = true; card.classList.add('dragging'); card.style.transform = 'rotate(' + rot + 'deg) scale(1.03)';
      }
      item.x = Math.max(0, ox + (ev.clientX - sx)); item.y = Math.max(0, oy + (ev.clientY - sy));
      card.style.left = item.x + 'px'; card.style.top = item.y + 'px';
    };
    const up = () => {
      card.removeEventListener('pointermove', move); card.removeEventListener('pointerup', up);
      if (moved) { card.classList.remove('dragging'); card.style.transform = 'rotate(' + rot + 'deg)'; saveBoard(); }
      else if (item.type !== 'text' && item.path && window.electronAPI && window.electronAPI.openPath) { window.electronAPI.openPath(item.path); } // clean click → open
    };
    card.addEventListener('pointermove', move); card.addEventListener('pointerup', up);
  });
  const handle = card.querySelector('.board-resize');
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY, ow = item.w, oh = item.h;
    handle.setPointerCapture(e.pointerId); card.classList.add('dragging');
    const move = (ev) => { item.w = Math.max(90, ow + (ev.clientX - sx)); item.h = Math.max(60, oh + (ev.clientY - sy)); card.style.width = item.w + 'px'; card.style.height = item.h + 'px'; };
    const up = () => { card.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); saveBoard(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  });
}

// -----------------------------------------
// AppSelect — themed <select> replacement (ported from the EverythingUTM project).
// Progressive enhancement: the native <select> stays the source of truth (value,
// options, change events); we hide it and drive a custom trigger + portalled menu,
// so the OS's grey/blue dropdown never appears.
// -----------------------------------------
const APPSELECT_CARET = '<svg class="app-select-caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const APPSELECT_CHECK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

function enhanceSelects(root = document) {
  root.querySelectorAll('select:not([data-appselect])').forEach((sel) => {
    sel.dataset.appselect = '1';
    sel.style.display = 'none';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'app-select';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.innerHTML = `<span class="app-select-value"></span>${APPSELECT_CARET}`;
    sel.after(trigger);
    const valueSpan = trigger.querySelector('.app-select-value');

    const syncLabel = () => {
      const opt = sel.options[sel.selectedIndex];
      valueSpan.textContent = opt ? opt.textContent : '';
    };
    sel._syncAppSelect = syncLabel;
    syncLabel();
    sel.addEventListener('change', syncLabel);

    let portal = null;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      if (portal) { portal.remove(); portal = null; }
      trigger.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
    }
    function open() {
      portal = document.createElement('div');
      portal.className = 'app-select-portal';
      const scrim = document.createElement('div');
      scrim.className = 'app-select-scrim';
      scrim.onclick = close;
      const menu = document.createElement('div');
      menu.className = 'app-select-menu';
      menu.setAttribute('role', 'listbox');

      Array.from(sel.options).forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'app-select-option' + (i === sel.selectedIndex ? ' is-selected' : '');
        b.disabled = o.disabled;
        const span = document.createElement('span');
        span.textContent = o.textContent;
        b.appendChild(span);
        if (i === sel.selectedIndex) b.insertAdjacentHTML('beforeend', APPSELECT_CHECK);
        b.onclick = () => {
          sel.value = o.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        };
        menu.appendChild(b);
      });

      portal.appendChild(scrim);
      portal.appendChild(menu);
      document.body.appendChild(portal);

      const r = trigger.getBoundingClientRect();
      const vh = window.innerHeight, vw = window.innerWidth, margin = 12;
      const w = Math.min(Math.max(r.width, 220), Math.max(160, vw - margin * 2));
      const left = Math.min(Math.max(margin, r.left), Math.max(margin, vw - w - margin));
      const below = vh - r.bottom - margin, above = r.top - margin;
      const up = below < 220 && above > below;
      const maxH = Math.min(280, Math.max(140, up ? above : below));
      menu.style.position = 'fixed';
      menu.style.left = left + 'px';
      menu.style.width = w + 'px';
      menu.style.maxHeight = maxH + 'px';
      if (up) menu.style.bottom = (vh - r.top + 6) + 'px'; else menu.style.top = (r.bottom + 6) + 'px';

      trigger.classList.add('is-open');
      document.addEventListener('keydown', onKey);
      const selected = menu.querySelector('.is-selected');
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }
    trigger.onclick = () => (portal ? close() : open());
  });
}

function refreshSelects() {
  document.querySelectorAll('select[data-appselect]').forEach((sel) => {
    if (typeof sel._syncAppSelect === 'function') sel._syncAppSelect();
  });
}

// -----------------------------------------
// Global search — searches notes, college folders/PDFs, tasks, events, links
// -----------------------------------------
const GS_ICONS = {
  note: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
  folder: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
  pdf: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="13" y2="17"></line></svg>',
  task: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>',
  event: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>',
  link: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
};
function gsEscape(s) { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const box = document.getElementById('global-search-results');
  if (!input || !box) return;
  let items = [], active = -1;

  function collect(term) {
    const res = [];
    notes.forEach(n => {
      const title = n.title || 'Untitled Note';
      const body = (n.body || '').replace(/<[^>]*>?/gm, '');
      if (title.toLowerCase().includes(term) || body.toLowerCase().includes(term))
        res.push({ type: 'Note', icon: GS_ICONS.note, label: noteDisplayTitle(n), sub: noteGroup(n), action: () => setActiveNote(n.id) });
    });
    collegeFolders.forEach(f => {
      if ((f.name || '').toLowerCase().includes(term) || (f.category || '').toLowerCase().includes(term))
        res.push({ type: 'College Folder', icon: GS_ICONS.folder, label: f.name, sub: f.category || '', action: () => { window.toggleCollegePanel(); window.openCollegeFolder(f.id); } });
      (f.pdfs || []).forEach(p => {
        if ((p.name || '').toLowerCase().includes(term))
          res.push({ type: 'College File', icon: GS_ICONS.pdf, label: p.name, sub: f.name, action: () => { window.toggleCollegePanel(); window.openCollegeFolder(f.id); setTimeout(() => window.viewCollegePDF(p.id), 80); } });
      });
    });
    tasks.forEach(t => { if ((t.text || '').toLowerCase().includes(term)) res.push({ type: 'Task', icon: GS_ICONS.task, label: t.text, sub: t.completed ? 'done' : '', action: () => window.toggleTasksPanel() }); });
    calendarTasks.forEach(e => { if ((e.event || '').toLowerCase().includes(term)) res.push({ type: 'Event', icon: GS_ICONS.event, label: e.event, sub: '', action: () => window.toggleTasksPanel() }); });
    quicklinks.forEach(l => { if ((l.title || '').toLowerCase().includes(term) || (l.url || '').toLowerCase().includes(term)) res.push({ type: 'Link', icon: GS_ICONS.link, label: l.title, sub: l.url, action: () => window.open(l.url.startsWith('http') ? l.url : 'https://' + l.url, '_blank') }); });
    return res.slice(0, 60);
  }

  function render() {
    const q = input.value.trim();
    active = -1;
    if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
    items = collect(q.toLowerCase());
    if (items.length === 0) { box.innerHTML = `<div class="gs-empty">No matches for “${gsEscape(q)}”</div>`; box.style.display = 'block'; return; }
    const order = ['Note', 'College Folder', 'College File', 'Task', 'Event', 'Link'];
    let html = '';
    order.forEach(type => {
      const group = items.filter(it => it.type === type);
      if (!group.length) return;
      html += `<div class="gs-group-label">${type}${group.length > 1 ? 's' : ''} · ${group.length}</div>`;
      group.forEach(it => {
        html += `<button class="gs-item" data-i="${items.indexOf(it)}">${it.icon}<span class="gs-label">${gsEscape(it.label)}</span>${it.sub ? `<span class="gs-sub">${gsEscape(it.sub)}</span>` : ''}</button>`;
      });
    });
    box.innerHTML = html;
    box.style.display = 'block';
    box.querySelectorAll('.gs-item').forEach(el => {
      el.onclick = () => { const it = items[+el.dataset.i]; input.value = ''; box.style.display = 'none'; if (it) it.action(); };
    });
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', (e) => {
    const btns = [...box.querySelectorAll('.gs-item')];
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, btns.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); (btns[active] || btns[0])?.click(); return; }
    else if (e.key === 'Escape') { box.style.display = 'none'; input.blur(); return; }
    else return;
    btns.forEach((b, i) => b.classList.toggle('gs-active', i === active));
    if (btns[active]) btns[active].scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.global-search-wrap')) box.style.display = 'none'; });
}

// -----------------------------------------
// Sidebar reorder — drag the workspace nav items to reorder; order is persisted.
// -----------------------------------------
function initSidebarReorder() {
  const nav = document.querySelector('.sidebar-nav .nav-section');
  if (!nav) return;

  // apply saved order
  const saved = JSON.parse(localStorage.getItem('opennotes_nav_order') || 'null');
  if (Array.isArray(saved)) saved.forEach(id => { const el = document.getElementById(id); if (el && el.parentNode === nav) nav.appendChild(el); });

  let dragEl = null;
  nav.querySelectorAll('.nav-link').forEach(link => {
    link.setAttribute('draggable', 'true');
    link.addEventListener('dragstart', (e) => { dragEl = link; link.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    link.addEventListener('dragend', () => {
      link.classList.remove('dragging');
      const order = [...nav.querySelectorAll('.nav-link')].map(l => l.id);
      localStorage.setItem('opennotes_nav_order', JSON.stringify(order));
    });
  });

  nav.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragEl) return;
    const others = [...nav.querySelectorAll('.nav-link:not(.dragging)')];
    const after = others.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = e.clientY - box.top - box.height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: -Infinity }).element;
    if (after == null) nav.appendChild(dragEl); else nav.insertBefore(dragEl, after);
  });
}

// Initial load
applySettings();
enhanceSelects();
refreshSelects();
initGlobalSearch();
initSidebarReorder();
renderBoard();

// -----------------------------------------
// Native menu: File > New Note
// -----------------------------------------
if (window.electronAPI && window.electronAPI.onNewNote) {
  window.electronAPI.onNewNote(() => createNote());
}

// -----------------------------------------
// College Notes logic
// -----------------------------------------
let collegeFolders = JSON.parse(localStorage.getItem('opennotes_college_folders')) || [];
let activeCollegeFolderId = null;
let contextTargetType = null; // 'folder' or 'pdf'
let contextTargetId = null;   // folderId or pdfId
let editingFolderId = null;   // folderId being renamed/edited

function saveCollegeFolders() {
  localStorage.setItem('opennotes_college_folders', JSON.stringify(collegeFolders));
}

window.toggleCollegePanel = function() {
  setActiveNote(null);
  showPanel('home-college', 'nav-college-btn');
  activeCollegeFolderId = null;
  
  // Show folders view, hide single folder contents view
  const fc = document.getElementById('college-folders-container');
  const sfv = document.getElementById('college-single-folder-view');
  if (fc) fc.style.display = 'flex';
  if (sfv) sfv.style.display = 'none';

  // Make sure new folder button is visible
  const addBtn = document.getElementById('add-college-folder-btn');
  if (addBtn) addBtn.style.display = 'flex';
  
  renderCollegeFolders();
};

window.renderCollegeFolders = function() {
  const foldersGrid = document.getElementById('college-folders-grid');
  if (!foldersGrid) return;
  foldersGrid.innerHTML = '';

  if (collegeFolders.length === 0) {
    foldersGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" style="margin-bottom: 16px; opacity: 0.5; display: inline-block;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <h4 style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 4px 0;">No Folders Yet</h4>
        <p style="font-size: 0.9rem; margin: 0;">Create a folder to begin organizing your college notes.</p>
      </div>
    `;
    return;
  }

  collegeFolders.forEach(folder => {
    const card = document.createElement('div');
    card.className = 'college-folder-card';
    card.onclick = () => window.openCollegeFolder(folder.id);

    // Bind custom context menu
    card.oncontextmenu = (e) => {
      e.preventDefault();
      showCollegeContextMenu('folder', folder.id, e.clientX, e.clientY);
    };

    const pdfCount = folder.pdfs ? folder.pdfs.length : 0;
    const pdfWord = pdfCount === 1 ? 'PDF' : 'PDFs';

    card.innerHTML = `
      <div class="college-card-actions">
        <button class="college-action-btn fav-btn ${isFav('folder', folder.id) ? 'active' : ''}" onclick="toggleFav(event,'folder','${folder.id}')" title="Favourite">${STAR_SVG(isFav('folder', folder.id))}</button>
        <button class="college-action-btn" onclick="event.stopPropagation(); window.deleteCollegeFolder('${folder.id}')" title="Delete Folder">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      <div class="college-folder-icon">
        <svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      </div>
      <h4 class="college-folder-title" title="${folder.name}">${folder.name}</h4>
      ${folder.category ? `<span class="college-folder-category-badge">${folder.category}</span>` : '<span class="college-folder-category-badge" style="opacity:0.3">Uncategorized</span>'}
      <div class="college-folder-meta">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        <span>${pdfCount} ${pdfWord}</span>
      </div>
    `;
    foldersGrid.appendChild(card);
  });
};

window.openCollegeFolder = function(folderId) {
  activeCollegeFolderId = folderId;
  const folder = collegeFolders.find(f => f.id === folderId);
  if (!folder) return;

  const fc = document.getElementById('college-folders-container');
  const sfv = document.getElementById('college-single-folder-view');
  if (fc) fc.style.display = 'none';
  if (sfv) sfv.style.display = 'flex';

  const titleEl = document.getElementById('college-folder-title');
  const catEl = document.getElementById('college-folder-category');
  if (titleEl) titleEl.textContent = folder.name;
  if (catEl) catEl.textContent = folder.category || 'Uncategorized';

  // Hide new folder button when folder is open
  const addBtn = document.getElementById('add-college-folder-btn');
  if (addBtn) addBtn.style.display = 'none';

  renderCollegeSingleFolder(folderId);
};

function renderCollegeSingleFolder(folderId) {
  const pdfsGrid = document.getElementById('college-pdfs-grid');
  if (!pdfsGrid) return;
  pdfsGrid.innerHTML = '';

  const folder = collegeFolders.find(f => f.id === folderId);
  if (!folder) return;

  const pdfList = folder.pdfs || [];

  if (pdfList.length === 0) {
    pdfsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" stroke-width="1.5" fill="none" style="margin-bottom: 16px; opacity: 0.5; display: inline-block;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <h4 style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin: 0 0 4px 0;">No PDFs Imported</h4>
        <p style="font-size: 0.9rem; margin: 0;">Import a lecture PDF note to store it inside this folder.</p>
      </div>
    `;
    return;
  }

  // Sort by createdAt desc
  const sortedPdfs = [...pdfList].sort((a, b) => b.createdAt - a.createdAt);

  sortedPdfs.forEach(pdf => {
    const card = document.createElement('div');
    card.className = 'college-pdf-card';
    card.onclick = () => window.viewCollegePDF(pdf.id);

    // Bind custom context menu
    card.oncontextmenu = (e) => {
      e.preventDefault();
      showCollegeContextMenu('pdf', pdf.id, e.clientX, e.clientY);
    };

    const uploadDate = new Date(pdf.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    card.innerHTML = `
      <div class="college-card-actions">
        <button class="college-action-btn fav-btn ${isFav('pdf', pdf.id) ? 'active' : ''}" onclick="toggleFav(event,'pdf','${pdf.id}')" title="Favourite">${STAR_SVG(isFav('pdf', pdf.id))}</button>
        <button class="college-action-btn" onclick="event.stopPropagation(); window.deleteCollegePDF('${pdf.id}')" title="Delete PDF">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      <div class="college-pdf-icon">
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
      </div>
      <div class="college-pdf-info">
        <h5 class="college-pdf-name" title="${pdf.name}">${pdf.name}</h5>
        <div class="college-pdf-meta">${pdf.size} • Imported ${uploadDate}</div>
      </div>
    `;
    pdfsGrid.appendChild(card);
  });
}

window.deleteCollegeFolder = function(folderId) {
  const folder = collegeFolders.find(f => f.id === folderId);
  if (!folder) return;

  if (confirm(`Are you sure you want to delete the folder "${folder.name}" and all its imported PDFs?`)) {
    collegeFolders = collegeFolders.filter(f => f.id !== folderId);
    saveCollegeFolders();
    renderCollegeFolders();
  }
};

window.deleteCollegePDF = function(pdfId) {
  const folder = collegeFolders.find(f => f.id === activeCollegeFolderId);
  if (!folder) return;

  const pdf = folder.pdfs.find(p => p.id === pdfId);
  if (!pdf) return;

  if (confirm(`Are you sure you want to delete "${pdf.name}"?`)) {
    folder.pdfs = folder.pdfs.filter(p => p.id !== pdfId);
    saveCollegeFolders();
    renderCollegeSingleFolder(activeCollegeFolderId);
  }
};

window.viewCollegePDF = function(pdfId) {
  const folder = collegeFolders.find(f => f.id === activeCollegeFolderId);
  if (!folder) return;

  const pdf = folder.pdfs.find(p => p.id === pdfId);
  if (!pdf) return;

  const modal = document.getElementById('college-pdf-viewer-modal');
  const titleEl = document.getElementById('college-pdf-viewer-title');
  const iframe = document.getElementById('college-pdf-iframe');
  const noteContentEl = document.getElementById('college-note-viewer-content');

  if (modal && titleEl && iframe && noteContentEl) {
    if (pdf.isNote) {
      // Find latest note contents
      const note = notes.find(n => n.id === pdf.noteId);
      titleEl.textContent = note ? (note.title || 'Untitled Note') : pdf.name;
      
      iframe.style.display = 'none';
      noteContentEl.style.display = 'block';
      
      if (note) {
        noteContentEl.innerHTML = `
          <h1 style="font-size: 2.2rem; font-weight: 800; margin-top: 0; margin-bottom: 20px; border-bottom: 1px solid var(--panel-border); padding-bottom: 16px; color: var(--text-primary);">${note.title || 'Untitled Note'}</h1>
          <div style="font-size: 1.15rem; line-height: 1.8; color: var(--text-primary);">${note.body || '<p style="color: var(--text-secondary); font-style: italic;">No content inside this note.</p>'}</div>
        `;
      } else {
        noteContentEl.innerHTML = `<p style="color: var(--text-secondary); font-style: italic;">Note has been deleted from the workspace.</p>`;
      }
    } else {
      titleEl.textContent = pdf.name;
      noteContentEl.style.display = 'none';
      iframe.style.display = 'block';
      // path = file stored on disk (large PDFs); data = inline base64 (legacy small
      // uploads). On mobile the desktop file:// path resolves through cloud sync.
      const src = window.resolveFileUrl ? window.resolveFileUrl(pdf.path || pdf.data) : (pdf.path || pdf.data);
      if (String(src).startsWith('file:') && !window.electronAPI) {
        // No local copy and no cloud URL yet — open nothing rather than a broken frame
        noteContentEl.style.display = 'block';
        iframe.style.display = 'none';
        noteContentEl.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">This PDF lives on your computer. Sign in to Sync on both devices to view it here.</p>';
      } else {
        iframe.src = src;
      }
    }
    modal.style.display = 'flex';
  }
};

function showCollegeContextMenu(type, id, x, y) {
  contextTargetType = type;
  contextTargetId = id;

  const menu = document.getElementById('college-context-menu');
  if (!menu) return;

  const archiveBtn = document.getElementById('context-archive-btn');
  const archiveLabel = document.getElementById('context-archive-label');
  if (archiveBtn) {
    if (type === 'note') {
      archiveBtn.style.display = 'flex';
      if (archiveLabel) archiveLabel.textContent = isNoteArchived(id) ? 'Restore' : 'Archive';
    } else if (type === 'project-folder') {
      const folderNotes = notesInProjectFolder(id);
      const restoring = homeArchiveMode || (folderNotes.length > 0 && folderNotes.every(note => isNoteArchived(note)));
      archiveBtn.style.display = 'flex';
      if (archiveLabel) archiveLabel.textContent = restoring ? 'Restore Folder' : 'Archive Folder';
    } else {
      archiveBtn.style.display = 'none';
    }
  }

  // Toggle project-folder movement wrapper visibility.
  const addToFolderWrapper = document.getElementById('context-add-to-folder-wrapper');
  if (addToFolderWrapper) {
    if (type === 'note') {
      addToFolderWrapper.style.display = 'block';
      const submenu = document.getElementById('college-context-submenu');
      if (submenu) {
        submenu.innerHTML = '';
        const note = notes.find(n => n.id === id);
        const currentFolder = note ? noteGroup(note) : '';
        const folders = projectFolderNames(notes).filter(folder => folder !== currentFolder);
        const newFolderItem = document.createElement('button');
        newFolderItem.className = 'context-item';
        newFolderItem.style.cssText = 'background: transparent; border: none; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 0.85rem; text-align: left; color: var(--accent-color); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; transition: background 0.15s;';
        newFolderItem.textContent = 'New folder...';
        newFolderItem.onclick = (e) => {
          e.stopPropagation();
          const folderName = prompt('Move note to new folder:');
          if (folderName !== null && folderName.trim()) moveProjectNoteToFolder(id, folderName.trim());
          menu.style.display = 'none';
        };
        submenu.appendChild(newFolderItem);
        if (folders.length === 0) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding: 8px 12px; color: var(--text-secondary); font-size: 0.85rem; text-align: center; white-space: nowrap;';
          empty.textContent = 'No other folders';
          submenu.appendChild(empty);
        } else {
          folders.forEach(folder => {
            const item = document.createElement('button');
            item.className = 'context-item';
            item.style.cssText = 'background: transparent; border: none; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 0.85rem; text-align: left; color: var(--text-primary); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; transition: background 0.15s;';
            item.textContent = folder;
            item.onclick = (e) => {
              e.stopPropagation();
              moveProjectNoteToFolder(id, folder);
              menu.style.display = 'none';
            };
            submenu.appendChild(item);
          });
        }
      }
    } else {
      addToFolderWrapper.style.display = 'none';
    }
  }

  menu.style.display = 'flex';

  const menuWidth = 180;
  const menuHeight = 160;
  let posX = x;
  let posY = y;

  if (x + menuWidth > window.innerWidth) {
    posX = x - menuWidth;
  }
  if (y + menuHeight > window.innerHeight) {
    posY = y - menuHeight;
  }

  menu.style.left = `${posX}px`;
  menu.style.top = `${posY}px`;

  menu.oncontextmenu = (e) => e.preventDefault();
}

function addNoteToCollegeFolder(noteId, folderId) {
  const note = notes.find(n => n.id === noteId);
  const folder = collegeFolders.find(f => f.id === folderId);
  if (!note || !folder) return;

  if (!folder.pdfs) folder.pdfs = [];

  // Check if already in folder
  const exists = folder.pdfs.some(p => p.isNote && p.noteId === noteId);
  if (exists) {
    alert(`The note "${note.title || 'Untitled Note'}" is already in "${folder.name}".`);
    return;
  }

  folder.pdfs.push({
    id: 'pdf-note-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
    name: note.title || 'Untitled Note',
    isNote: true,
    noteId: noteId,
    size: 'Note Document',
    createdAt: Date.now()
  });

  saveCollegeFolders();
  alert(`Successfully added "${note.title || 'Untitled Note'}" to folder "${folder.name}".`);
}

// Initialize College UI Listeners
document.addEventListener('DOMContentLoaded', () => {
  const openFolderModalBtn = document.getElementById('add-college-folder-btn');
  const closeFolderModalBtn = document.getElementById('close-college-folder-modal');
  const saveFolderBtn = document.getElementById('save-college-folder-btn');
  const folderModal = document.getElementById('college-folder-modal');

  if (openFolderModalBtn && folderModal) {
    openFolderModalBtn.onclick = () => {
      editingFolderId = null;
      const titleEl = document.getElementById('college-folder-modal-title');
      if (titleEl) titleEl.textContent = 'New Folder';
      document.getElementById('college-folder-name').value = '';
      document.getElementById('college-folder-category-input').value = '';
      if (saveFolderBtn) saveFolderBtn.textContent = 'Create Folder';
      folderModal.style.display = 'flex';
    };
  }

  if (closeFolderModalBtn && folderModal) {
    closeFolderModalBtn.onclick = () => {
      folderModal.style.display = 'none';
      editingFolderId = null;
    };
  }

  if (saveFolderBtn && folderModal) {
    saveFolderBtn.onclick = () => {
      const name = document.getElementById('college-folder-name').value.trim();
      const category = document.getElementById('college-folder-category-input').value.trim();

      if (!name) {
        alert("Please enter a folder name.");
        return;
      }

      if (editingFolderId) {
        const folder = collegeFolders.find(f => f.id === editingFolderId);
        if (folder) {
          folder.name = name;
          folder.category = category;
          saveCollegeFolders();
        }
      } else {
        const newFolder = {
          id: 'folder-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
          name: name,
          category: category,
          createdAt: Date.now(),
          pdfs: []
        };
        collegeFolders.push(newFolder);
        saveCollegeFolders();
      }

      folderModal.style.display = 'none';
      editingFolderId = null;
      renderCollegeFolders();
    };
  }

  // Back to Folders Button
  const backBtn = document.getElementById('college-folder-back-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      document.getElementById('college-single-folder-view').style.display = 'none';
      document.getElementById('college-folders-container').style.display = 'flex';
      activeCollegeFolderId = null;
      
      const addBtn = document.getElementById('add-college-folder-btn');
      if (addBtn) addBtn.style.display = 'flex';
      
      renderCollegeFolders();
    };
  }

  // Context Menu Actions Binding
  const contextMenu = document.getElementById('college-context-menu');
  const contextOpenBtn = document.getElementById('context-open-btn');
  const contextRenameBtn = document.getElementById('context-rename-btn');
  const contextArchiveBtn = document.getElementById('context-archive-btn');
  const contextDeleteBtn = document.getElementById('context-delete-btn');

  if (contextOpenBtn) {
    contextOpenBtn.onclick = () => {
      if (contextMenu) contextMenu.style.display = 'none';
      if (contextTargetType === 'folder') {
        window.openCollegeFolder(contextTargetId);
      } else if (contextTargetType === 'pdf') {
        window.viewCollegePDF(contextTargetId);
      } else if (contextTargetType === 'project-folder') {
        homeFolderFilter = contextTargetId;
        expandedProjectGroups.add(contextTargetId);
        saveStringSet('opennotes_expanded_project_groups', expandedProjectGroups);
        showPanel('home-grid', 'nav-projects-btn');
        const activeTab = homeArchiveMode ? viewArchivedBtn : viewGridBtn;
        if (activeTab) activeTab.classList.add('active');
        renderHomeGrid(homeSearchInput ? homeSearchInput.value : '');
      } else if (contextTargetType === 'note') {
        setActiveNote(contextTargetId);
      }
    };
  }

  if (contextRenameBtn) {
    contextRenameBtn.onclick = () => {
      if (contextMenu) contextMenu.style.display = 'none';
      if (contextTargetType === 'folder') {
        editingFolderId = contextTargetId;
        const folder = collegeFolders.find(f => f.id === editingFolderId);
        if (folder) {
          const titleEl = document.getElementById('college-folder-modal-title');
          if (titleEl) titleEl.textContent = 'Rename Folder';
          document.getElementById('college-folder-name').value = folder.name;
          document.getElementById('college-folder-category-input').value = folder.category || '';
          if (saveFolderBtn) saveFolderBtn.textContent = 'Save Changes';
          if (folderModal) folderModal.style.display = 'flex';
        }
      } else if (contextTargetType === 'pdf') {
        const folder = collegeFolders.find(f => f.id === activeCollegeFolderId);
        const pdf = folder ? folder.pdfs.find(p => p.id === contextTargetId) : null;
        if (pdf) {
          const newName = prompt("Rename PDF document:", pdf.name);
          if (newName && newName.trim()) {
            pdf.name = newName.trim();
            saveCollegeFolders();
            renderCollegeSingleFolder(activeCollegeFolderId);
          }
        }
      } else if (contextTargetType === 'project-folder') {
        renameProjectFolder(contextTargetId);
      } else if (contextTargetType === 'note') {
        renameProjectNote(contextTargetId);
      }
    };
  }

  if (contextArchiveBtn) {
    contextArchiveBtn.onclick = () => {
      if (contextMenu) contextMenu.style.display = 'none';
      if (contextTargetType === 'note') {
        const note = notes.find(n => n.id === contextTargetId);
        if (note) setNoteArchived(contextTargetId, !isNoteArchived(note));
      } else if (contextTargetType === 'project-folder') {
        setProjectFolderArchived(contextTargetId, !homeArchiveMode);
      }
    };
  }

  if (contextDeleteBtn) {
    contextDeleteBtn.onclick = () => {
      if (contextMenu) contextMenu.style.display = 'none';
      if (contextTargetType === 'folder') {
        window.deleteCollegeFolder(contextTargetId);
      } else if (contextTargetType === 'pdf') {
        window.deleteCollegePDF(contextTargetId);
      } else if (contextTargetType === 'project-folder') {
        deleteProjectFolder(contextTargetId);
      } else if (contextTargetType === 'note') {
        deleteProjectNote(contextTargetId);
      }
    };
  }

  // Dismiss context menu on click outside or ESC
  document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
      contextMenu.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (contextMenu) contextMenu.style.display = 'none';
    }
  });

  // Upload PDF triggers
  const uploadBtn = document.getElementById('college-upload-pdf-btn');
  const fileInput = document.getElementById('college-pdf-upload-input');

  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };

    fileInput.onchange = async (e) => {
      const files = Array.from(e.target.files || []).filter(f => f.type === 'application/pdf');
      if (files.length === 0) {
        alert("Only PDF files are supported.");
        return;
      }

      const currentFolder = collegeFolders.find(f => f.id === activeCollegeFolderId);
      if (!currentFolder) return;
      if (!currentFolder.pdfs) currentFolder.pdfs = [];

      // Show a loading state while importing (handles one or many files)
      uploadBtn.disabled = true;
      const originalText = uploadBtn.innerHTML;
      uploadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Importing ${files.length}...`;

      const readFile = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (evt) => resolve(evt.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      try {
        for (const file of files) {
          const base64Data = await readFile(file);
          currentFolder.pdfs.push({
            id: 'pdf-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
            name: file.name,
            data: base64Data,
            size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
            createdAt: Date.now()
          });
        }
        saveCollegeFolders();
        renderCollegeSingleFolder(activeCollegeFolderId);
      } catch (err) {
        alert("Failed to read one or more files.");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalText;
      }
    };
  }

  // Close PDF Viewer modal
  const closePdfViewerBtn = document.getElementById('close-college-pdf-viewer-modal');
  if (closePdfViewerBtn) {
    closePdfViewerBtn.onclick = () => {
      const viewerModal = document.getElementById('college-pdf-viewer-modal');
      const iframe = document.getElementById('college-pdf-iframe');
      if (viewerModal) viewerModal.style.display = 'none';
      if (iframe) iframe.src = 'about:blank'; // Unload PDF from memory
    };
  }
});

// ============================================================
// Profile picture (settings + sidebar avatar)
// ============================================================
window.applyProfilePic = function () {
  let url = localStorage.getItem('opennotes_profile_pic') || '';
  if (url && window.resolveFileUrl) url = window.resolveFileUrl(url);
  const initial = ((localStorage.getItem('userName') || 'H').trim().charAt(0) || 'H').toUpperCase();
  const set = (el) => {
    if (!el) return;
    if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('has-pic'); el.textContent = ''; }
    else { el.style.backgroundImage = ''; el.classList.remove('has-pic'); el.textContent = initial; }
  };
  set(document.getElementById('sidebar-profile-avatar'));
  set(document.getElementById('settings-avatar'));
  const rm = document.getElementById('profile-pic-remove');
  if (rm) rm.style.display = url ? '' : 'none';
};
// Crop editor: drag to position, wheel/slider to zoom, circular preview mask.
function openPicCropper(img) {
  const overlay = document.createElement('div');
  overlay.className = 'pic-crop-overlay';
  overlay.innerHTML = `
    <div class="pic-crop-card">
      <h4>Position your photo</h4>
      <p>Drag to move · scroll or slide to zoom</p>
      <div class="pic-crop-stage"><canvas width="340" height="340"></canvas><div class="pic-crop-mask"></div></div>
      <input type="range" class="pic-crop-zoom" min="1" max="4" step="0.01" value="1" />
      <div class="pic-crop-actions">
        <button class="pic-crop-cancel">Cancel</button>
        <button class="pic-crop-save">Save photo</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const canvas = overlay.querySelector('canvas'), ctx = canvas.getContext('2d');
  const zoomEl = overlay.querySelector('.pic-crop-zoom');
  const S = 340;
  // cover-fit base scale, then user zoom on top
  const base = Math.max(S / img.width, S / img.height);
  let zoom = 1, ox = 0, oy = 0; // offsets in canvas px

  function clampPan() {
    const w = img.width * base * zoom, h = img.height * base * zoom;
    ox = Math.min((w - S) / 2, Math.max(-(w - S) / 2, ox));
    oy = Math.min((h - S) / 2, Math.max(-(h - S) / 2, oy));
  }
  function draw() {
    clampPan();
    const w = img.width * base * zoom, h = img.height * base * zoom;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, S, S);
    ctx.drawImage(img, (S - w) / 2 + ox, (S - h) / 2 + oy, w, h);
  }
  draw();

  let dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
  const stage = overlay.querySelector('.pic-crop-stage');
  stage.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; sox = ox; soy = oy; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', (e) => { if (!dragging) return; ox = sox + (e.clientX - sx); oy = soy + (e.clientY - sy); draw(); });
  stage.addEventListener('pointerup', () => { dragging = false; });
  stage.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); zoomEl.value = zoom; draw(); }, { passive: false });
  zoomEl.addEventListener('input', () => { zoom = parseFloat(zoomEl.value); draw(); });

  const close = () => overlay.remove();
  overlay.querySelector('.pic-crop-cancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.pic-crop-save').onclick = async () => {
    // re-render the visible square at 512px
    const out = document.createElement('canvas'); out.width = out.height = 512;
    const octx = out.getContext('2d'); const k = 512 / S;
    const w = img.width * base * zoom, h = img.height * base * zoom;
    octx.fillStyle = '#111'; octx.fillRect(0, 0, 512, 512);
    octx.drawImage(img, ((S - w) / 2 + ox) * k, ((S - h) / 2 + oy) * k, w * k, h * k);
    try {
      const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
      if (window.electronAPI && window.electronAPI.saveBoardFile) {
        const buf = await blob.arrayBuffer();
        const p = await window.electronAPI.saveBoardFile('profile.jpg', buf);
        localStorage.setItem('opennotes_profile_pic', 'file:///' + String(p).replace(/\\/g, '/'));
      } else {
        const rd = new FileReader();
        await new Promise(res => { rd.onload = res; rd.readAsDataURL(blob); });
        localStorage.setItem('opennotes_profile_pic', rd.result);
      }
      window.applyProfilePic();
    } catch (_) {}
    close();
  };
}
window.uploadProfilePic = function (e) {
  const f = e.target && e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => { openPicCropper(img); URL.revokeObjectURL(url); };
  img.src = url;
  if (e.target) e.target.value = '';
};
window.removeProfilePic = function () { localStorage.removeItem('opennotes_profile_pic'); window.applyProfilePic(); };
window.applyProfilePic();

// ============================================================
// Mobile drawer sidebar (Android app + narrow windows)
// ============================================================
window.toggleMobileSidebar = function (force) {
  const open = force !== undefined ? !!force : !document.body.classList.contains('sidebar-open');
  document.body.classList.toggle('sidebar-open', open);
};
// Navigating from the drawer should close it (matches native app expectations)
document.addEventListener('click', (e) => {
  if (window.innerWidth > 820) return;
  if (!document.body.classList.contains('sidebar-open')) return;
  const nav = e.target.closest('.sidebar .nav-link, .sidebar button, .sidebar a');
  if (nav) setTimeout(() => window.toggleMobileSidebar(false), 120);
});

// ============================================================
// 🧘 Safe Haven — fullscreen 3D retreat with procedural ambience
// Real CSS-3D rooms: each seat is a camera pose (position + yaw),
// so switching seats genuinely turns you inside the space.
// ============================================================
(function () {
  const fsEl = document.getElementById('haven-fs');
  const world = document.getElementById('haven-world');
  if (!fsEl || !world) return;

  let theme = localStorage.getItem('opennotes_haven_theme') || 'cabin';
  let spot = parseInt(localStorage.getItem('opennotes_haven_spot') || '0', 10) || 0;
  let volume = parseFloat(localStorage.getItem('opennotes_haven_vol'));
  if (isNaN(volume)) volume = 0.5;
  let isOpen = false;

  const SUBS = {
    cabin: 'Fireplace crackling in a snowed-in log cabin.',
    beach: 'Waves rolling in under a warm sunset.',
    city: 'City lights from a quiet high-rise bed.'
  };

  // Camera pose per theme per seat. The world gets the INVERSE camera
  // transform: rotate first (turn in place), then translate (walk there).
  const CAMS = {
    cabin: [
      'rotateY(0deg) translate3d(0px, -70px, 130px)',      // armchair, facing the fireplace
      'rotateY(-58deg) translate3d(430px, -60px, 120px)',  // window nook — turned toward the left wall
      'rotateY(56deg) translate3d(-430px, -60px, 100px)'   // reading corner — turned toward the bookshelf
    ],
    beach: [
      'rotateY(0deg) translate3d(0px, -40px, 60px)',       // on the mat, facing the sea
      'rotateY(-46deg) rotateX(-4deg) translate3d(380px, -30px, 60px)',  // gazing down the shore (palm side)
      'rotateY(40deg) rotateX(-10deg) translate3d(-360px, -60px, 40px)'  // lying back, sky-watching
    ],
    city: [
      'rotateY(0deg) translate3d(0px, -50px, 60px)',       // in bed, facing the window wall
      'rotateY(-50deg) translate3d(390px, -40px, 110px)',  // bed edge, toward the lamp corner
      'rotateY(48deg) translate3d(-390px, -50px, 90px)'    // by the shelf wall, looking back across
    ]
  };

  // ---------- Scene builders ----------
  const tw = (x, y, r, color, d) => `<span class="haven-twinkle" style="position:absolute;left:${x}px;top:${y}px;width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${color};animation-delay:-${d}s"></span>`;

  function flameSvg(w, h, extra) {
    return `<svg class="hv-flame" style="width:${w}px;height:${h}px;${extra || ''}" viewBox="0 0 90 170" preserveAspectRatio="none">
      <path d="M45 168 C 12 128 22 84 45 20 C 68 84 78 128 45 168 Z" fill="#ff7a1a" opacity="0.95"/>
      <path d="M45 168 C 24 136 30 100 45 52 C 60 100 66 136 45 168 Z" fill="#ffb24d"/>
      <path d="M45 168 C 34 148 37 124 45 96 C 53 124 56 148 45 168 Z" fill="#ffe08a"/>
    </svg>`;
  }

  function candle(x, y, s, delay) {
    return `<div style="position:absolute;left:${x}px;top:${y}px;transform:scale(${s})">
      <div style="width:16px;height:44px;background:linear-gradient(90deg,#d8cdb2,#efe6d0 40%,#cfc3a6);border-radius:4px 4px 2px 2px"></div>
      <div class="hv-candle-fl" style="position:absolute;left:50%;top:-20px;width:10px;height:22px;margin-left:-5px;border-radius:50% 50% 45% 45%;background:radial-gradient(circle at 50% 78%,#fff3c4 12%,#ffcf6b 48%,#ff9a3d 82%,rgba(255,120,40,0));animation-delay:-${delay}s"></div>
      <div class="haven-glow" style="position:absolute;left:50%;top:-34px;width:64px;height:64px;margin-left:-32px;border-radius:50%;background:radial-gradient(circle,rgba(255,200,110,0.5),rgba(255,200,110,0) 70%)"></div>
    </div>`;
  }

  function bookRow(seed, count) {
    const cols = ['#8a4a3b', '#3e5f52', '#8a7440', '#4a5a7a', '#7a4a63', '#5a6a45', '#9a6a4a', '#44607a'];
    let out = '';
    for (let i = 0; i < count; i++) {
      const h = 52 + ((seed * 7 + i * 13) % 26);
      const w = 13 + ((seed * 5 + i * 11) % 9);
      const lean = (seed + i) % 7 === 3 ? 'transform:rotate(7deg);transform-origin:bottom left;' : '';
      out += `<div style="width:${w}px;height:${h}px;background:linear-gradient(90deg,${cols[(seed + i) % cols.length]},rgba(0,0,0,0.25));border-radius:2px 2px 0 0;${lean}box-shadow:inset -2px 0 3px rgba(0,0,0,0.35)"></div>`;
    }
    return `<div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;gap:3px;padding:0 10px">${out}</div>`;
  }

  function sceneCabin() {
    // Back wall — hearth centrepiece
    let lights = '';
    for (let i = 0; i < 12; i++) {
      const x = 90 + i * 130, y = 66 + Math.sin(i * 1.1) * 22;
      lights += `<div class="haven-twinkle" style="position:absolute;left:${x}px;top:${y}px;width:9px;height:9px;border-radius:50%;background:#ffcf6b;box-shadow:0 0 12px 3px rgba(255,200,100,0.55);animation-delay:-${(i * 0.45).toFixed(2)}s"></div>`;
    }
    const back = `
      <svg style="position:absolute;left:0;top:0;width:100%;height:130px" viewBox="0 0 1600 130" preserveAspectRatio="none"><path d="M0 40 Q 400 110 800 44 T 1600 40" fill="none" stroke="#241407" stroke-width="4"/></svg>${lights}
      <div class="hv-fire">
        <div class="glow"></div>
        <div class="stone"></div>
        <div class="mantel"></div>
        <div class="opening">
          ${flameSvg(150, 240, 'left:50%;bottom:20px;margin-left:-75px;position:absolute')}
          ${flameSvg(90, 150, 'left:50%;bottom:18px;margin-left:-70px;position:absolute;animation-duration:0.8s;opacity:0.85')}
          <div class="logs"></div>
          ${tw(60, 60, 2, '#ffb066', 0.4)}${tw(170, 40, 2, '#ffcf8a', 1.3)}
        </div>
        ${candle(52, -86, 1, 0.1)}${candle(310, -86, 0.85, 0.35)}
      </div>
      <div style="position:absolute;left:190px;top:250px;width:190px;height:150px;border:12px solid #5a3a22;border-radius:6px;background:linear-gradient(160deg,#26435a,#0e1e2e);box-shadow:0 12px 24px rgba(0,0,0,0.4)">
        <div style="position:absolute;bottom:12px;left:0;right:0;height:44px;background:linear-gradient(0deg,rgba(255,255,255,0.85),rgba(255,255,255,0));border-radius:0 0 3px 3px"></div>
        <div style="position:absolute;bottom:40px;left:20px;width:0;height:0;border-left:34px solid transparent;border-right:34px solid transparent;border-bottom:52px solid #1c3347"></div>
        <div style="position:absolute;bottom:40px;right:14px;width:0;height:0;border-left:42px solid transparent;border-right:42px solid transparent;border-bottom:66px solid #142838"></div>
        <div class="haven-twinkle" style="position:absolute;top:16px;right:22px;width:6px;height:6px;border-radius:50%;background:#fff"></div>
      </div>
      <div style="position:absolute;right:170px;top:230px;width:230px;height:210px">
        <div style="position:absolute;inset:0;background:linear-gradient(#4a2f1c,#3a2414);border-radius:6px;box-shadow:0 14px 26px rgba(0,0,0,0.45)"></div>
        <div style="position:absolute;left:12px;right:12px;top:12px;height:84px;background:#2c1a0f;border-radius:4px;overflow:hidden">${bookRow(3, 9)}</div>
        <div style="position:absolute;left:12px;right:12px;bottom:12px;height:84px;background:#2c1a0f;border-radius:4px;overflow:hidden">${bookRow(8, 8)}</div>
      </div>`;

    // Left wall — window with snowy night + lantern shelf
    const leftStars = tw(90, 90, 2, '#dfe8ff', 0.2) + tw(160, 140, 1.6, '#dfe8ff', 1.1) + tw(120, 210, 1.8, '#dfe8ff', 2.2) + tw(200, 100, 1.4, '#dfe8ff', 1.7) + tw(70, 170, 1.4, '#dfe8ff', 2.8);
    const left = `
      <div class="hv-cabin-window" style="left:34%;top:50%;margin-top:-170px;width:300px;height:340px">
        <div class="glass">
          ${leftStars}
          <div style="position:absolute;left:0;right:0;bottom:0;height:60px;background:linear-gradient(0deg,rgba(235,240,250,0.92),rgba(235,240,250,0));border-radius:0 0 6px 6px"></div>
          <div style="position:absolute;bottom:44px;left:30px;width:0;height:0;border-left:52px solid transparent;border-right:52px solid transparent;border-bottom:84px solid #16283c"></div>
          <div style="position:absolute;bottom:52px;right:20px;width:0;height:0;border-left:64px solid transparent;border-right:64px solid transparent;border-bottom:104px solid #0f1e30"></div>
          <div style="position:absolute;top:26px;right:40px;width:44px;height:44px;border-radius:50%;background:radial-gradient(circle,#f4f1e4 55%,rgba(244,241,228,0) 72%);box-shadow:0 0 34px 10px rgba(240,238,220,0.35)"></div>
        </div>
        <div class="frame"></div><div class="bar-v"></div><div class="bar-h"></div>
      </div>
      <div style="position:absolute;left:64%;top:52%;width:150px;height:14px;background:linear-gradient(#6b4526,#4a2f1c);border-radius:4px;box-shadow:0 10px 18px rgba(0,0,0,0.4)">
        <div style="position:absolute;left:20px;top:-58px;width:44px;height:58px;border:5px solid #2e2620;border-radius:8px 8px 4px 4px;background:linear-gradient(rgba(255,200,110,0.25),rgba(255,170,70,0.4))"></div>
        <div class="haven-glow" style="position:absolute;left:8px;top:-76px;width:96px;height:96px;border-radius:50%;background:radial-gradient(circle,rgba(255,190,100,0.55),rgba(255,190,100,0) 70%)"></div>
      </div>`;

    // Right wall — tall bookshelf + hanging plant
    const right = `
      <div style="position:absolute;left:30%;top:50%;margin-top:-235px;width:340px;height:470px">
        <div style="position:absolute;inset:0;background:linear-gradient(#4a2f1c,#38220f);border-radius:8px;box-shadow:0 18px 34px rgba(0,0,0,0.5)"></div>
        ${[0, 1, 2, 3].map(r => `<div style="position:absolute;left:14px;right:14px;top:${16 + r * 112}px;height:92px;background:#291809;border-radius:4px;overflow:hidden">${bookRow(r * 4 + 1, 10)}</div>`).join('')}
      </div>
      <div style="position:absolute;left:72%;top:24%">
        <div style="width:4px;height:90px;background:#241407;margin:0 auto"></div>
        <div style="width:64px;height:40px;background:linear-gradient(#7a5230,#5a3a22);border-radius:0 0 26px 26px"></div>
        <svg width="120" height="90" viewBox="0 0 120 90" style="margin:-14px 0 0 -28px"><g fill="none" stroke="#3f6a4a" stroke-width="5" stroke-linecap="round"><path d="M60 6 C 30 26 24 56 34 84"/><path d="M60 6 C 90 26 96 56 86 84"/><path d="M60 4 C 56 34 58 62 60 86"/></g></svg>
      </div>`;

    const floor = `
      <div style="position:absolute;left:50%;top:38%;width:760px;height:420px;margin-left:-380px;border-radius:50%;background:radial-gradient(ellipse,#8a3a34 0%,#7a2e2e 55%,rgba(122,46,46,0) 72%);box-shadow:inset 0 0 60px rgba(0,0,0,0.25)"></div>
      <div class="haven-glow" style="position:absolute;left:50%;top:8%;width:900px;height:520px;margin-left:-450px;background:radial-gradient(ellipse,rgba(255,150,60,0.38),rgba(255,150,60,0) 70%)"></div>`;

    const props = `
      <div class="hv-prop" style="width:340px;height:300px;margin-left:-170px;margin-top:-150px;transform:translate3d(300px,310px,300px) rotateY(-24deg)">
        <div style="position:absolute;left:24px;right:24px;top:0;height:190px;background:linear-gradient(#c8a06a,#a9834f);border-radius:26px 26px 10px 10px;box-shadow:inset 0 -14px 24px rgba(0,0,0,0.2)"></div>
        <div style="position:absolute;left:40px;right:40px;top:26px;height:110px;background:linear-gradient(#efe4cc,#dccdb0);border-radius:18px"></div>
        <div style="position:absolute;left:0;bottom:44px;width:74px;height:150px;background:linear-gradient(#b98f58,#96713d);border-radius:22px;box-shadow:6px 10px 18px rgba(0,0,0,0.3)"></div>
        <div style="position:absolute;right:0;bottom:44px;width:74px;height:150px;background:linear-gradient(#b98f58,#96713d);border-radius:22px;box-shadow:-6px 10px 18px rgba(0,0,0,0.3)"></div>
        <div style="position:absolute;left:30px;right:30px;bottom:16px;height:74px;background:linear-gradient(#c8a06a,#8f6c3c);border-radius:14px;box-shadow:0 18px 30px rgba(0,0,0,0.45)"></div>
      </div>
      <div class="hv-prop" style="width:150px;height:170px;margin-left:-75px;margin-top:-85px;transform:translate3d(60px,375px,420px) rotateY(14deg)">
        <div style="position:absolute;left:50%;top:0;width:110px;height:16px;margin-left:-55px;background:linear-gradient(#7a5230,#5a3a22);border-radius:50%/60%;box-shadow:0 16px 24px rgba(0,0,0,0.4)"></div>
        <div style="position:absolute;left:50%;top:14px;width:14px;height:110px;margin-left:-7px;background:linear-gradient(#5a3a22,#3a2414)"></div>
        <div style="position:absolute;left:50%;bottom:0;width:84px;height:14px;margin-left:-42px;background:#3a2414;border-radius:50%"></div>
        <div style="position:absolute;left:50%;top:-30px;margin-left:6px;width:34px;height:30px;background:linear-gradient(#e8ddc6,#cbbfa2);border-radius:5px 5px 10px 10px"></div>
        <div style="position:absolute;left:50%;top:-26px;margin-left:38px;width:12px;height:16px;border:4px solid #cbbfa2;border-left:none;border-radius:0 10px 10px 0"></div>
        ${tw(84, -46, 2.4, 'rgba(255,255,255,0.6)', 0.3)}${tw(92, -60, 2, 'rgba(255,255,255,0.45)', 1.4)}
      </div>`;

    const ceil = `<div class="haven-glow" style="position:absolute;left:50%;top:55%;width:700px;height:420px;margin-left:-350px;background:radial-gradient(ellipse,rgba(255,160,70,0.22),rgba(255,160,70,0) 70%)"></div>`;
    return { back, left, right, floor, ceil, props };
  }

  function sceneBeach() {
    const seaBand = (h) => `
      <div class="hv-sea" style="height:${h}px">
        <div class="shimmer"></div>
        <div class="hv-wave" style="top:18%"></div>
        <div class="hv-wave w2" style="top:44%"></div>
        <div class="hv-wave w3" style="top:70%"></div>
      </div>`;
    const clouds = `
      <div class="haven-drift" style="position:absolute;left:16%;top:14%;width:260px;height:54px;border-radius:60px;background:rgba(255,236,210,0.5);filter:blur(16px)"></div>
      <div class="haven-drift" style="position:absolute;left:56%;top:22%;width:340px;height:64px;border-radius:70px;background:rgba(255,220,190,0.42);filter:blur(20px);animation-duration:30s"></div>`;
    const back = `
      ${clouds}
      <div class="hv-sun" style="bottom:210px"></div>
      <svg class="haven-drift" style="position:absolute;left:24%;top:26%;animation-duration:26s" width="140" height="40" viewBox="0 0 140 40"><g stroke="#4a2a44" stroke-width="3" fill="none" stroke-linecap="round"><path d="M8 20 q 10 -9 20 0"/><path d="M28 20 q 10 -9 20 0"/><path d="M78 10 q 8 -7 16 0"/><path d="M94 10 q 8 -7 16 0"/></g></svg>
      <div style="position:absolute;right:14%;bottom:236px;width:220px;height:44px;border-radius:50% 50% 0 0/100% 100% 0 0;background:#5a3a5a;opacity:0.55"></div>
      ${seaBand(230)}`;
    const left = `${clouds}${seaBand(230)}`;
    const right = `${clouds}${seaBand(230)}`;
    const floor = `
      <div style="position:absolute;left:8%;top:12%;width:120px;height:60px;border-radius:50%;background:rgba(0,0,0,0.12);filter:blur(6px)"></div>
      <div class="hv-mat" style="left:50%;top:46%;width:460px;height:320px;margin-left:-230px;transform:rotate(-5deg)">
        <div style="position:absolute;inset:14px;border:3px dashed rgba(255,255,255,0.35);border-radius:8px"></div>
      </div>
      <div style="position:absolute;left:26%;top:38%;width:70px;height:44px;border-radius:50%;background:rgba(90,60,40,0.6)"></div>
      <div style="position:absolute;left:23%;top:41%;width:44px;height:30px;border-radius:50%;background:rgba(90,60,40,0.5)"></div>
      <div style="position:absolute;right:14%;top:30%;width:230px;height:120px;border-radius:50%;background:rgba(0,0,0,0.16);filter:blur(10px)"></div>`;
    const props = `
      <div class="hv-prop" style="width:420px;height:560px;margin-left:-210px;margin-top:-280px;transform:translate3d(-560px,180px,-120px) rotateY(20deg)">
        <svg width="420" height="560" viewBox="0 0 420 560">
          <path d="M210 560 C 196 420 200 300 210 190 C 216 300 222 420 226 560 Z" fill="url(#hvTrunk)"/>
          <defs><linearGradient id="hvTrunk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b4a2e"/><stop offset="0.5" stop-color="#4a3018"/><stop offset="1" stop-color="#3a2412"/></linearGradient></defs>
          <g fill="#1e3a28">
            <path d="M212 196 C 130 150 60 160 10 200 C 80 168 160 178 212 210 Z"/>
            <path d="M212 196 C 294 150 364 160 414 200 C 344 168 264 178 212 210 Z"/>
            <path d="M210 190 C 180 110 190 50 226 10 C 200 70 208 140 220 196 Z"/>
            <path d="M214 192 C 268 120 262 60 240 20 C 272 80 254 150 222 198 Z"/>
            <path d="M210 194 C 150 140 130 90 140 40 C 148 100 180 160 216 200 Z"/>
          </g>
          <circle cx="206" cy="216" r="13" fill="#5a3a1e"/><circle cx="230" cy="208" r="11" fill="#4a3018"/>
        </svg>
      </div>
      <div class="hv-prop" style="width:170px;height:130px;margin-left:-85px;margin-top:-65px;transform:translate3d(150px,395px,240px) rotateY(-14deg)">
        <div style="position:absolute;left:0;right:0;bottom:24px;height:74px;background:repeating-linear-gradient(90deg,#a5722f 0 16px,#8a5c22 16px 30px);border-radius:10px 10px 14px 14px;box-shadow:0 16px 26px rgba(0,0,0,0.3)"></div>
        <div style="position:absolute;left:-6px;right:-6px;bottom:92px;height:14px;background:#7a4f1c;border-radius:8px"></div>
        <div style="position:absolute;left:50%;bottom:100px;width:90px;height:44px;margin-left:-45px;border:9px solid #7a4f1c;border-bottom:none;border-radius:48px 48px 0 0"></div>
      </div>
      <div class="hv-prop" style="width:120px;height:80px;margin-left:-60px;margin-top:-40px;transform:translate3d(-190px,415px,300px) rotateY(20deg)">
        <div style="position:absolute;inset:8px 0;background:linear-gradient(#f4eee0,#ddd2ba);border-radius:6px;box-shadow:0 12px 20px rgba(0,0,0,0.28)"></div>
        <div style="position:absolute;left:50%;top:8px;bottom:8px;width:3px;background:rgba(0,0,0,0.15)"></div>
      </div>`;
    const ceil = clouds;
    return { back, left, right, floor, ceil, props };
  }

  function sceneCity() {
    function building(x, w, h, hue, litRatio, bi) {
      let wins = '';
      let wi = 0;
      for (let wy = 14; wy < h - 12; wy += 24) {
        for (let wx = 10; wx < w - 10; wx += 20) {
          const lit = ((bi * 7 + wi * 13) % 10) < litRatio * 10;
          const twk = lit && (bi + wi) % 9 === 0;
          wins += `<div ${twk ? 'class="haven-twinkle"' : ''} style="position:absolute;left:${wx}px;top:${wy}px;width:10px;height:13px;border-radius:1.5px;background:${lit ? hue : 'rgba(150,170,210,0.07)'};${twk ? `animation-delay:-${((wi % 5) * 0.8).toFixed(1)}s;` : ''}${lit ? 'box-shadow:0 0 7px rgba(255,210,140,0.28)' : ''}"></div>`;
          wi++;
        }
      }
      return `<div style="position:absolute;left:${x}px;bottom:0;width:${w}px;height:${h}px;background:linear-gradient(180deg,#151833,#0d1024);border-radius:4px 4px 0 0;box-shadow:inset 0 0 24px rgba(0,0,0,0.5)">${wins}</div>`;
    }
    const stars = [[70, 60], [190, 40], [320, 90], [470, 36], [620, 70], [780, 50], [930, 84], [1080, 44], [1230, 66], [1370, 96], [1470, 40]]
      .map((p, i) => tw(p[0], p[1], 1.6, '#fff', i * 0.6)).join('');
    const back = `
      <div class="hv-cityview">
        ${stars}
        <div style="position:absolute;right:16%;top:8%;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.32),rgba(255,255,255,0) 70%)"></div>
        <div style="position:absolute;right:16%;top:8%;width:64px;height:64px;margin:28px;border-radius:50%;background:#f2f0e6;box-shadow:inset -12px -8px 18px rgba(190,190,175,0.7)"></div>
        ${building(30, 150, 380, 'rgba(255,214,140,0.85)', 0.55, 1)}
        ${building(200, 110, 300, 'rgba(150,210,220,0.75)', 0.4, 2)}
        ${building(330, 180, 470, 'rgba(255,214,140,0.9)', 0.6, 3)}
        ${building(530, 130, 340, 'rgba(255,190,120,0.8)', 0.45, 4)}
        ${building(680, 200, 520, 'rgba(255,224,160,0.85)', 0.62, 5)}
        <div class="haven-twinkle" style="position:absolute;left:772px;bottom:524px;width:8px;height:8px;border-radius:50%;background:#ff5a5a;box-shadow:0 0 10px 3px rgba(255,80,80,0.6);animation-duration:2.1s"></div>
        ${building(910, 140, 400, 'rgba(160,200,230,0.75)', 0.5, 6)}
        ${building(1070, 170, 460, 'rgba(255,214,140,0.85)', 0.55, 7)}
        ${building(1260, 120, 320, 'rgba(255,190,120,0.8)', 0.42, 8)}
        ${building(1400, 160, 430, 'rgba(255,224,160,0.85)', 0.58, 9)}
        <div style="position:absolute;left:0;right:0;bottom:0;height:60px;background:linear-gradient(0deg,rgba(120,90,160,0.18),rgba(120,90,160,0))"></div>
      </div>
      <div class="hv-cityframe"><div class="mull" style="left:33%"></div><div class="mull" style="left:66%"></div></div>`;
    const left = `
      <div style="position:absolute;left:34%;top:22%;width:250px;height:170px;border:14px solid #100d1e;border-radius:6px;background:linear-gradient(140deg,#2a2145,#171230);box-shadow:0 16px 30px rgba(0,0,0,0.5)">
        <div style="position:absolute;left:14px;bottom:12px;width:110px;height:70px;background:linear-gradient(0deg,#e668a0,#8a5adf);opacity:0.7;border-radius:4px"></div>
        <div style="position:absolute;right:16px;top:14px;width:60px;height:60px;border-radius:50%;background:radial-gradient(circle,#ffd98a 30%,rgba(255,217,138,0) 70%)"></div>
      </div>
      <div style="position:absolute;left:30%;top:62%;width:320px;height:14px;background:#1c1730;border-radius:4px;box-shadow:0 12px 20px rgba(0,0,0,0.45)">
        ${bookRow(5, 7).replace('bottom:0', 'bottom:14px')}
      </div>`;
    const right = `
      <div style="position:absolute;left:30%;top:40%;width:190px;height:330px;background:linear-gradient(#241d3c,#181228);border:10px solid #100d1e;border-radius:10px;box-shadow:0 18px 34px rgba(0,0,0,0.5)">
        <div style="position:absolute;inset:12px;background:linear-gradient(160deg,rgba(120,140,200,0.16),rgba(20,20,40,0.1));border-radius:4px"></div>
      </div>
      <div class="hv-lamp-glow" style="left:56%;top:30%"></div>`;
    const floor = `
      <div style="position:absolute;left:50%;top:40%;width:820px;height:520px;margin-left:-410px;border-radius:26px;background:linear-gradient(160deg,#332a4d,#241d3c);box-shadow:inset 0 0 50px rgba(0,0,0,0.35)"></div>
      <div class="haven-glow" style="position:absolute;right:6%;top:26%;width:420px;height:360px;background:radial-gradient(ellipse,rgba(255,196,120,0.28),rgba(255,196,120,0) 70%)"></div>`;
    const props = `
      <div class="hv-prop" style="width:720px;height:300px;margin-left:-360px;margin-top:-150px;transform:translate3d(0px,310px,430px)">
        <div style="position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(#4b4168,#332a4d);border-radius:18px;box-shadow:0 26px 50px rgba(0,0,0,0.55)"></div>
        <div style="position:absolute;left:10px;right:10px;bottom:96px;height:110px;background:linear-gradient(170deg,#efeaf6,#cdc3e0);border-radius:22px 22px 30px 30px;box-shadow:inset 0 -18px 28px rgba(90,80,130,0.35)"></div>
        <div style="position:absolute;left:24px;right:24px;bottom:150px;height:52px;background:linear-gradient(#e2d9f0,#c4b8dd);border-radius:20px;transform:skewX(-2deg);box-shadow:inset 0 -10px 16px rgba(90,80,130,0.3)"></div>
        <div style="position:absolute;left:70px;bottom:186px;width:200px;height:64px;background:linear-gradient(#f6f2fb,#dcd3ec);border-radius:20px;transform:rotate(-4deg);box-shadow:0 8px 16px rgba(0,0,0,0.25)"></div>
        <div style="position:absolute;right:70px;bottom:186px;width:200px;height:64px;background:linear-gradient(#f6f2fb,#dcd3ec);border-radius:20px;transform:rotate(3deg);box-shadow:0 8px 16px rgba(0,0,0,0.25)"></div>
      </div>
      <div class="hv-prop" style="width:180px;height:250px;margin-left:-90px;margin-top:-125px;transform:translate3d(560px,335px,330px) rotateY(-18deg)">
        <div style="position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(#2c2444,#1e1834);border-radius:12px;box-shadow:0 18px 30px rgba(0,0,0,0.5)"></div>
        <div style="position:absolute;left:50%;bottom:118px;width:10px;height:60px;margin-left:-5px;background:#141024"></div>
        <div style="position:absolute;left:50%;bottom:170px;width:110px;height:56px;margin-left:-55px;background:linear-gradient(#ffd9a0,#f0b46a);border-radius:12px 12px 4px 4px;box-shadow:0 -6px 30px rgba(255,200,120,0.4)"></div>
        <div class="haven-glow" style="position:absolute;left:50%;bottom:120px;width:240px;height:200px;margin-left:-120px;border-radius:50%;background:radial-gradient(circle,rgba(255,200,120,0.5),rgba(255,200,120,0) 70%)"></div>
      </div>`;
    const ceil = `<div class="haven-glow" style="position:absolute;right:10%;top:30%;width:480px;height:380px;background:radial-gradient(ellipse,rgba(255,196,120,0.14),rgba(255,196,120,0) 70%)"></div>`;
    return { back, left, right, floor, ceil, props };
  }

  function buildScene() {
    const s = theme === 'beach' ? sceneBeach() : theme === 'city' ? sceneCity() : sceneCabin();
    world.innerHTML = `<div class="hv-sway"><div class="hv-room hv-${theme}">
      <div class="hv-face hv-back">${s.back}</div>
      <div class="hv-face hv-left">${s.left}</div>
      <div class="hv-face hv-right">${s.right}</div>
      <div class="hv-face hv-floor">${s.floor}</div>
      <div class="hv-face hv-ceil">${s.ceil}</div>
      ${s.props}
    </div></div>`;
  }

  function applyCam(instant) {
    const t = (CAMS[theme] || CAMS.cabin)[spot] || CAMS.cabin[0];
    if (instant) { world.style.transition = 'none'; world.style.transform = t; void world.offsetHeight; world.style.transition = ''; }
    else world.style.transform = t;
  }

  function syncUi() {
    const sub = document.getElementById('haven-sub'); if (sub) sub.textContent = SUBS[theme] || '';
    document.querySelectorAll('#haven-fs .haven-theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
    document.querySelectorAll('#haven-fs .haven-spot').forEach(b => b.classList.toggle('active', +b.dataset.spot === spot));
  }

  // ---------- Cursor parallax + auto-hide UI ----------
  let hideTimer = null, parallaxRaf = null, targetRx = 0, targetRy = 0, curRx = 0, curRy = 0;
  function pokeUi() {
    fsEl.classList.remove('hide-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => fsEl.classList.add('hide-ui'), 3000);
  }
  function onMove(e) {
    pokeUi();
    const w = window.innerWidth, h = window.innerHeight;
    targetRy = ((e.clientX / w) - 0.5) * 4;   // subtle look-around
    targetRx = ((e.clientY / h) - 0.5) * -2.5;
  }
  function parallaxLoop() {
    curRx += (targetRx - curRx) * 0.045;
    curRy += (targetRy - curRy) * 0.045;
    const sway = world.querySelector('.hv-sway');
    if (sway) sway.style.transform = `rotateX(${curRx.toFixed(3)}deg) rotateY(${curRy.toFixed(3)}deg)`;
    parallaxRaf = requestAnimationFrame(parallaxLoop);
  }
  function onKey(e) { if (e.key === 'Escape') window.closeHaven(); else pokeUi(); }

  // ---------- Public API ----------
  window.openHaven = function () {
    if (isOpen) return;
    isOpen = true;
    buildScene();
    applyCam(true);
    syncUi();
    fsEl.style.display = 'block';
    const vol = document.getElementById('haven-volume'); if (vol) vol.value = volume;
    startAudio();
    pokeUi();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('pointerdown', pokeUi);
    document.addEventListener('keydown', onKey);
    targetRx = targetRy = curRx = curRy = 0;
    parallaxLoop();
  };
  window.closeHaven = function () {
    if (!isOpen) return;
    isOpen = false;
    stopAudio();
    fsEl.style.display = 'none';
    world.innerHTML = '';
    clearTimeout(hideTimer);
    cancelAnimationFrame(parallaxRaf);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('pointerdown', pokeUi);
    document.removeEventListener('keydown', onKey);
  };
  window.setHavenTheme = function (t) {
    if (t === theme) return;
    theme = t; localStorage.setItem('opennotes_haven_theme', t);
    buildScene(); applyCam(true); syncUi();
    if (isOpen) startAudio();
  };
  window.setHavenSpot = function (s) {
    spot = s; localStorage.setItem('opennotes_haven_spot', String(s));
    syncUi(); applyCam(false);
  };
  window.setHavenVolume = function (v) {
    volume = parseFloat(v); localStorage.setItem('opennotes_haven_vol', String(volume));
    if (master) master.gain.value = volume;
  };
  window.stopHaven = function () { if (isOpen) window.closeHaven(); };

  // ---------- Procedural ambience (Web Audio; per-theme) ----------
  let actx = null, nodes = [], master = null, crackleTimer = null;
  function noiseBuf(sec) { const b = actx.createBuffer(1, Math.floor(actx.sampleRate * sec), actx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function stopAudio() {
    if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }
    nodes.forEach(n => { try { n.stop && n.stop(); } catch (_) {} try { n.disconnect && n.disconnect(); } catch (_) {} });
    nodes = []; master = null;
  }
  function startAudio() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
    if (actx.state === 'suspended') actx.resume();
    stopAudio();
    master = actx.createGain(); master.gain.value = volume; master.connect(actx.destination); nodes.push(master);
    if (theme === 'cabin') {
      const src = actx.createBufferSource(); src.buffer = noiseBuf(3); src.loop = true;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650;
      const g = actx.createGain(); g.gain.value = 0.2; src.connect(lp); lp.connect(g); g.connect(master); src.start(); nodes.push(src);
      const pop = () => {
        if (!actx || theme !== 'cabin' || !master) return;
        const s = actx.createBufferSource(); s.buffer = noiseBuf(0.06);
        const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850 + Math.random() * 2400; bp.Q.value = 1.5;
        const cg = actx.createGain(); const t = actx.currentTime;
        cg.gain.setValueAtTime(0.0001, t); cg.gain.exponentialRampToValueAtTime(0.22 + Math.random() * 0.4, t + 0.004); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        s.connect(bp); bp.connect(cg); cg.connect(master); s.start(); s.stop(t + 0.11);
        crackleTimer = setTimeout(pop, 40 + Math.random() * 340);
      };
      pop();
    } else if (theme === 'beach') {
      const src = actx.createBufferSource(); src.buffer = noiseBuf(4); src.loop = true;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 480;
      const g = actx.createGain(); g.gain.value = 0.3;
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.11;
      const lg = actx.createGain(); lg.gain.value = 0.22; lfo.connect(lg); lg.connect(g.gain);
      const src2 = actx.createBufferSource(); src2.buffer = noiseBuf(4); src2.loop = true;
      const hp2 = actx.createBiquadFilter(); hp2.type = 'bandpass'; hp2.frequency.value = 1600; hp2.Q.value = 0.6;
      const g2 = actx.createGain(); g2.gain.value = 0.05;
      const lfo2 = actx.createOscillator(); lfo2.frequency.value = 0.07;
      const lg2 = actx.createGain(); lg2.gain.value = 0.04; lfo2.connect(lg2); lg2.connect(g2.gain);
      src.connect(lp); lp.connect(g); g.connect(master);
      src2.connect(hp2); hp2.connect(g2); g2.connect(master);
      src.start(); src2.start(); lfo.start(); lfo2.start(); nodes.push(src, src2, lfo, lfo2);
    } else {
      const o1 = actx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = actx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 58.3;
      const g = actx.createGain(); g.gain.value = 0.09; o1.connect(g); o2.connect(g); g.connect(master);
      const src = actx.createBufferSource(); src.buffer = noiseBuf(4); src.loop = true;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3800;
      const ng = actx.createGain(); ng.gain.value = 0.011;
      const lfo = actx.createOscillator(); lfo.frequency.value = 0.05;
      const lg = actx.createGain(); lg.gain.value = 0.006; lfo.connect(lg); lg.connect(ng.gain);
      src.connect(hp); hp.connect(ng); ng.connect(master);
      o1.start(); o2.start(); src.start(); lfo.start(); nodes.push(o1, o2, src, lfo);
    }
  }
})();
