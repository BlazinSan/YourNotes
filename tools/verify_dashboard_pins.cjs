const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const url = process.env.DASHBOARD_QA_URL || 'http://127.0.0.1:5173/';
const outputDir = path.resolve(process.env.DASHBOARD_QA_OUT || path.join('.ai-cache', 'dashboard-pin-qa'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yournotes-dashboard-pin-qa-'));

fs.mkdirSync(outputDir, { recursive: true });
app.setPath('userData', userData);
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function distance(a, b) {
  return Math.hypot(a.left - b.left, a.top - b.top);
}

function rectanglesOverlap(a, b, tolerance = 0.5) {
  return !(
    a.right <= b.left + tolerance
    || b.right <= a.left + tolerance
    || a.bottom <= b.top + tolerance
    || b.bottom <= a.top + tolerance
  );
}

async function createWindow({ width, height, mobile = false }) {
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: true,
    backgroundColor: '#fdfbf7',
    webPreferences: { backgroundThrottling: false },
  });
  const consoleMessages = [];
  const crashes = [];
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      consoleMessages.push({ level: details.level, message: details.message });
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => crashes.push(details.reason));

  await win.loadURL(url);
  win.show();
  win.focus();
  return { win, consoleMessages, crashes };
}

async function evaluate(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, source, label, attempts = 160) {
  let state;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    state = await evaluate(win, source);
    if (state) return state;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}; last value: ${JSON.stringify(state)}`);
}

async function seedBoard(win, items) {
  await evaluate(win, `(() => {
    localStorage.setItem('userName', 'Dashboard Pin QA');
    localStorage.setItem('userRole', 'Tester');
    localStorage.setItem('opennotes_initialized', '1');
    localStorage.setItem('opennotes_board', ${JSON.stringify(JSON.stringify(items))});
    localStorage.removeItem('dashboardBanner');
    return true;
  })()`);
  await win.webContents.reload();
  await waitFor(win, `typeof window.showPanel === 'function'`, 'showPanel');
  // Hidden QA windows do not reliably composite CSS transition frames even
  // with backgroundThrottling disabled. Disable only the banner transition in
  // the harness so geometry/collision assertions exercise its final app size.
  await evaluate(win, `(() => {
    const banner = document.getElementById('dashboard-banner');
    if (banner) banner.style.transition = 'none';
    return true;
  })()`);
  // Model a real navigation gesture after the first home frame has painted.
  // Calling showPanel in the same cold-load frame can legitimately suppress the
  // CSS transition because Chromium has not committed the collapsed state yet.
  await wait(180);
  await evaluate(win, `window.showPanel('dashboard-expanded', 'nav-dashboard-btn'); true`);
  await waitFor(win, `(() => {
    const banner = document.getElementById('dashboard-banner');
    return !!banner?.classList.contains('expanded')
      && banner.clientHeight > 160
      && document.querySelectorAll('#dashboard-board .board-card').length === ${items.length};
  })()`, `${items.length} rendered board cards`);
  // Allow the banner height transition, deferred board render and compositor to settle.
  await wait(700);
}

async function boardSnapshot(win) {
  return evaluate(win, `(() => {
    const copyRect = (rect) => ({
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    });
    const union = (rects) => ({
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
      width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
      height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
    });
    const banner = document.getElementById('dashboard-banner');
    const board = document.getElementById('dashboard-board');
    const home = document.getElementById('home-page');
    const cards = [...board.querySelectorAll('.board-card')].map((card) => {
      const cardRect = card.getBoundingClientRect();
      const pinRect = card.querySelector('.board-pin')?.getBoundingClientRect();
      const visual = union([cardRect, ...(pinRect ? [pinRect] : [])]);
      const style = getComputedStyle(card);
      const center = { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 };
      const hit = document.elementFromPoint(center.x, center.y);
      return {
        id: card.dataset.boardId,
        rect: copyRect(cardRect),
        pinRect: pinRect ? copyRect(pinRect) : null,
        visual,
        center,
        centerHit: hit ? { tag: hit.tagName, className: String(hit.className || '') } : null,
        widthStyle: parseFloat(style.width),
        heightStyle: parseFloat(style.height),
        transform: style.transform,
        blocked: card.classList.contains('board-blocked'),
      };
    });
    const stored = JSON.parse(localStorage.getItem('opennotes_board') || '[]');
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      coarse: matchMedia('(pointer: coarse)').matches,
      home: {
        rect: copyRect(home.getBoundingClientRect()),
        clientWidth: home.clientWidth, clientHeight: home.clientHeight,
        scrollWidth: home.scrollWidth, scrollHeight: home.scrollHeight,
        scrollLeft: home.scrollLeft, scrollTop: home.scrollTop,
        overflowX: getComputedStyle(home).overflowX,
        overflowY: getComputedStyle(home).overflowY,
        boardActive: home.classList.contains('dashboard-board-active'),
        dragLock: !!window.isDraggingBoardCard,
      },
      banner: {
        rect: copyRect(banner.getBoundingClientRect()),
        clientWidth: banner.clientWidth, clientHeight: banner.clientHeight,
        scrollWidth: banner.scrollWidth, scrollHeight: banner.scrollHeight,
        scrollLeft: banner.scrollLeft, scrollTop: banner.scrollTop,
        overflowX: getComputedStyle(banner).overflowX,
        overflowY: getComputedStyle(banner).overflowY,
      },
      board: {
        rect: copyRect(board.getBoundingClientRect()),
        clientWidth: board.clientWidth, clientHeight: board.clientHeight,
        scrollWidth: board.scrollWidth, scrollHeight: board.scrollHeight,
        inlineWidth: board.style.width, inlineHeight: board.style.height,
      },
      cards,
      stored,
    };
  })()`);
}

async function capture(win, filename) {
  const destination = path.join(outputDir, filename);
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(destination, image.toPNG());
    return destination;
  } catch (error) {
    // Some Windows GPU/remote-display combinations reject capturePage with
    // UnknownVizError. Geometry assertions are still authoritative.
    return `capture-unavailable:${error?.message || error}`;
  }
}

async function dispatchPointer(win, type, point, selector = null, pointerId = 91) {
  return evaluate(win, `(() => {
    const target = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'window'};
    if (!target) throw new Error('Pointer target not found');
    target.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: ${pointerId},
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: ${type === 'pointerup' ? 0 : 1},
      clientX: ${Number(point.x)},
      clientY: ${Number(point.y)}
    }));
    return true;
  })()`);
}

async function mouseDrag(win, selector, start, points) {
  await dispatchPointer(win, 'pointerdown', start, selector);
  let from = start;
  for (const point of points) {
    const steps = Math.max(8, Math.min(24, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 45)));
    for (let index = 1; index <= steps; index += 1) {
      const amount = index / steps;
      await dispatchPointer(win, 'pointermove', {
        x: from.x + (point.x - from.x) * amount,
        y: from.y + (point.y - from.y) * amount,
      });
      await wait(12);
    }
    from = point;
  }
  await wait(80);
  const beforeRelease = await boardSnapshot(win);
  await dispatchPointer(win, 'pointerup', from);
  await wait(140);
  const afterRelease = await boardSnapshot(win);
  return { beforeRelease, afterRelease };
}

async function runDesktopEdges(issues) {
  const runtime = await createWindow({ width: 1600, height: 900 });
  const { win } = runtime;
  const item = { id: 'edge-pin', type: 'file', name: 'Rotated edge pin.pdf', mime: 'application/pdf', w: 210, h: 130, rot: -8, nx: 0.5, ny: 0.5, boardV: 3 };
  const results = [];
  try {
    await seedBoard(win, [item]);
    const initial = await boardSnapshot(win);
    const initialCard = initial.cards[0];
    const targetFor = (edge, snapshot) => {
      const card = snapshot.cards[0];
      const banner = snapshot.banner.rect;
      if (edge === 'left') return { x: Math.max(0, banner.left), y: card.center.y };
      if (edge === 'right') return { x: Math.min(snapshot.viewport.width - 1, banner.right - 1), y: card.center.y };
      if (edge === 'top') return { x: card.center.x, y: Math.max(0, banner.top) };
      return { x: card.center.x, y: Math.min(snapshot.viewport.height - 1, banner.bottom - 1) };
    };

    for (const edge of ['left', 'right', 'top', 'bottom']) {
      // Each boundary is an independent gesture. Reloading the same centred pin
      // avoids synthetic pointer-capture state from one Electron gesture leaking
      // into the next and also mirrors four separate user drag attempts.
      if (results.length) await seedBoard(win, [item]);
      const startState = await boardSnapshot(win);
      const startCard = startState.cards[0];
      const drag = await mouseDrag(win, '[data-board-id="edge-pin"]', startCard.center, [targetFor(edge, startState)]);
      const before = drag.beforeRelease.cards[0];
      const after = drag.afterRelease.cards[0];
      const banner = drag.afterRelease.banner.rect;
      const gaps = {
        left: after.visual.left - banner.left,
        right: banner.right - after.visual.right,
        top: after.visual.top - banner.top,
        bottom: banner.bottom - after.visual.bottom,
      };
      const selectedGap = gaps[edge];
      const inside = Object.values(gaps).every((gap) => gap >= -1.1);
      // Rotated pushpins use a conservative corner envelope so the pin head
      // cannot escape even when the visible SVG is narrower than that envelope.
      const reached = selectedGap >= -1.1 && selectedGap <= 30;
      const releaseJump = distance(before.rect, after.rect);
      const sizeStable = Math.abs(after.widthStyle - initialCard.widthStyle) <= 0.2
        && Math.abs(after.heightStyle - initialCard.heightStyle) <= 0.2;
      if (!inside) issues.push(`desktop ${edge}: rotated visual rect escaped banner (${JSON.stringify(gaps)})`);
      if (!reached) issues.push(`desktop ${edge}: pin did not reach edge (gap ${round(selectedGap)}px)`);
      if (releaseJump > 1) issues.push(`desktop ${edge}: ${round(releaseJump)}px release jump`);
      if (!sizeStable) issues.push(`desktop ${edge}: dragging changed pin size`);
      results.push({
        edge, gaps, inside, reached, releaseJump, sizeStable,
        startHit: startCard.centerHit,
        dragLockBeforeRelease: drag.beforeRelease.home.dragLock,
        dragLockAfterRelease: drag.afterRelease.home.dragLock,
        before, after,
      });
    }
    const screenshot = await capture(win, 'desktop-edges-final.png');
    return { initial, results, screenshot, consoleMessages: runtime.consoleMessages, crashes: runtime.crashes };
  } finally {
    win.destroy();
  }
}

async function runDesktopCollision(issues) {
  const runtime = await createWindow({ width: 1600, height: 900 });
  const { win } = runtime;
  const items = [
    { id: 'slide-pin', type: 'file', name: 'Dragged pin.pdf', mime: 'application/pdf', w: 210, h: 130, rot: -6, nx: 0.18, ny: 0.48, boardV: 3 },
    { id: 'obstacle-pin', type: 'file', name: 'Stationary pin.pdf', mime: 'application/pdf', w: 220, h: 145, rot: 7, nx: 0.55, ny: 0.48, boardV: 3 },
  ];
  try {
    await seedBoard(win, items);
    const initial = await boardSnapshot(win);
    const moving = initial.cards.find((card) => card.id === 'slide-pin');
    const obstacle = initial.cards.find((card) => card.id === 'obstacle-pin');

    await dispatchPointer(win, 'pointerdown', moving.center, '[data-board-id="slide-pin"]', 92);

    const moveTo = async (from, to) => {
      const steps = 18;
      for (let index = 1; index <= steps; index += 1) {
        const amount = index / steps;
        await dispatchPointer(win, 'pointermove', {
          x: from.x + (to.x - from.x) * amount,
          y: from.y + (to.y - from.y) * amount,
        }, null, 92);
        await wait(14);
      }
      await wait(80);
    };

    await moveTo(moving.center, obstacle.center);
    const blocked = await boardSnapshot(win);
    const slideTarget = { x: obstacle.center.x, y: Math.min(initial.banner.rect.bottom - 20, obstacle.center.y + 230) };
    await moveTo(obstacle.center, slideTarget);
    const beforeRelease = await boardSnapshot(win);
    await dispatchPointer(win, 'pointerup', slideTarget, null, 92);
    await wait(160);
    const afterRelease = await boardSnapshot(win);

    const cardPair = (snapshot) => [
      snapshot.cards.find((card) => card.id === 'slide-pin'),
      snapshot.cards.find((card) => card.id === 'obstacle-pin'),
    ];
    const [blockedMoving, blockedObstacle] = cardPair(blocked);
    const [beforeMoving, beforeObstacle] = cardPair(beforeRelease);
    const [afterMoving, afterObstacle] = cardPair(afterRelease);
    const overlapBlocked = rectanglesOverlap(blockedMoving.visual, blockedObstacle.visual);
    const overlapBefore = rectanglesOverlap(beforeMoving.visual, beforeObstacle.visual);
    const overlapAfter = rectanglesOverlap(afterMoving.visual, afterObstacle.visual);
    const slideDistance = distance(blockedMoving.rect, beforeMoving.rect);
    const releaseJump = distance(beforeMoving.rect, afterMoving.rect);
    const sizeStable = Math.abs(afterMoving.widthStyle - moving.widthStyle) <= 0.2
      && Math.abs(afterMoving.heightStyle - moving.heightStyle) <= 0.2;
    if (overlapBlocked || overlapBefore || overlapAfter) issues.push('desktop collision: pins overlapped during or after drag');
    if (slideDistance < 12) issues.push(`desktop collision: dragged pin did not slide around obstacle (${round(slideDistance)}px)`);
    if (releaseJump > 1) issues.push(`desktop collision: ${round(releaseJump)}px release jump`);
    if (!sizeStable) issues.push('desktop collision: dragging changed pin size');
    const screenshot = await capture(win, 'desktop-collision-final.png');
    return {
      initial,
      blocked,
      beforeRelease,
      afterRelease,
      overlapBlocked,
      overlapBefore,
      overlapAfter,
      slideDistance,
      releaseJump,
      sizeStable,
      screenshot,
      consoleMessages: runtime.consoleMessages,
      crashes: runtime.crashes,
    };
  } finally {
    win.destroy();
  }
}

async function runPhoneDimensions(issues) {
  const runtime = await createWindow({ width: 390, height: 844, mobile: true });
  const { win } = runtime;
  const items = [
    { id: 'phone-a', type: 'file', name: 'Phone A.pdf', mime: 'application/pdf', w: 190, h: 90, rot: -6, nx: 0.16, ny: 0.3, boardV: 3 },
    { id: 'phone-b', type: 'file', name: 'Phone B.pdf', mime: 'application/pdf', w: 190, h: 90, rot: 5, nx: 0.68, ny: 0.58, boardV: 3 },
  ];
  try {
    await seedBoard(win, items);
    const before = await boardSnapshot(win);
    const widthDiff = Math.abs(before.board.rect.width - before.banner.rect.width);
    const heightDiff = Math.abs(before.board.rect.height - before.banner.rect.height);
    const inside = before.cards.every((card) => {
      const rect = card.visual;
      const banner = before.banner.rect;
      return rect.left >= banner.left - 1.1 && rect.right <= banner.right + 1.1
        && rect.top >= banner.top - 1.1 && rect.bottom <= banner.bottom + 1.1;
    });
    if (!before.home.boardActive) issues.push('phone: dashboard-board-active state missing');
    if (widthDiff > 0.75 || heightDiff > 0.75) {
      issues.push(`phone: board does not match banner (${round(widthDiff)}px × ${round(heightDiff)}px difference)`);
    }
    if (!inside) issues.push('phone: at least one decorated pin is outside banner bounds');

    const point = { x: Math.round(before.banner.rect.width * 0.88), y: Math.round(before.banner.rect.top + before.banner.rect.height * 0.45) };
    win.webContents.sendInputEvent({ type: 'mouseWheel', x: point.x, y: point.y, deltaY: 420, deltaX: 160 });
    await evaluate(win, `(() => {
      const home = document.getElementById('home-page');
      const banner = document.getElementById('dashboard-banner');
      home.scrollBy(160, 420);
      banner.scrollBy(160, 420);
      return true;
    })()`);
    await wait(180);
    const after = await boardSnapshot(win);
    const scrollStable = before.home.scrollTop === after.home.scrollTop
      && before.home.scrollLeft === after.home.scrollLeft
      && before.banner.scrollTop === after.banner.scrollTop
      && before.banner.scrollLeft === after.banner.scrollLeft;
    if (!scrollStable) issues.push('phone: dashboard scroll offsets changed after touch/wheel gestures');
    const screenshot = await capture(win, 'phone-board.png');
    return {
      before,
      after,
      widthDiff,
      heightDiff,
      inside,
      scrollStable,
      screenshot,
      consoleMessages: runtime.consoleMessages,
      crashes: runtime.crashes,
    };
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  const issues = [];
  const report = { url, outputDir, issues };
  // Keep Chromium alive between isolated test windows. Windows Electron quits
  // when the last BrowserWindow closes, which can interrupt the next loadURL.
  const keepAlive = new BrowserWindow({ width: 1, height: 1, show: false });
  try {
    const desktopEdges = await runDesktopEdges(issues);
    report.desktopEdges = desktopEdges;
    fs.writeFileSync(path.join(outputDir, 'report.partial.json'), `${JSON.stringify(report, null, 2)}\n`);
    const desktopCollision = await runDesktopCollision(issues);
    report.desktopCollision = desktopCollision;
    fs.writeFileSync(path.join(outputDir, 'report.partial.json'), `${JSON.stringify(report, null, 2)}\n`);
    const phone = await runPhoneDimensions(issues);
    report.phone = phone;
    const crashReasons = [
      ...desktopEdges.crashes,
      ...desktopCollision.crashes,
      ...phone.crashes,
    ];
    if (crashReasons.length) issues.push(`render process crashes: ${crashReasons.join(', ')}`);
  } catch (error) {
    issues.push(error.stack || error.message || String(error));
  } finally {
    keepAlive.destroy();
  }

  const reportPath = path.join(outputDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ reportPath, issues }, null, 2));
  app.exit(issues.length ? 1 : 0);
});
