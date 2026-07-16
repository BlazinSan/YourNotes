const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(process.env.UI_QA_OUT || path.join(process.cwd(), '.ai-cache', 'ui-qa-v012'));
fs.mkdirSync(outDir, { recursive: true });
app.setPath('userData', path.join(outDir, 'profile'));
app.on('window-all-closed', event => event.preventDefault());

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sampleNotes = [
  { id: '1', title: 'Research · Sources', body: '<p>Reading list</p><span class="note-link" data-id="2">Plan</span>', createdAt: 1, updatedAt: 6, order: 1 },
  { id: '2', title: 'Research · Plan', body: '<p>Research plan</p><span class="note-link" data-id="3">Build</span>', createdAt: 2, updatedAt: 5, order: 2 },
  { id: '3', title: 'Launch · Build', body: '<p>Release build</p><span class="note-link" data-id="4">Checklist</span>', createdAt: 3, updatedAt: 4, order: 3 },
  { id: '4', title: 'Launch · Checklist', body: '<p>Launch checklist</p><span class="note-link" data-id="5">Budget</span>', createdAt: 4, updatedAt: 3, order: 4 },
  { id: '5', title: 'Personal · Budget', body: '<p>Monthly budget</p><span class="note-link" data-id="1">Sources</span>', createdAt: 5, updatedAt: 2, order: 5 },
];

function dateKey(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const moodHistory = Object.fromEntries([
  [0, '😊', 'A focused and calm day.'], [2, '😐', 'Steady progress.'], [5, '😔', 'Needed more rest.'],
  [8, '😊', 'Finished the draft.'], [13, '😫', 'A demanding day.'], [20, '😊', 'Good momentum.'], [29, '😐', 'Planning day.'],
].map(([ago, mood, text]) => [dateKey(ago), { mood, text, savedAt: Date.now() - ago * 86400000 }]));

async function makeWindow(width, height, baseUrl) {
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false } });
  try {
    await win.loadURL(baseUrl);
  } catch (error) {
    // Chromium can report ERR_FAILED when the app's startup navigation is
    // superseded even though the document completed. Verify the actual page
    // state before treating it as a failed QA launch.
    await wait(350);
    const loaded = await win.webContents.executeJavaScript(`document.readyState !== 'loading' && !!document.getElementById('home-page')`).catch(() => false);
    if (!loaded) throw error;
  }
  await win.webContents.executeJavaScript(`
    localStorage.setItem('opennotes_initialized','1');
    localStorage.setItem('userName','QA User');
    localStorage.setItem('userRole','Student');
    localStorage.setItem('opennotes_data',${JSON.stringify(JSON.stringify(sampleNotes))});
    localStorage.setItem('opennotes_expanded_project_groups','["Research","Launch","Personal"]');
    localStorage.setItem('opennotes_sidebar_expanded_groups','["Research","Launch","Personal"]');
    localStorage.setItem('opennotes_mood_history',${JSON.stringify(JSON.stringify(moodHistory))});
  `);
  await win.reload();
  await wait(300);
  return win;
}

async function run() {
  const report = { issues: [], checks: {} };
  const baseUrl = process.env.UI_QA_URL || 'http://127.0.0.1:5190/';

  const phone = await makeWindow(390, 844, baseUrl);
  await phone.webContents.executeJavaScript(`showPanel('home-session','nav-session-btn')`);
  await wait(350);
  report.checks.phone = await phone.webContents.executeJavaScript(`(() => {
    const grid = document.getElementById('mood-heatmap');
    const textarea = document.getElementById('journal-textarea');
    const cells = [...document.querySelectorAll('.mood-day-mobile')];
    const r = grid.getBoundingClientRect();
    const tr = textarea.getBoundingClientRect();
    return { columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length, cells:cells.length, gridWidth:r.width,
      viewport:innerWidth, textareaHeight:tr.height, bodyOverflow:document.documentElement.scrollWidth-innerWidth,
      todayText:textarea.value, minTap:Math.min(...cells.map(x=>x.getBoundingClientRect().height)) };
  })()`);
  if (report.checks.phone.columns !== 7 || report.checks.phone.cells !== 35) report.issues.push('Phone mood history is not a 7-column, 35-day calendar.');
  if (report.checks.phone.textareaHeight < 104) report.issues.push('Phone journal field is too short.');
  if (report.checks.phone.minTap < 44) report.issues.push('Phone mood-day targets are below 44px.');
  if (report.checks.phone.bodyOverflow > 1) report.issues.push('Phone session page overflows horizontally.');
  if (report.checks.phone.todayText) report.issues.push('Previously saved journal text remains in the entry field.');
  fs.writeFileSync(path.join(outDir, 'phone-mood.png'), (await phone.webContents.capturePage()).toPNG());
  phone.destroy();

  const desktop = await makeWindow(1440, 900, baseUrl);
  await desktop.webContents.executeJavaScript(`window.showPanel('home-graph','nav-projects-btn'); document.getElementById('view-graph-btn').click()`);
  await wait(1500);
  report.checks.graph = await desktop.webContents.executeJavaScript(`(() => {
    const items=[...document.querySelectorAll('#graph-project-legend span')];
    const canvas=document.getElementById('graph-canvas');
    return { labels:items.map(x=>x.textContent.trim()), colors:items.map(x=>getComputedStyle(x.querySelector('i')).backgroundColor), canvas:[canvas.width,canvas.height] };
  })()`);
  if (new Set(report.checks.graph.colors).size !== report.checks.graph.labels.length) report.issues.push('Graph folder colors are not unique.');
  if (report.checks.graph.labels.length !== 3) report.issues.push('Graph legend does not list every project folder.');
  fs.writeFileSync(path.join(outDir, 'desktop-graph.png'), (await desktop.webContents.capturePage()).toPNG());

  await desktop.webContents.executeJavaScript(`document.getElementById('new-note-btn').click()`);
  await wait(250);
  report.checks.sidebar = await desktop.webContents.executeJavaScript(`(() => ({ configured:typeof window.setSidebarNoteSort === 'function', optionCount:document.getElementById('sidebar-note-sort')?.options.length || 0 }))()`);
  if (!report.checks.sidebar.configured || report.checks.sidebar.optionCount !== 5) report.issues.push('Editor sidebar sort is missing or incomplete.');
  fs.writeFileSync(path.join(outDir, 'desktop-sidebar.png'), (await desktop.webContents.capturePage()).toPNG());
  desktop.destroy();

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.quit();
  if (report.issues.length) process.exitCode = 1;
}

app.whenReady().then(run).catch(error => { console.error(error); app.quit(); process.exitCode = 1; });
