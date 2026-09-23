// Read-only live UI check for release discovery and responsive layout.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = opt('--url').replace(/\/$/, '');
  const credentialPath = path.resolve(opt('--credentials'));
  const screenshotDir = opt('--screenshot-dir');
  if (!base.startsWith('https://') || !fs.existsSync(credentialPath)) throw new Error('Supply --url HTTPS_URL and --credentials FILE');
  const credentialText = fs.readFileSync(credentialPath, 'utf8');
  const readCredential = name => credentialText.split('\n').find(line => line.startsWith(name))?.replace(/^[^:：]*[:：]\s*/, '').trim();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const login = await page.request.post(`${base}/api/login`, { data: { username: readCredential('用户名'), password: readCredential('密码'), '2fa_code': '' } });
    if (!login.ok()) throw new Error(`Login failed (${login.status()})`);
    await page.goto(`${base}/api/admin/plugin/proxy-console/pages/admin.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '部署节点', exact: true }).click();
    await page.locator('.nowhere-launch').click();
    const dialog = page.locator('dialog[open]');
    await dialog.getByText('高级参数', { exact: true }).click();
    await dialog.locator('label').filter({ hasText: /^内核来源/ }).locator('select').selectOption('download');
    const releaseSelect = dialog.getByLabel('Nowhere 下载版本', { exact: true });
    await releaseSelect.waitFor();
    await page.waitForFunction(() => /^v\d+\.\d+\.\d+/.test(document.querySelector('select[aria-label="Nowhere 下载版本"]')?.options[0]?.textContent || ''), null, { timeout: 10000 });
    const releases = await releaseSelect.locator('option').allTextContents();
    if (!releases[0]?.includes('最新') || !/^v\d+\.\d+\.\d+/.test(releases[0])) throw new Error(`Latest release is not selected first: ${releases[0] || 'missing'}`);

    const results = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      await releaseSelect.scrollIntoViewIfNeeded();
      const layout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      const bounds = await dialog.boundingBox();
      const insideViewport = bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1;
      if (layout.scrollWidth > layout.clientWidth || !insideViewport) throw new Error(`Horizontal overflow at ${viewport.width}px: ${JSON.stringify({ layout, bounds })}`);
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDir, `nowhere-${viewport.width}.png`), fullPage: false });
      }
      results.push({ viewport: viewport.width, layout, dialogWidth: Math.round(bounds.width) });
    }

    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '节点', exact: true }).click();
    await page.getByRole('button', { name: '导入节点', exact: true }).click();
    const importDialog = page.locator('dialog[open]');
    const importResults = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 375, height: 812 }, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      const meta = importDialog.locator('.import-meta');
      await meta.scrollIntoViewIfNeeded();
      const [metaBounds, hostBounds, tagBounds, buttonBounds, layout] = await Promise.all([
        meta.boundingBox(),
        meta.locator('label').filter({ hasText: /^关联 VPS/ }).boundingBox(),
        meta.locator('label').filter({ hasText: /^标签/ }).boundingBox(),
        meta.getByRole('button', { name: '解析并预览', exact: true }).boundingBox(),
        page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
      ]);
      if (!metaBounds || !hostBounds || !tagBounds || !buttonBounds) throw new Error(`Import controls missing at ${viewport.width}px`);
      if (layout.scrollWidth > layout.clientWidth) {
        const offenders = await page.locator('body *').evaluateAll(elements => elements.map(element => ({ tag: element.tagName, className: element.className?.baseVal || element.className || '', text: element.textContent?.trim().slice(0, 40), left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth })).filter(item => item.left < -1 || item.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1).slice(-16));
        throw new Error(`Import dialog overflow at ${viewport.width}px: ${JSON.stringify({ layout, offenders })}`);
      }
      if (viewport.width > 760) {
        const bottoms = [hostBounds.y + hostBounds.height, tagBounds.y + tagBounds.height, buttonBounds.y + buttonBounds.height];
        if (Math.max(...bottoms) - Math.min(...bottoms) > 2) throw new Error(`Import controls are not bottom-aligned at ${viewport.width}px`);
      } else {
        if (!(hostBounds.y + hostBounds.height < tagBounds.y && tagBounds.y + tagBounds.height < buttonBounds.y)) {
          throw new Error(`Import controls are not stacked at ${viewport.width}px`);
        }
        if (Math.abs(buttonBounds.width - metaBounds.width) > 2) throw new Error(`Import action is not full-width at ${viewport.width}px`);
      }
      if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `import-${viewport.width}.png`), fullPage: false });
      importResults.push({ viewport: viewport.width, metaWidth: Math.round(metaBounds.width), buttonWidth: Math.round(buttonBounds.width) });
    }
    console.log(JSON.stringify({ ok: true, latest: releases[0], releaseOptions: releases.length - 1, results, importResults }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
