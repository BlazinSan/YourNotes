const { app, BrowserWindow } = require('electron');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.HAVEN_QA_URL || 'http://127.0.0.1:5179/';

function imageHealth(image) {
  const bitmap = image.toBitmap();
  let lit = 0;
  let sampled = 0;
  for (let index = 0; index < bitmap.length; index += 4 * 24) {
    const blue = bitmap[index];
    const green = bitmap[index + 1];
    const red = bitmap[index + 2];
    if ((red + green + blue) / 3 > 16) lit += 1;
    sampled += 1;
  }
  return { litRatio: sampled ? lit / sampled : 0, sampled };
}

app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#05060a',
    webPreferences: { backgroundThrottling: false },
  });
  const issues = [];
  let exitCode = 0;
  window.webContents.on('render-process-gone', (_event, details) => {
    issues.push(`render-process-gone: ${details.reason}`);
  });
  window.webContents.on('console-message', (details) => {
    if (['error', 'warning'].includes(details.level)) {
      issues.push(`console ${details.level}: ${details.message}`);
    }
  });

  const evaluate = (source) => window.webContents.executeJavaScript(source, true);
  const readState = () => evaluate(`(() => {
    const haven = document.getElementById('haven-fs');
    const activeTheme = document.querySelector('#haven-fs .haven-theme-btn.active')?.dataset.theme || null;
    return {
      visible: !!haven && getComputedStyle(haven).display !== 'none',
      loading: !!haven?.classList.contains('is-loading'),
      error: !!haven?.classList.contains('has-render-error'),
      canvas: !!document.querySelector('#haven-viewport canvas'),
      activeTheme,
      status: document.getElementById('haven-status-text')?.textContent || '',
    };
  })()`);
  const waitReady = async (theme) => {
    let state;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await wait(250);
      state = await readState();
      if (state.visible && state.canvas && !state.loading && !state.error && (!theme || state.activeTheme === theme)) {
        return state;
      }
    }
    throw new Error(`Safe Haven did not become ready for ${theme || 'open'}: ${JSON.stringify(state)}`);
  };

  try {
    await window.loadURL(url);
    await evaluate(`
      localStorage.setItem('userName', 'Haven Runtime QA');
      localStorage.setItem('userRole', 'Student');
      localStorage.setItem('opennotes_profile_name', 'Haven Runtime QA');
      true;
    `);
    await window.webContents.reload();
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(`typeof window.openHaven === 'function'`)) break;
      await wait(100);
    }
    await evaluate(`window.openHaven()`);
    await waitReady();

    const snapshots = [];
    for (const theme of ['city', 'beach', 'cabin', 'city']) {
      await evaluate(`window.setHavenTheme(${JSON.stringify(theme)})`);
      await waitReady(theme);
      // A scene can be logically ready before the first post-processing frame
      // has reached the compositor. Let the authored lighting and camera settle
      // so a cold start is not mistaken for a black scene.
      await wait(2200);
      for (const seat of [0, 1, 2]) {
        await evaluate(`window.setHavenSpot(${seat}); true`);
        await wait(650);
        const state = await readState();
        const health = imageHealth(await window.webContents.capturePage());
        const render = await evaluate(`(() => {
          const info = window.__hv?.renderer?.info?.render;
          return { calls: info?.calls ?? null, triangles: info?.triangles ?? null };
        })()`);
        snapshots.push({ theme, seat, state, health, render });
        if (state.error || !state.canvas || health.litRatio < 0.15) {
          issues.push(`unhealthy ${theme}/${seat}: ${JSON.stringify({ state, health })}`);
        }
      }
    }

    await evaluate(`window.closeHaven(); true`);
    await wait(400);
    const closed = await readState();
    if (closed.visible) issues.push('Safe Haven remained visible after close');
    await evaluate(`window.openHaven()`);
    await waitReady('city');

    const controls = await evaluate(`(() => {
      document.getElementById('haven-lofi-menu')?.click();
      const panel = document.getElementById('haven-lofi-panel');
      return {
        audioElements: document.querySelectorAll('audio').length,
        lofiPanelOpen: !!panel && !panel.hidden,
        lofiButtons: document.querySelectorAll('.lofi-toggle').length,
        rotateButton: [...document.querySelectorAll('#haven-fs button')].some((button) =>
          /rotate/i.test((button.textContent || '') + ' ' + (button.getAttribute('aria-label') || ''))),
      };
    })()`);
    if (controls.audioElements !== 1) issues.push(`expected one audio element, found ${controls.audioElements}`);
    if (!controls.lofiPanelOpen) issues.push('Haven lofi panel did not open');
    if (controls.rotateButton) issues.push('phone rotate control is still present');

    console.log(JSON.stringify({ url, snapshots, controls, issues }, null, 2));
    if (issues.length) exitCode = 1;
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    window.destroy();
    app.exit(exitCode);
  }
});
