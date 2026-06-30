// Capture gallery screenshots of the running dev server using Electron.
// Usage: start `npm run dev` (port 5173), then `npx electron screenshot.cjs`.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const URL = process.env.SHOT_URL || 'http://localhost:5173';
const OUT = path.join(__dirname, 'gallery');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  await wait(900);
  await win.webContents.capturePage(); // prime a fresh frame (avoids stale-frame off-by-one)
  await wait(250);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log('saved', name);
}

app.whenReady().then(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const win = new BrowserWindow({
    width: 1400, height: 900, show: true,
    webPreferences: { backgroundThrottling: false }
  });

  await win.loadURL(URL);
  await wait(800);

  // Seed prefs so onboarding is skipped, then reload.
  await win.webContents.executeJavaScript(`
    localStorage.setItem('userName','Hasan');
    localStorage.setItem('userRole','Electronic Engineering Student');
    localStorage.setItem('opennotes_profile_name','Hasan');
    localStorage.setItem('opennotes_profile_type','Electronic Engineering Student');
    localStorage.setItem('opennotes_theme','light');
    localStorage.setItem('opennotes_currency','$');
    localStorage.setItem('opennotes_language','en');
    localStorage.setItem('opennotes_temp_unit','C');
    localStorage.setItem('opennotes_expenses', JSON.stringify([{id:1,title:'Coffee',amount:4.5},{id:2,title:'Books',amount:32}]));
    true;
  `);
  await win.webContents.reload();
  await wait(1200);

  const go = (js) => win.webContents.executeJavaScript(js + '; true');

  await go("document.getElementById('view-grid-btn').click()");
  await shot(win, 'YN1_dashboard.png');

  await go("showPanel('home-session','nav-session-btn')");
  await shot(win, 'YN2_session.png');

  await go("toggleTasksPanel()");
  await shot(win, 'YN3_tasks.png');

  await go("showPanel('home-settings','nav-settings-btn')");
  await shot(win, 'YN4_settings.png');

  await go("toggleCollegePanel()");
  await shot(win, 'YN5_college.png');

  // Dark mode dashboard
  await go("localStorage.setItem('opennotes_theme','dark'); applySettings(); goToDashboard()");
  await shot(win, 'YN6_dark.png');

  console.log('done');
  app.quit();
});
