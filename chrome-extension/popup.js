const KEY = 'yn_quick_captures';
const RELEASE = 'https://github.com/BlazinSan/YourNotes/releases/latest';
const capture = document.querySelector('#capture');
let captures = [];
let timer = 25 * 60;
let timerId = 0;

async function persist() {
  await chrome.storage.local.set({ [KEY]: captures.slice(0, 100) });
  chrome.action.setBadgeText({ text: captures.length ? String(Math.min(captures.length, 99)) : '' });
  render();
}

function render() {
  const list = document.querySelector('#recent-list');
  list.replaceChildren();
  document.querySelector('#count').textContent = captures.length;
  document.querySelector('#empty').hidden = captures.length > 0;
  document.querySelector('#copy-all').hidden = captures.length === 0;
  captures.forEach(item => {
    const row = document.createElement('article'); row.className = `capture-item${item.done ? ' done' : ''}`;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!item.done; check.title = 'Mark complete';
    const content = document.createElement('div');
    const text = document.createElement('p'); text.textContent = item.text;
    const meta = document.createElement('small'); meta.textContent = `${item.title || 'Quick capture'} · ${new Date(item.createdAt).toLocaleDateString()}`;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Delete capture';
    content.append(text, meta); row.append(check, content, remove); list.append(row);
    check.onchange = () => { item.done = check.checked; persist(); };
    remove.onclick = () => { captures = captures.filter(value => value.id !== item.id); persist(); };
  });
}

async function currentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || {};
}

async function saveCapture() {
  const text = capture.value.trim();
  if (!text) { capture.focus(); return; }
  const tab = await currentPage();
  captures.unshift({ id: crypto.randomUUID(), text, title: tab.title || 'Quick capture', url: tab.url || '', createdAt: Date.now(), done: false, task: document.querySelector('#as-task').checked });
  capture.value = ''; document.querySelector('#as-task').checked = false;
  document.querySelector('#status').textContent = 'Saved to Quick Portal';
  await persist();
  setTimeout(() => { document.querySelector('#status').textContent = ''; }, 1500);
}

document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-tab]').forEach(tab => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
});
document.querySelector('#save').onclick = saveCapture;
capture.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') saveCapture(); });
document.querySelector('#attach-page').onclick = async () => { const tab = await currentPage(); capture.value += `${capture.value ? '\n' : ''}${tab.title || 'Current page'}\n${tab.url || ''}`; capture.focus(); };
document.querySelector('#copy-all').onclick = () => navigator.clipboard.writeText(captures.map(item => `${item.task ? '[ ] ' : ''}${item.text}`).join('\n\n'));
document.querySelector('#full-app').onclick = () => chrome.tabs.create({ url: RELEASE });
document.querySelectorAll('[data-full-feature]').forEach(button => button.onclick = () => chrome.tabs.create({ url: RELEASE }));
document.querySelector('#theme').onclick = async () => { document.documentElement.classList.toggle('dark'); await chrome.storage.local.set({ yn_quick_dark: document.documentElement.classList.contains('dark') }); };
function paintTimer() { const m = Math.floor(timer / 60), s = timer % 60; document.querySelector('#clock').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
document.querySelector('#timer-toggle').onclick = event => { if (timerId) { clearInterval(timerId); timerId = 0; event.currentTarget.textContent = 'Start'; return; } event.currentTarget.textContent = 'Pause'; timerId = setInterval(() => { timer = Math.max(0, timer - 1); paintTimer(); if (!timer) { clearInterval(timerId); timerId = 0; document.querySelector('#timer-toggle').textContent = 'Start'; } }, 1000); };
document.querySelector('#timer-reset').onclick = () => { clearInterval(timerId); timerId = 0; timer = 25 * 60; document.querySelector('#timer-toggle').textContent = 'Start'; paintTimer(); };

(async () => { const state = await chrome.storage.local.get([KEY, 'yn_quick_dark']); captures = Array.isArray(state[KEY]) ? state[KEY] : []; document.documentElement.classList.toggle('dark', !!state.yn_quick_dark); render(); capture.focus(); })();
