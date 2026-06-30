import './style.css'

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
};

Storage.prototype.getItem = function(key) {
  if (window.electronAPI && window.electronAPI.loadDataSync) {
    const data = window.electronAPI.loadDataSync(key);
    if (data !== null) return data;
  }
  return _originalGetItem.call(this, key);
};
// ---------------------------------

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
    dashboardBanner.style.backgroundImage = `url(${savedBanner})`;
    updateBannerTextColor(savedBanner);
  }
  
  if (bannerUpload) {
    bannerUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          dashboardBanner.style.backgroundImage = `url(${dataUrl})`;
          updateBannerTextColor(dataUrl);
          try {
            localStorage.setItem('dashboardBanner', dataUrl);
          } catch (err) {
            console.warn('Banner image too large for localStorage', err);
          }
        };
        reader.readAsDataURL(file);
      }
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
  
  if (notes.length === 0) {
    const newNote = {
      id: Date.now().toString(),
      title: 'Welcome to YourNotes',
      body: 'This is your first note. Start typing...',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notes.push(newNote);
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

// Render Notes List
function renderNotesList(filterText = '') {
  notesListEl.innerHTML = '';
  
  const filteredNotes = notes.filter(note => {
    const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : '';
    return (note.title || '').toLowerCase().includes(filterText.toLowerCase()) || 
           (plainText || '').toLowerCase().includes(filterText.toLowerCase());
  });
  
  filteredNotes.sort((a, b) => b.updatedAt - a.updatedAt);
  
  if (filteredNotes.length === 0) {
    notesListEl.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-secondary); font-size:0.9rem;">No notes found</div>`;
    return;
  }
  
  filteredNotes.forEach(note => {
    const date = new Date(note.updatedAt);
    const dateString = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : 'No content...';
    
    const div = document.createElement('div');
    div.className = `note-item ${note.id === activeNoteId ? 'active' : ''}`;
    div.onclick = () => setActiveNote(note.id);
    
    div.innerHTML = `
      <div class="note-item-title">${note.title || 'Untitled Note'}</div>
      <div class="note-item-preview">${plainText}</div>
      <div class="note-item-date">${dateString}</div>
    `;
    
    notesListEl.appendChild(div);
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

function renderHomeGrid(searchTerm = '') {
  if (!homeGrid) return;
  homeGrid.innerHTML = '';
  
  // Add the "Create New Note" Card first
  const newCard = document.createElement('div');
  newCard.className = 'book-card new-note-card';
  newCard.onclick = () => createNote('', '');
  newCard.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
    <div style="font-size: 1.2rem; font-weight: 600;">Create New Note</div>
  `;
  
  if (!searchTerm) {
    homeGrid.appendChild(newCard);
  }
  
  if (notes.length === 0) return;
  
  const term = searchTerm.toLowerCase();
  const filteredNotes = notes.filter(n => {
    const title = (n.title || '').toLowerCase();
    const body = (n.body || '').toLowerCase();
    return title.includes(term) || body.includes(term);
  });
  
  if (filteredNotes.length === 0 && searchTerm) {
    const noResults = document.createElement('div');
    noResults.style.cssText = 'color: var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 40px; font-size: 1.1rem;';
    noResults.textContent = 'No notes found matching your search.';
    homeGrid.appendChild(noResults);
    return;
  }
  
  filteredNotes.sort((a, b) => b.updatedAt - a.updatedAt).forEach(note => {
    const date = new Date(note.updatedAt);
    const dateString = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const plainText = note.body ? note.body.replace(/<[^>]*>?/gm, '') : 'No content...';
    
    const card = document.createElement('div');
    card.className = 'book-card';
    card.onclick = () => setActiveNote(note.id);
    card.oncontextmenu = (e) => {
      e.preventDefault();
      showCollegeContextMenu('note', note.id, e.clientX, e.clientY);
    };
    
    card.innerHTML = `
      <div class="book-card-title">${note.title || 'Untitled Note'}</div>
      <div class="book-card-date">${dateString}</div>
    `;
    
    homeGrid.appendChild(card);
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
  saveNotes();
  if (notes.length > 0) {
    setActiveNote(notes[0].id);
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
      showPanel('home-grid', 'nav-projects-btn');
      viewGridBtn.classList.add('active');
      if (graphAnimationFrame) cancelAnimationFrame(graphAnimationFrame);
    });
  }
  
  if (viewGraphBtn) {
    viewGraphBtn.addEventListener('click', () => {
      currentHomeView = 'graph';
      showPanel('home-graph', 'nav-projects-btn');
      viewGraphBtn.classList.add('active');
      initGraph();
    });
  }

window.showPanel = function(panelId, btnId) {
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

  const panels = ['home-grid', 'home-graph', 'home-tasks', 'home-session', 'home-scratchpad', 'home-settings', 'home-college'];
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

  const navBtns = ['nav-dashboard-btn', 'nav-projects-btn', 'nav-tasks-btn', 'nav-session-btn', 'nav-scratchpad-btn', 'nav-settings-btn', 'nav-college-btn'];
  navBtns.forEach(b => {
    const el = document.getElementById(b);
    if (el) el.classList.remove('active');
  });

  const viewGridBtnEl = document.getElementById('view-grid-btn');
  const viewGraphBtnEl = document.getElementById('view-graph-btn');
  if (viewGridBtnEl) viewGridBtnEl.classList.remove('active');
  if (viewGraphBtnEl) viewGraphBtnEl.classList.remove('active');

  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }
};

// Unified "Back" target for every panel — returns to the Projects/dashboard grid
window.goToDashboard = function() {
  setActiveNote(null);
  currentHomeView = 'grid';
  showPanel('home-grid', 'nav-projects-btn');
  const g = document.getElementById('view-grid-btn');
  if (g) g.classList.add('active');
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
  
  const rect = homeGraph.getBoundingClientRect();
  graphCanvas.width = rect.width;
  graphCanvas.height = rect.height;
  
  const gNodes = notes.map(n => ({
    id: n.id,
    title: n.title || 'Untitled',
    x: Math.random() * rect.width,
    y: Math.random() * rect.height,
    vx: 0,
    vy: 0,
    radius: 30
  }));
  
  const gEdges = [];
  notes.forEach(n => {
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
    node.radius = 12 + Math.min(connections * 3, 20);
  });
  
  const repelDist = 250;
  const repelForce = 1.2;
  const linkDist = 150;
  const linkForce = 0.08;
  const centerForce = 0.03;
  const friction = 0.85;
  
  let draggedNode = null;
  let hoveredNode = null;
  
  graphCanvas.onmousedown = (e) => {
    const r = graphCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    
    for (let i = gNodes.length - 1; i >= 0; i--) {
      const n = gNodes[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (Math.sqrt(dx*dx + dy*dy) <= n.radius) {
        draggedNode = n;
        hoveredNode = n;
        break;
      }
    }
  };
  
  graphCanvas.onmousemove = (e) => {
    const r = graphCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    
    if (draggedNode) {
      draggedNode.x = mx;
      draggedNode.y = my;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }
    
    hoveredNode = null;
    for (let i = gNodes.length - 1; i >= 0; i--) {
      const n = gNodes[i];
      const dx = mx - n.x;
      const dy = my - n.y;
      if (Math.sqrt(dx*dx + dy*dy) <= n.radius) {
        hoveredNode = n;
        break;
      }
    }
    
    graphCanvas.style.cursor = hoveredNode ? 'grab' : 'default';
  };
  
  window.addEventListener('mouseup', () => {
    draggedNode = null;
  });
  
  graphCanvas.ondblclick = (e) => {
    const r = graphCanvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    for (let n of gNodes) {
      const dx = mx - n.x;
      const dy = my - n.y;
      if (Math.sqrt(dx*dx + dy*dy) <= n.radius) {
        setActiveNote(n.id);
        break;
      }
    }
  };

  if (graphAnimationFrame) cancelAnimationFrame(graphAnimationFrame);

  function draw() {
    ctx.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
    
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

    gNodes.forEach(n => {
      if (n !== draggedNode) {
        n.vx += (graphCanvas.width/2 - n.x) * centerForce;
        n.vy += (graphCanvas.height/2 - n.y) * centerForce;
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= friction;
        n.vy *= friction;
      }
    });
    
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
      
      ctx.strokeStyle = `rgba(168, 123, 81, ${edge.currentAlpha})`;
      
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
      ctx.fillStyle = '#f9f6f3';
      ctx.fill();
      
      // Draw actual node with interpolated alpha
      ctx.globalAlpha = n.currentAlpha;
      
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#a87b51';
      ctx.stroke();
      
      ctx.fillStyle = '#4a3c31';
      ctx.font = '600 13px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let txt = n.title;
      if (txt.length > 24) txt = txt.substring(0, 22) + '...';
      
      if (n.currentAlpha > 0.4) {
        ctx.shadowColor = 'white';
        ctx.shadowBlur = 4;
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(255, 255, 255, 0.8)`;
        ctx.strokeText(txt, n.x, n.y + n.radius + 8);
        ctx.shadowBlur = 0;
      }
      
      ctx.fillText(txt, n.x, n.y + n.radius + 8);
      ctx.globalAlpha = 1.0; // Reset
    });
    
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
// Scratchpad Logic
// -----------------------------------------
const scratchpadEl = document.getElementById('scratchpad-content');
if (scratchpadEl) {
  const savedData = localStorage.getItem('opennotes_scratchpad');
  if (savedData) {
    scratchpadEl.innerHTML = savedData;
  }
  scratchpadEl.addEventListener('input', () => {
    localStorage.setItem('opennotes_scratchpad', scratchpadEl.innerHTML);
  });
}

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

function renderQuicklinks() {
  const container = document.getElementById('quicklinks-container');
  if (!container) return;
  container.innerHTML = '';
  quicklinks.forEach(q => {
    let targetUrl = q.url.startsWith('http') ? q.url : 'https://' + q.url;
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
      <button onclick="deleteQuicklink(event, ${q.id})" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1.1rem; opacity: 0; transition: opacity 0.2s; display: flex; align-items: center;" class="quicklink-del">&times;</button>
    `;
    a.onmouseenter = () => {
      const btn = a.querySelector('.quicklink-del');
      if (btn) btn.style.opacity = '1';
    };
    a.onmouseleave = () => {
      const btn = a.querySelector('.quicklink-del');
      if (btn) btn.style.opacity = '0';
    };
    container.appendChild(a);
  });
}

renderQuicklinks();

// -----------------------------------------
// Settings Logic
// -----------------------------------------
window.saveSettings = function() {
  const name = document.getElementById('settings-name').value.trim();
  const desig = document.getElementById('settings-designation').value.trim();
  const theme = document.getElementById('settings-theme').value;
  const currency = document.getElementById('settings-currency').value;
  const language = document.getElementById('settings-language').value;
  const tempUnit = document.getElementById('settings-temp-unit').value;

  if (name) localStorage.setItem('opennotes_profile_name', name);
  if (desig) localStorage.setItem('opennotes_profile_type', desig);
  localStorage.setItem('opennotes_theme', theme);
  localStorage.setItem('opennotes_currency', currency);
  localStorage.setItem('opennotes_language', language);
  localStorage.setItem('opennotes_temp_unit', tempUnit);

  applySettings();
};

window.applySettings = function() {
  // Harmonize with onboarding keys (userName/userRole) so the name set during onboarding sticks.
  const name = localStorage.getItem('opennotes_profile_name') || localStorage.getItem('userName') || 'Guest';
  const desig = localStorage.getItem('opennotes_profile_type') || localStorage.getItem('userRole') || 'Job';
  const theme = localStorage.getItem('opennotes_theme') || 'light';
  const currency = localStorage.getItem('opennotes_currency') || '₹';
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

  populateCurrencies(currency);

  const nameInput = document.getElementById('settings-name');
  const desigInput = document.getElementById('settings-designation');
  const themeInput = document.getElementById('settings-theme');
  const currencyInput = document.getElementById('settings-currency');
  const languageInput = document.getElementById('settings-language');
  const tempInput = document.getElementById('settings-temp-unit');

  if (nameInput) nameInput.value = name;
  if (desigInput) desigInput.value = desig;
  if (themeInput) themeInput.value = theme;
  if (currencyInput) currencyInput.value = currency;
  if (languageInput) languageInput.value = language;
  if (tempInput) tempInput.value = tempUnit;

  const newExpenseAmount = document.getElementById('new-expense-amount');
  if (newExpenseAmount) newExpenseAmount.placeholder = `Amount (${currency})`;

  applyLanguage(language);
  updateAmbientTemp();
  updateExpenseTotal();
  renderExpenses();
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

function populateCurrencies(selected) {
  const sel = document.getElementById('settings-currency');
  if (!sel) return;
  if (!sel.dataset.filled) {
    const frag = document.createDocumentFragment();
    CURRENCIES.forEach(([code, name, symbol]) => {
      const opt = document.createElement('option');
      opt.value = symbol;
      opt.textContent = `${name} (${code}) ${symbol}`;
      frag.appendChild(opt);
    });
    sel.appendChild(frag);
    sel.dataset.filled = '1';
  }
  if (selected) sel.value = selected;
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
    'settings.currency':'Currency','settings.reset':'⚠️ Factory Reset','settings.reset_note':'This will permanently delete all data.',
    'college.title':'College Notes','college.subtitle':'Organize your college lectures, curriculum, and study PDF notes.',
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
    'settings.currency':'العملة','settings.reset':'⚠️ إعادة ضبط المصنع','settings.reset_note':'سيؤدي هذا إلى حذف جميع البيانات نهائيًا.',
    'college.title':'ملاحظات الكلية','college.subtitle':'نظّم محاضرات كليتك ومناهجك وملاحظات الدراسة بصيغة PDF.',
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
    'settings.currency':'货币','settings.reset':'⚠️ 恢复出厂设置','settings.reset_note':'这将永久删除所有数据。',
    'college.title':'课堂笔记','college.subtitle':'整理你的大学讲座、课程和学习 PDF 笔记。',
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
    'settings.currency':'Mata Wang','settings.reset':'⚠️ Set Semula Kilang','settings.reset_note':'Ini akan memadam semua data secara kekal.',
    'college.title':'Nota Kolej','college.subtitle':'Susun kuliah, kurikulum dan nota PDF pembelajaran kolej anda.',
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

function setLofiIcon(playing) {
  const btn = document.getElementById('lofi-toggle');
  if (!btn) return;
  btn.innerHTML = playing
    ? '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
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
  const np = document.getElementById('lofi-now-playing');
  if (np) np.textContent = sel.options[sel.selectedIndex].text;
  if (lofiPlaying) { audio.volume = lofiVol(); audio.play().catch(() => {}); }
};

window.setLofiVolume = function(v) { const a = lofiEl(); if (a) a.volume = parseFloat(v); };

window.loadLofiFile = function(e) {
  const file = e.target.files[0];
  const audio = lofiEl();
  if (!file || !audio) return;
  audio.src = URL.createObjectURL(file);
  const np = document.getElementById('lofi-now-playing');
  if (np) np.textContent = file.name;
  audio.volume = lofiVol();
  audio.play().then(() => { lofiPlaying = true; setLofiIcon(true); }).catch(() => {});
};

// Initial load
applySettings();

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
      iframe.src = pdf.data;
    }
    modal.style.display = 'flex';
  }
};

function showCollegeContextMenu(type, id, x, y) {
  contextTargetType = type;
  contextTargetId = id;

  const menu = document.getElementById('college-context-menu');
  if (!menu) return;

  // Toggle Add to Folder wrapper visibility
  const addToFolderWrapper = document.getElementById('context-add-to-folder-wrapper');
  if (addToFolderWrapper) {
    if (type === 'note') {
      addToFolderWrapper.style.display = 'block';
      // Dynamically populate sub-menu folders list
      const submenu = document.getElementById('college-context-submenu');
      if (submenu) {
        submenu.innerHTML = '';
        if (collegeFolders.length === 0) {
          submenu.innerHTML = `<div style="padding: 8px 12px; color: var(--text-secondary); font-size: 0.85rem; text-align: center; white-space: nowrap;">No folders created</div>`;
        } else {
          collegeFolders.forEach(folder => {
            const item = document.createElement('button');
            item.className = 'context-item';
            item.style.cssText = 'background: transparent; border: none; padding: 8px 12px; border-radius: 6px; font-family: inherit; font-size: 0.85rem; text-align: left; color: var(--text-primary); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; width: 100%; transition: background 0.15s;';
            item.textContent = folder.name;
            item.onclick = (e) => {
              e.stopPropagation();
              addNoteToCollegeFolder(id, folder.id);
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
  const contextDeleteBtn = document.getElementById('context-delete-btn');

  if (contextOpenBtn) {
    contextOpenBtn.onclick = () => {
      if (contextMenu) contextMenu.style.display = 'none';
      if (contextTargetType === 'folder') {
        window.openCollegeFolder(contextTargetId);
      } else if (contextTargetType === 'pdf') {
        window.viewCollegePDF(contextTargetId);
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
      } else if (contextTargetType === 'note') {
        const note = notes.find(n => n.id === contextTargetId);
        if (note) {
          const newTitle = prompt("Rename Note:", note.title || 'Untitled Note');
          if (newTitle !== null) {
            const trimmed = newTitle.trim();
            if (trimmed) {
              note.title = trimmed;
              note.updatedAt = Date.now();
              saveNotes();
              renderHomeGrid();
              renderNotesList();
            }
          }
        }
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
      } else if (contextTargetType === 'note') {
        const note = notes.find(n => n.id === contextTargetId);
        if (note) {
          if (confirm(`Are you sure you want to delete the note "${note.title || 'Untitled Note'}"?`)) {
            notes = notes.filter(n => n.id !== contextTargetId);
            saveNotes();
            if (activeNoteId === contextTargetId) {
              if (notes.length > 0) {
                setActiveNote(notes[0].id);
              } else {
                setActiveNote(null);
              }
            }
            renderHomeGrid();
            renderNotesList();
          }
        }
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

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.type !== 'application/pdf') {
        alert("Only PDF files are supported.");
        return;
      }

      // Show a loading text or disable button during load
      uploadBtn.disabled = true;
      const originalText = uploadBtn.innerHTML;
      uploadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" class="spin"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg> Importing...`;

      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64Data = evt.target.result;
        const sizeFormatted = (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        const currentFolder = collegeFolders.find(f => f.id === activeCollegeFolderId);
        if (currentFolder) {
          if (!currentFolder.pdfs) currentFolder.pdfs = [];
          currentFolder.pdfs.push({
            id: 'pdf-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9),
            name: file.name,
            data: base64Data,
            size: sizeFormatted,
            createdAt: Date.now()
          });

          saveCollegeFolders();
          renderCollegeSingleFolder(activeCollegeFolderId);
        }

        // Reset button state
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalText;
      };

      reader.onerror = () => {
        alert("Failed to read file.");
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = originalText;
      };

      reader.readAsDataURL(file);
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
