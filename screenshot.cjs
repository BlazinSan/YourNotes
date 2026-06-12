const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  
  // Serve the file via HTTP using python or just file://
  await page.goto('file:///home/raj/Storage/prsnl/Raj Prsnl/skill/OpenNotes/index.html', { waitUntil: 'networkidle0' });
  
  // Open tasks panel
  await page.click('#nav-tasks-btn');
  // Wait a bit
  await new Promise(r => setTimeout(r, 1000));
  
  await page.screenshot({ path: '/home/raj/.gemini/antigravity/brain/e7ed2d46-9ca0-4712-acbd-af5b5b207a64/artifacts/habit_tracker.png' });
  
  await browser.close();
})();
