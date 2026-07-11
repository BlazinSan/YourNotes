const CAPTURES_KEY = 'yn_quick_captures';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'yn-save-selection',
    title: 'Save selection to YourNotes',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'yn-save-page',
    title: 'Save page to YourNotes',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const state = await chrome.storage.local.get(CAPTURES_KEY);
  const captures = Array.isArray(state[CAPTURES_KEY]) ? state[CAPTURES_KEY] : [];
  const text = info.menuItemId === 'yn-save-selection'
    ? String(info.selectionText || '').trim()
    : String(info.linkUrl || tab?.url || '').trim();
  if (!text) return;
  captures.unshift({
    id: crypto.randomUUID(),
    text,
    title: String(tab?.title || 'Browser capture'),
    url: String(tab?.url || ''),
    createdAt: Date.now(),
    done: false,
  });
  await chrome.storage.local.set({ [CAPTURES_KEY]: captures.slice(0, 100) });
  chrome.action.setBadgeText({ text: String(Math.min(captures.length, 99)) });
  chrome.action.setBadgeBackgroundColor({ color: '#b6814c' });
});
