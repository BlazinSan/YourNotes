const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.SHOT_URL || 'http://127.0.0.1:5177/?haven-preview=beach&haven-spot=0';
const output = process.env.SHOT_OUT || `${process.env.TEMP}\\yournotes-haven-qa.png`;
const width = Number(process.env.SHOT_WIDTH) || 1600;
const height = Number(process.env.SHOT_HEIGHT) || 1000;

app.commandLine.appendSwitch('ignore-gpu-blocklist');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#05060a',
    webPreferences: { backgroundThrottling: false },
  });
  win.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      console.error(`[page:${details.level}] ${details.message}`);
    }
  });

  try {
    await win.loadURL(url);
    await win.webContents.executeJavaScript(`
      localStorage.setItem('userName', 'Haven QA');
      localStorage.setItem('userRole', 'Student');
      localStorage.setItem('opennotes_profile_name', 'Haven QA');
      true;
    `);
    await win.webContents.reload();

    let state = null;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await wait(250);
      state = await win.webContents.executeJavaScript(`(() => {
        const haven = document.getElementById('haven-fs');
        return {
          visible: !!haven && haven.style.display !== 'none',
          loading: !!haven && haven.classList.contains('is-loading'),
          error: !!haven && haven.classList.contains('has-render-error'),
          canvas: !!document.querySelector('#haven-viewport canvas'),
          status: document.getElementById('haven-status-text')?.textContent || ''
        };
      })()`);
      if (state.visible && state.canvas && (!state.loading || state.error)) break;
    }
    const query = new URL(url).searchParams;
    const desiredSpot = Number(query.get('haven-spot')) || 0;
    await win.webContents.executeJavaScript(`window.__hv?.setSeat?.(${desiredSpot}, true); true;`);
    const parseVector = (value) => value?.split(',').map(Number).filter(Number.isFinite);
    const customPos = parseVector(query.get('pos'));
    const customLook = parseVector(query.get('look'));
    if (customPos?.length === 3 && customLook?.length === 3) {
      await win.webContents.executeJavaScript(`
        (() => {
          const engine = window.__hv;
          if (!engine) return;
          engine.pose.pos.set(${customPos.join(',')});
          engine.pose.look.set(${customLook.join(',')});
          engine.pose.fov = ${Number(query.get('fov')) || 54};
          engine.camera.fov = engine.pose.fov;
          engine.camera.updateProjectionMatrix();
          engine.camera.position.copy(engine.pose.pos);
          engine.camera.lookAt(engine.pose.look);
          engine.fromPose = null;
          engine.toPose = null;
          engine.transT = 1;
        })(); true;
      `);
    }
    // Give the render-status overlay enough time to complete its opacity
    // transition so acceptance screenshots never capture stale loading UI.
    await wait(3000);
    await win.webContents.capturePage();
    await wait(280);
    const render = await win.webContents.executeJavaScript(`(() => {
      const engine = window.__hv;
      const info = engine?.renderer?.info?.render;
      const canvas = document.querySelector('#haven-viewport canvas');
      return {
        width: innerWidth,
        height: innerHeight,
        canvasWidth: canvas?.width || 0,
        canvasHeight: canvas?.height || 0,
        calls: info?.calls ?? null,
        triangles: info?.triangles ?? null,
        points: info?.points ?? null,
        lines: info?.lines ?? null,
        camera: engine?.camera ? {
          position: engine.camera.position.toArray(),
          fov: engine.camera.fov,
        } : null,
      };
    })()`);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(output, image.toPNG());
    console.log(JSON.stringify({ output, state, render }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    win.destroy();
    app.quit();
  }
});
