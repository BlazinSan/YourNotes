import './style.css'

// --- Data Persistence Override ---
const _originalSetItem = Storage.prototype.setItem;
const _originalGetItem = Storage.prototype.getItem;

Storage.prototype.setItem = function(key, value) {
  if (window.electronAPI && window.electronAPI.saveDataSync) {
    window.electronAPI.saveDataSync(key, value);
  }
  _originalSetItem.call(this, key, value);
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
      title: 'Welcome to OpenNotes',
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

  const panels = ['home-grid', 'home-graph', 'home-tasks', 'home-session', 'home-scratchpad', 'home-settings'];
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

  const navBtns = ['nav-dashboard-btn', 'nav-projects-btn', 'nav-tasks-btn', 'nav-session-btn', 'nav-scratchpad-btn', 'nav-settings-btn'];
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
  const tabs = ['todo', 'habits', 'goals', 'books'];
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
};

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
  if (totalEl) {
    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    totalEl.textContent = `₹${total.toFixed(2)}`;
  }
}

function renderExpenses() {
  const listEl = document.getElementById('expense-list');
  if (!listEl) return;
  
  listEl.innerHTML = '';
  
  expenses.forEach(e => {
    const div = document.createElement('div');
    div.style = "display: flex; gap: 8px; align-items: center;";
    div.innerHTML = `
      <input type="text" value="${e.title.replace(/"/g, '&quot;')}" onchange="editExpense(${e.id}, 'title', this.value)" style="flex: 2; padding: 6px 10px; border-radius: 6px; border: 1px solid transparent; font-family: inherit; font-size: 0.95rem; font-weight: 500; outline: none; background: transparent; transition: all 0.2s; color: var(--text-primary);" onfocus="this.style.background='#fff'; this.style.borderColor='var(--panel-border)';" onblur="this.style.background='transparent'; this.style.borderColor='transparent'; renderExpenses();" />
      <div style="flex: 1; position: relative;">
        <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-weight: 600; color: var(--text-secondary); pointer-events: none;">₹</span>
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
  
  if (name) localStorage.setItem('opennotes_profile_name', name);
  if (desig) localStorage.setItem('opennotes_profile_type', desig);
  localStorage.setItem('opennotes_theme', theme);
  
  applySettings();
};

window.applySettings = function() {
  const name = localStorage.getItem('opennotes_profile_name') || 'Amanda Smith';
  const desig = localStorage.getItem('opennotes_profile_type') || 'Professional Account';
  const theme = localStorage.getItem('opennotes_theme') || 'light';
  
  const nameEls = document.querySelectorAll('#sidebar-profile-name');
  const desigEls = document.querySelectorAll('#sidebar-profile-type');
  
  nameEls.forEach(el => el.textContent = name);
  desigEls.forEach(el => el.textContent = desig);
  
  if (theme === 'dark') {
    document.body.classList.add('theme-dark');
  } else {
    document.body.classList.remove('theme-dark');
  }
  
  const nameInput = document.getElementById('settings-name');
  const desigInput = document.getElementById('settings-designation');
  const themeInput = document.getElementById('settings-theme');
  
  if (nameInput) nameInput.value = name;
  if (desigInput) desigInput.value = desig;
  if (themeInput) themeInput.value = theme;
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

// Initial load
applySettings();

// -----------------------------------------
// MPRIS Integration & Notch Clock
// -----------------------------------------
function updateIslandClock() {
  const clockEl = document.getElementById('island-clock-time');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
setInterval(updateIslandClock, 1000);
updateIslandClock();

if (window.electronAPI && window.electronAPI.onMprisUpdate) {
  window.electronAPI.onMprisUpdate((data) => {
    const island = document.getElementById('dynamic-island');
    const titleEl = document.getElementById('mpris-title');
    const artistEl = document.getElementById('mpris-artist');
    const statusEl = document.getElementById('mpris-status');
    
    if (data.status === 'Stopped') {
      if (island) {
        island.classList.remove('state-music');
        island.classList.add('state-time');
      }
      return;
    }
    
    if (island) {
      island.classList.remove('state-time');
      island.classList.add('state-music');
    }
    
    if (titleEl) titleEl.textContent = data.title || 'Unknown Title';
    if (artistEl) artistEl.textContent = data.artist || 'Unknown Artist';
    
    if (statusEl) {
      const playBtn = document.getElementById('mpris-play-btn');
      if (data.status === 'Playing') {
        statusEl.innerHTML = '<div style="display:flex;gap:2px;align-items:flex-end;height:12px;"><div style="width:3px;height:100%;background:currentColor;animation:pulse 1s infinite"></div><div style="width:3px;height:60%;background:currentColor;animation:pulse 1s infinite 0.2s"></div><div style="width:3px;height:80%;background:currentColor;animation:pulse 1s infinite 0.4s"></div></div>';
        if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
      } else {
        statusEl.textContent = 'PAUSED';
        if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      }
    }
  });

  // Request the initial state in case music is already playing
  window.electronAPI.requestMprisState();

  // Attach control listeners securely
  const bindControls = () => {
    const prev = document.getElementById('mpris-prev-btn');
    const play = document.getElementById('mpris-play-btn');
    const next = document.getElementById('mpris-next-btn');
    
    if (prev && play && next) {
      prev.onclick = () => window.electronAPI.mprisControl('Previous');
      play.onclick = () => window.electronAPI.mprisControl('PlayPause');
      next.onclick = () => window.electronAPI.mprisControl('Next');
    } else {
      setTimeout(bindControls, 500);
    }
  };
  bindControls();
}
