const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.MOBILE_QA_URL || 'http://127.0.0.1:5190/';
const defaultVideoPath = 'C:\\Users\\HP\\Downloads\\WhatsApp Video 2026-07-09 at 9.51.35 AM.mp4';
const videoPath = process.env.MOBILE_QA_VIDEO || defaultVideoPath;
const outputDir = path.resolve(
  process.env.MOBILE_QA_OUT || path.join(process.cwd(), '.ai-cache', 'mobile-dashboard-video-qa'),
);
const viewports = [
  { name: 'phone-360x800', width: 360, height: 800 },
  { name: 'phone-540x1200', width: 540, height: 1200 },
];

app.commandLine.appendSwitch('ignore-gpu-blocklist');

function readVideoFixture() {
  try {
    const bytes = fs.readFileSync(videoPath);
    return {
      available: true,
      path: videoPath,
      bytes: bytes.length,
      dataUrl: `data:video/mp4;base64,${bytes.toString('base64')}`,
    };
  } catch (error) {
    // Layout still remains testable on CI or a different workstation. The video
    // element will report a decode error, but it exercises the exact modal DOM,
    // sizing, native-controls box, object-fit rule and action row.
    return {
      available: false,
      path: videoPath,
      bytes: 0,
      error: String(error && error.message ? error.message : error),
      dataUrl: 'data:video/mp4;base64,AAAA',
    };
  }
}

function scrollMagnitude(state) {
  if (!state) return 0;
  return Math.max(...Object.values(state).flatMap((entry) => [
    Math.abs(Number(entry && entry.top) || 0),
    Math.abs(Number(entry && entry.left) || 0),
  ]));
}

async function sendWheel(window, point, deltaX, deltaY) {
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
  window.webContents.sendInputEvent({
    type: 'mouseWheel',
    x: Math.round(point.x),
    y: Math.round(point.y),
    deltaX,
    deltaY,
    canScroll: true,
  });
  await wait(220);
}

async function waitFor(evaluate, expression, description, attempts = 120, delay = 100) {
  let lastValue;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastValue = await evaluate(expression);
    if (lastValue) return lastValue;
    await wait(delay);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${JSON.stringify(lastValue)}`);
}

async function loadUrlWithRetry(window, target, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await window.loadURL(target);
      return;
    } catch (error) {
      lastError = error;
      if (window.isDestroyed()) break;
      await wait(250 * (attempt + 1));
    }
  }
  throw lastError || new Error(`Could not load ${target}`);
}

async function runViewport(viewport, fixture) {
  const issues = [];
  const consoleMessages = [];
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    useContentSize: true,
    show: false,
    backgroundColor: '#fdfbf7',
    webPreferences: {
      backgroundThrottling: false,
      // A non-persistent partition guarantees QA never reads or writes the
      // installed app's actual profile, notes, pins, credentials or file map.
      partition: `mobile-dashboard-video-qa-${process.pid}-${viewport.name}`,
    },
  });
  const evaluate = (source) => window.webContents.executeJavaScript(source, true);

  window.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      consoleMessages.push({ level: details.level, message: details.message });
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    issues.push(`render process exited: ${details.reason}`);
  });

  let dashboard = null;
  let settings = null;
  let modal = null;
  let screenshot = '';

  try {
    await loadUrlWithRetry(window, url);
    const boardItem = {
      id: 'mobile-qa-video',
      type: 'file',
      name: 'WhatsApp Video 2026-07-09 at 9.51.35 AM.mp4',
      mime: 'video/mp4',
      dataUrl: fixture.dataUrl,
      w: 190,
      h: 90,
      nx: 0.5,
      ny: 0.35,
      x: 405,
      y: 214,
      rot: 0,
      pin: 2,
      boardV: 3,
    };
    await evaluate(`(() => {
      localStorage.setItem('userName', 'Mobile QA');
      localStorage.setItem('userRole', 'Student');
      localStorage.setItem('opennotes_profile_name', 'Mobile QA');
      localStorage.setItem('opennotes_initialized', '1');
      localStorage.setItem('opennotes_board', ${JSON.stringify(JSON.stringify([boardItem]))});
      return true;
    })()`);
    await window.webContents.reload();

    await waitFor(
      evaluate,
      `(() => typeof window.showPanel === 'function' &&
        getComputedStyle(document.getElementById('home-page')).display !== 'none')()`,
      'the home page',
    );

    await evaluate(`window.showPanel('dashboard-expanded', 'nav-dashboard-btn'); true`);
    await waitFor(
      evaluate,
      `(() => {
        const banner = document.getElementById('dashboard-banner');
        return !!banner?.classList.contains('expanded') &&
          banner.getBoundingClientRect().height > 160 &&
          !!document.querySelector('.board-card-file');
      })()`,
      'the expanded dashboard board and video pin',
    );

    const dashboardSetup = await evaluate(`(() => {
      const selectors = ['html', 'body', '#home-page', '#dashboard-banner', '#dashboard-board'];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) continue;
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
      const banner = document.getElementById('dashboard-banner');
      const rect = banner.getBoundingClientRect();
      const point = {
        x: Math.max(2, Math.min(innerWidth - 2, rect.left + rect.width * 0.72)),
        y: Math.max(2, Math.min(innerHeight - 2, rect.top + rect.height * 0.72)),
      };
      const read = () => Object.fromEntries(selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const style = getComputedStyle(element);
        return [selector, {
          top: element.scrollTop,
          left: element.scrollLeft,
          scrollWidth: element.scrollWidth,
          scrollHeight: element.scrollHeight,
          clientWidth: element.clientWidth,
          clientHeight: element.clientHeight,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        }];
      }));
      return { point, before: read(), viewport: { width: innerWidth, height: innerHeight } };
    })()`);

    const dashboardSamples = [];
    for (const delta of [
      { deltaX: 0, deltaY: -900 },
      { deltaX: 0, deltaY: 900 },
      { deltaX: -900, deltaY: 0 },
      { deltaX: 900, deltaY: 0 },
    ]) {
      await sendWheel(window, dashboardSetup.point, delta.deltaX, delta.deltaY);
      dashboardSamples.push(await evaluate(`(() => {
        const selectors = ['html', 'body', '#home-page', '#dashboard-banner', '#dashboard-board'];
        return Object.fromEntries(selectors.map((selector) => {
          const element = document.querySelector(selector);
          return [selector, element ? { top: element.scrollTop, left: element.scrollLeft } : null];
        }));
      })()`));
    }
    const dashboardMaxScroll = Math.max(0, ...dashboardSamples.map(scrollMagnitude));
    dashboard = { ...dashboardSetup, samples: dashboardSamples, maxScroll: dashboardMaxScroll };
    if (dashboardMaxScroll > 1) {
      issues.push(`dashboard accepted wheel scrolling (${dashboardMaxScroll}px)`);
    }
    for (const selector of ['#home-page', '#dashboard-banner', '#dashboard-board']) {
      const metrics = dashboardSetup.before[selector];
      if (!metrics) {
        issues.push(`dashboard scroll-lock target is missing: ${selector}`);
        continue;
      }
      if (!['hidden', 'clip'].includes(metrics.overflowX) || !['hidden', 'clip'].includes(metrics.overflowY)) {
        issues.push(`${selector} overflow is ${metrics.overflowX}/${metrics.overflowY}, expected hidden/clip`);
      }
      if (metrics.scrollWidth > metrics.clientWidth + 1 || metrics.scrollHeight > metrics.clientHeight + 1) {
        issues.push(`${selector} retains a scrollable dashboard extent`);
      }
    }

    // Prove the dashboard lock is scoped: an ordinary phone page must still be
    // able to scroll. The sentinel makes this deterministic even if Settings is
    // compact or the viewport is unusually tall.
    const settingsSetup = await evaluate(`(() => {
      window.showPanel('home-settings', 'nav-settings-btn');
      const panel = document.getElementById('home-settings');
      const old = document.getElementById('mobile-qa-scroll-sentinel');
      if (old) old.remove();
      const home = document.getElementById('home-page');
      const sentinel = document.createElement('div');
      sentinel.id = 'mobile-qa-scroll-sentinel';
      sentinel.setAttribute('aria-hidden', 'true');
      sentinel.style.cssText = 'display:block;height:2600px;min-height:2600px;width:1px;pointer-events:none';
      // Append to the actual scrolling element, not the Settings flex panel:
      // panel-level flex sizing is intentionally constrained by the app and can
      // collapse a synthetic child without saying anything about page scrolling.
      home.appendChild(sentinel);
      const targets = [document.scrollingElement, home, panel];
      targets.forEach((element) => { if (element) { element.scrollTop = 0; element.scrollLeft = 0; } });
      const rect = home.getBoundingClientRect();
      return {
        point: {
          x: Math.max(2, Math.min(innerWidth - 2, rect.left + rect.width * 0.5)),
          y: Math.max(2, Math.min(innerHeight - 2, rect.top + rect.height * 0.5)),
        },
        home: {
          scrollHeight: home.scrollHeight,
          clientHeight: home.clientHeight,
          overflowY: getComputedStyle(home).overflowY,
        },
      };
    })()`);
    const settingsSamples = [];
    for (const deltaY of [-900, 900, -900]) {
      await sendWheel(window, settingsSetup.point, 0, deltaY);
      settingsSamples.push(await evaluate(`(() => {
        const home = document.getElementById('home-page');
        const panel = document.getElementById('home-settings');
        return {
          document: { top: document.scrollingElement.scrollTop, left: document.scrollingElement.scrollLeft },
          home: { top: home.scrollTop, left: home.scrollLeft },
          settings: { top: panel.scrollTop, left: panel.scrollLeft },
        };
      })()`));
    }
    const settingsWheelMaxScroll = Math.max(0, ...settingsSamples.map(scrollMagnitude));
    // Offscreen BrowserWindows do not consistently apply native wheel default
    // actions on every OS/GPU backend. Confirm the actual overflow container is
    // scrollable with the DOM scrolling API as a deterministic control, while
    // retaining the native wheel samples above as diagnostics.
    const settingsProgrammaticScroll = await evaluate(`(() => {
      const home = document.getElementById('home-page');
      home.scrollTop = Math.min(700, Math.max(0, home.scrollHeight - home.clientHeight));
      const top = home.scrollTop;
      home.scrollTop = 0;
      return top;
    })()`);
    const settingsMaxScroll = Math.max(settingsWheelMaxScroll, settingsProgrammaticScroll);
    settings = {
      ...settingsSetup,
      samples: settingsSamples,
      wheelMaxScroll: settingsWheelMaxScroll,
      programmaticScroll: settingsProgrammaticScroll,
      maxScroll: settingsMaxScroll,
    };
    if (!['auto', 'scroll'].includes(settingsSetup.home.overflowY)) {
      issues.push(`Settings page overflow-y is ${settingsSetup.home.overflowY}, expected auto/scroll`);
    }
    if (settingsSetup.home.scrollHeight <= settingsSetup.home.clientHeight || settingsProgrammaticScroll <= 1) {
      issues.push('Settings page is not scrollable');
    }

    await evaluate(`document.getElementById('mobile-qa-scroll-sentinel')?.remove(); true`);
    await evaluate(`window.showPanel('dashboard-expanded', 'nav-dashboard-btn'); true`);
    await waitFor(evaluate, `!!document.querySelector('.board-card-file')`, 'the video pin after returning to Dashboard');

    const cardPoint = await evaluate(`(() => {
      const card = document.querySelector('.board-card-file');
      const rect = card.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(cardPoint.x), y: Math.round(cardPoint.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: Math.round(cardPoint.x), y: Math.round(cardPoint.y) });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(cardPoint.x), y: Math.round(cardPoint.y) });
    await wait(250);

    // Some headless compositors do not synthesize PointerEvents from injected
    // mouse input. Use the app's same no-movement pointer gesture as a fallback.
    if (!await evaluate(`!!document.querySelector('.board-viewer-video-wrap video')`)) {
      await evaluate(`(() => {
        const card = document.querySelector('.board-card-file');
        const rect = card.getBoundingClientRect();
        const init = {
          bubbles: true,
          cancelable: true,
          pointerId: 73,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        card.dispatchEvent(new PointerEvent('pointerdown', init));
        window.dispatchEvent(new PointerEvent('pointerup', init));
        return true;
      })()`);
    }
    await waitFor(evaluate, `!!document.querySelector('.board-viewer-video-wrap video')`, 'the video viewer');

    if (fixture.available) {
      await waitFor(
        evaluate,
        `(() => {
          const video = document.querySelector('.board-viewer-video-wrap video');
          return video && video.videoWidth > 0 && video.videoHeight > 0;
        })()`,
        'video metadata',
        80,
        100,
      );
    }

    modal = await evaluate(`(() => {
      const selectors = {
        overlay: '.board-viewer-overlay',
        card: '.board-viewer-card',
        head: '.board-viewer-head',
        body: '.board-viewer-body',
        wrap: '.board-viewer-video-wrap',
        video: '.board-viewer-video-wrap video',
        actions: '.board-viewer-actions',
        openButton: '.board-viewer-open',
      };
      const elements = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, document.querySelector(selector)]));
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          left: value.left,
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          width: value.width,
          height: value.height,
        };
      };
      const rects = Object.fromEntries(Object.entries(elements).map(([key, element]) => [key, rect(element)]));
      const videoStyle = getComputedStyle(elements.video);
      const buttonStyle = getComputedStyle(elements.openButton);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        rects,
        document: {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          bodyScrollWidth: document.body.scrollWidth,
        },
        video: {
          controls: elements.video.controls,
          playsInline: elements.video.playsInline,
          objectFit: videoStyle.objectFit,
          objectPosition: videoStyle.objectPosition,
          videoWidth: elements.video.videoWidth,
          videoHeight: elements.video.videoHeight,
          readyState: elements.video.readyState,
        },
        openButton: {
          text: elements.openButton.textContent.trim(),
          clientWidth: elements.openButton.clientWidth,
          scrollWidth: elements.openButton.scrollWidth,
          clientHeight: elements.openButton.clientHeight,
          scrollHeight: elements.openButton.scrollHeight,
          whiteSpace: buttonStyle.whiteSpace,
        },
      };
    })()`);

    const tolerance = 1.25;
    const withinViewport = (rect) => rect.left >= -tolerance && rect.top >= -tolerance
      && rect.right <= modal.viewport.width + tolerance
      && rect.bottom <= modal.viewport.height + tolerance;
    const contains = (outer, inner) => inner.left >= outer.left - tolerance
      && inner.top >= outer.top - tolerance
      && inner.right <= outer.right + tolerance
      && inner.bottom <= outer.bottom + tolerance;

    for (const key of ['overlay', 'card', 'head', 'body', 'wrap', 'video', 'actions', 'openButton']) {
      if (!withinViewport(modal.rects[key])) issues.push(`${key} extends outside the viewport`);
    }
    for (const key of ['head', 'body', 'actions', 'openButton']) {
      if (!contains(modal.rects.card, modal.rects[key])) issues.push(`${key} is clipped by/outside the viewer card`);
    }
    if (!contains(modal.rects.body, modal.rects.wrap)) issues.push('video wrapper is outside the viewer body');
    if (!contains(modal.rects.wrap, modal.rects.video)) issues.push('video element is outside the video wrapper');
    if (!contains(modal.rects.actions, modal.rects.openButton)) issues.push('Open externally button is outside the action row');
    if (modal.openButton.scrollWidth > modal.openButton.clientWidth + 1) issues.push('Open externally label is horizontally clipped');
    if (modal.openButton.scrollHeight > modal.openButton.clientHeight + 1) issues.push('Open externally label is vertically clipped');
    if (modal.openButton.text !== 'Open externally') issues.push(`unexpected Open externally label: ${modal.openButton.text}`);
    if (modal.document.scrollWidth > modal.viewport.width + 1 || modal.document.bodyScrollWidth > modal.viewport.width + 1) {
      issues.push('video viewer creates horizontal document overflow');
    }
    if (!modal.video.controls) issues.push('video native controls are disabled');
    if (!modal.video.playsInline) issues.push('video is missing playsinline');
    if (modal.video.objectFit !== 'contain') issues.push(`video object-fit is ${modal.video.objectFit}, expected contain`);
    if (fixture.available && (!modal.video.videoWidth || !modal.video.videoHeight)) issues.push('real video metadata did not load');

    fs.mkdirSync(outputDir, { recursive: true });
    screenshot = path.join(outputDir, `${viewport.name}.png`);
    // Hidden Electron windows can have one stale compositor frame immediately
    // after a full-page modal is mounted. Prime capture once, then save the next
    // frame so the evidence matches the DOM geometry asserted above.
    await wait(350);
    await window.webContents.capturePage();
    await wait(180);
    const image = await window.webContents.capturePage();
    fs.writeFileSync(screenshot, image.toPNG());
  } catch (error) {
    issues.push(String(error && error.stack ? error.stack : error));
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }

  return {
    viewport,
    screenshot,
    dashboard,
    settings,
    modal,
    consoleMessages,
    issues,
  };
}

app.whenReady().then(async () => {
  let exitCode = 0;
  const fixture = readVideoFixture();
  const results = [];
  // Keep the Electron application alive between sequential viewport windows.
  // Some runner/platform combinations begin shutdown as soon as the first and
  // only BrowserWindow is destroyed, which can cancel the second load.
  const keeper = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: { partition: `mobile-dashboard-video-qa-keeper-${process.pid}` },
  });
  try {
    for (const viewport of viewports) {
      const result = await runViewport(viewport, fixture);
      results.push(result);
      if (result.issues.length) exitCode = 1;
      await wait(250);
    }
    const report = { url, outputDir, fixture: { ...fixture, dataUrl: undefined }, results };
    const json = JSON.stringify(report, null, 2);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'results.json'), json);
    console.log(json);
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    if (!keeper.isDestroyed()) keeper.destroy();
    process.exitCode = exitCode;
    app.exit(exitCode);
  }
});
