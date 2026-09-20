// Deterministic editor, draft, settings and drag-and-drop acceptance.
const { chromium } = require('playwright');

async function main() {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : '';
  const base = option('--url');
  if (!base.startsWith('http://127.0.0.1:')) throw new Error('Supply --url http://127.0.0.1:PORT');
  const state = {
    version: 14,
    revision: 1,
    settings: { publicBaseUrl: '', monitoring: { cpuPercent: 85, memoryPercent: 90, diskPercent: 90 } },
    machines: [
      { id: 'us', name: 'GCP 美西', provider: 'Google Cloud', countryCode: 'US', region: '美西', monitorClientId: 'agent-us' },
      { id: 'my', name: 'Evoxt 马来西亚', provider: 'Evoxt', countryCode: 'MY', region: '马来西亚', monitorClientId: 'agent-my' },
    ],
    nodes: [
      { id: 'n-us', name: '🇺🇸 United States 01', protocol: 'vless', machineId: 'us', uri: 'vless://00000000-0000-4000-8000-000000000001@us.example.com:443#US', enabled: true, tags: [], source: 'manual', sourceId: '' },
      { id: 'n-my', name: '🇲🇾 Malaysia 01', protocol: 'hysteria2', machineId: 'my', uri: 'hysteria2://secret@my.example.com:443#MY', enabled: true, tags: [], source: 'manual', sourceId: '' },
    ],
    nodeDrafts: [], subscriptions: [], externalSources: [], ruleSets: [], serviceBindings: [], managedInstances: [], certificates: [],
    deploymentPresets: [{ id: 'reality', name: 'VLESS Reality', suffix: 'Reality', summary: 'Reality', hidden: false, values: { protocol: 'vless-reality', serverName: 'www.apple.com', handshakeServer: 'www.apple.com', handshakePort: 443, flow: 'xtls-rprx-vision' } }],
    providers: [],
  };
  for (let index = 0; index < 24; index++) state.nodes.push({ ...state.nodes[0], id: `extra-${index}`, name: `Tokyo Extra ${index + 1}` });
  const clients = {
    'agent-us': { uuid: 'agent-us', name: 'GCP 美西', ipv4: '203.0.113.10' },
    'agent-my': { uuid: 'agent-my', name: 'Evoxt 马来西亚', ipv4: '203.0.113.20' },
  };
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // Model browsers without a native save picker (including the full-screen fallback path).
    await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
    await page.route('https://api.github.com/repos/NodePassProject/Nowhere/releases?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ tag_name: 'v2.0.0', draft: false, prerelease: false }]) }));
    await page.route('https://api.github.com/repos/SagerNet/sing-box/releases?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ tag_name: 'v1.13.11', draft: false, prerelease: false }]) }));
    await page.route('**/proxy/backup/*', route => route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="wherever-station-backup-2026-09-17.json"' }, body: JSON.stringify({ format: 'wherever-station-backup', schema: 1, state }) }));
    await page.route('**/api/rpc2', async route => {
      const request = route.request().postDataJSON();
      let result = {};
      if (request.method === 'proxyConsole:getState') result = state;
      else if (request.method === 'proxyConsole:exportPortableBackup') result = { format: 'wherever-station-backup', schema: 1, exportedAt: '2026-09-17T00:00:00Z', state, providerSecrets: {}, ruleSetCache: {} };
      else if (request.method === 'proxyConsole:preparePortableBackupDownload') result = { url: '/proxy/backup/fixture', filename: 'wherever-station-backup-2026-09-17.json', expiresAt: '2026-09-17T00:01:00Z' };
      else if (request.method === 'proxyConsole:previewPortableBackup') result = { exportedAt: '2026-09-17T00:00:00Z', current: { machines: 2, nodes: state.nodes.length, subscriptions: 0, managedInstances: 0 }, incoming: { machines: 2, nodes: state.nodes.length, subscriptions: 0, managedInstances: 0 }, providerTokens: 0, ruleCaches: 0, boundAgents: 2 };
      else if (request.method === 'common:getNodes') result = clients;
      else if (request.method === 'common:getNodesLatestStatus') result = {};
      else if (request.method === 'public:getMe') result = { two_factor_enabled: false };
      else if (request.method === 'proxyConsole:getAccessStats') result = {};
      else if (request.method === 'proxyConsole:listManagedTasks' || request.method === 'proxyConsole:listInstanceStates') result = [];
      else if (request.method === 'proxyConsole:statusCommand') result = { command: 'status' };
      else if (request.method === 'admin:exec') result = { task_id: 'status-task' };
      else if (request.method === 'admin:getSpecificTaskResult') result = { exit_code: 0, result: 'PCSTATES\t1\teyJzdGF0ZXMiOltdfQ==' };
      else if (request.method === 'proxyConsole:newManagedNowhereValues') result = { id: 'nw-new', key: 'secret', version: 'v2.0.0', port: 2077, tcpPort: 2077, udpPort: 2077 };
      else if (request.method === 'proxyConsole:newManagedSingBoxValues') result = { id: 'sb-new', uuid: '00000000-0000-4000-8000-000000000002', port: 20888 };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    });
    await page.goto(`${base}/admin.html`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: '打开设置' }).click();
    let dialog = page.locator('dialog[open]');
    await dialog.getByRole('heading', { name: '控制台设置' }).waitFor();
    await page.setViewportSize({ width: 375, height: 812 });
    const settingsLayout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (settingsLayout.scrollWidth > settingsLayout.clientWidth) throw new Error('Settings overflow on mobile');
    await dialog.getByRole('button', { name: '下载备份' }).click();
    const backupLink = dialog.getByRole('link', { name: '点击下载备份文件' });
    await backupLink.waitFor();
    const pageCountBeforeDownload = page.context().pages().length;
    const downloadPromise = page.waitForEvent('download');
    await backupLink.click();
    const download = await downloadPromise;
    if (!download.suggestedFilename().startsWith('wherever-station-backup-')) throw new Error('Backup download filename is incorrect');
    if (!(await backupLink.isVisible())) throw new Error('Download link was removed during browser navigation');
    if (page.context().pages().length !== pageCountBeforeDownload) throw new Error('Backup download opened an empty tab');
    const backupFixture = { format: 'wherever-station-backup', schema: 1, exportedAt: '2026-09-17T00:00:00Z', state, providerSecrets: {}, ruleSetCache: {} };
    await dialog.locator('.backup-file-picker input').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backupFixture)) });
    await dialog.getByText('恢复预览', { exact: false }).waitFor();
    await page.setViewportSize({ width: 320, height: 812 });
    const backupLayout = await page.locator('html').evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    if (backupLayout.scrollWidth > backupLayout.clientWidth) throw new Error('Backup preview overflows on a narrow phone');
    await dialog.getByRole('radio', { name: '浅色' }).click();
    await dialog.getByRole('button', { name: '取消' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole('button', { name: '节点', exact: true }).click();
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    dialog = page.locator('dialog[open]');
    await page.waitForFunction(() => !!JSON.parse(sessionStorage.getItem('wherever-station:draft:node:new') || 'null')?.value?.id);
    const hostSelect = dialog.locator('label').filter({ hasText: /^关联 VPS/ }).locator('select');
    await hostSelect.selectOption('my');
    const nodeName = dialog.locator('label').filter({ hasText: /^节点名称/ }).locator('input');
    if (!(await nodeName.inputValue()).startsWith('🇲🇾 马来西亚 |')) throw new Error('Manual node name did not follow the selected server');
    const uri = dialog.locator('textarea[placeholder*="其他协议 URI"]');
    await uri.waitFor();
    await dialog.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    dialog = page.locator('dialog[open]');
    const restoredNodeName = await dialog.locator('label').filter({ hasText: /^节点名称/ }).locator('input').inputValue();
    if (!restoredNodeName.startsWith('🇲🇾 马来西亚 |')) throw new Error(`Node draft was not restored: ${restoredNodeName}`);
    await dialog.getByRole('button', { name: '取消' }).click();

    await page.getByRole('button', { name: '订阅', exact: true }).click();
    await page.getByRole('button', { name: '新建订阅', exact: true }).click();
    dialog = page.locator('dialog[open]');
    const subscriptionName = dialog.locator('label').filter({ hasText: /^订阅名称/ }).locator('input');
    await subscriptionName.fill('临时编排草稿');
    await dialog.locator('input[type="date"]').fill('2026-12-31');
    await dialog.dispatchEvent('click');
    if (!(await dialog.isVisible())) throw new Error('Dialog closed after a date/backdrop click');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '新建订阅', exact: true }).click();
    dialog = page.locator('dialog[open]');
    if (await dialog.locator('label').filter({ hasText: /^订阅名称/ }).locator('input').inputValue() !== '临时编排草稿') throw new Error('Subscription draft was not restored');
    await dialog.getByRole('tab', { name: /2\. 代理组/ }).click();
    await dialog.getByRole('button', { name: '添加代理组' }).click();
    const source = dialog.locator('.palette-node').first();
    const box = await source.locator('.drag-handle').boundingBox();
    if (!box) throw new Error('Missing draggable node');
    const pointer = { x: box.x + box.width / 2 + 24, y: box.y + box.height / 2 + 18 };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(pointer.x, pointer.y, { steps: 6 });
    const overlay = page.locator('.drag-overlay');
    await overlay.waitFor();
    const overlayBox = await overlay.boundingBox();
    if (!overlayBox) throw new Error('Missing drag overlay');
    const offset = Math.hypot(overlayBox.x + overlayBox.width / 2 - pointer.x, overlayBox.y + overlayBox.height / 2 - pointer.y);
    if (offset > 8) throw new Error(`Drag overlay is ${offset.toFixed(1)}px away from the pointer`);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const card = dialog.locator('.palette-node').first();
    const cardText = await card.locator('.node-copy').boundingBox();
    const groupDrop = dialog.locator('.group-drop').first();
    if (!cardText || !(await groupDrop.boundingBox())) throw new Error('Missing node card or group drop area');
    await page.mouse.move(cardText.x + cardText.width / 2, cardText.y + cardText.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardText.x + cardText.width / 2 + 12, cardText.y + cardText.height / 2 + 12, { steps: 4 });
    const initialTarget = await groupDrop.boundingBox();
    let dropPointer = { x: initialTarget.x + initialTarget.width / 2, y: initialTarget.y + initialTarget.height / 2 };
    for (let attempt = 0; attempt < 4; attempt++) {
      const target = await groupDrop.boundingBox();
      dropPointer = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      await page.mouse.move(dropPointer.x, dropPointer.y, { steps: 12 });
      await page.waitForTimeout(60);
      if ((await groupDrop.getAttribute('class')).includes('over')) break;
    }
    const groupDropActive = await groupDrop.getAttribute('class');
    const draggedBox = await overlay.boundingBox();
    const dragOffset = Math.hypot(draggedBox.x + draggedBox.width / 2 - dropPointer.x, draggedBox.y + draggedBox.height / 2 - dropPointer.y);
    if (dragOffset > 12) {
      const overlayDebug = await overlay.evaluate((element) => ({
        self: element.getAttribute('style'),
        parent: element.parentElement?.getAttribute('style'),
        parentRect: element.parentElement?.getBoundingClientRect().toJSON(),
      }));
      throw new Error(`Cross-column drag overlay drifted ${dragOffset.toFixed(1)}px from the pointer (overlay=${JSON.stringify(draggedBox)}, pointer=${JSON.stringify(dropPointer)}, target=${JSON.stringify(await groupDrop.boundingBox())}, class=${groupDropActive}, style=${JSON.stringify(overlayDebug)})`);
    }
    await page.mouse.up();
    if (!(await dialog.locator('.group-entry').count())) throw new Error(`Dragging a node card into a proxy group failed (drop=${groupDropActive})`);
    await page.waitForTimeout(220);
    await page.setViewportSize({ width: 375, height: 812 });
    const palette = dialog.locator('.palette');
    await palette.scrollIntoViewIfNeeded();
    const mobileHandle = await dialog.locator('.palette-node .drag-handle').first().boundingBox();
    if (!mobileHandle) throw new Error('Mobile drag handle is missing');
    const touch = await page.context().newCDPSession(page);
    const handleX = mobileHandle.x + mobileHandle.width / 2;
    const handleY = mobileHandle.y + mobileHandle.height / 2;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handleX, y: handleY }] });
    for (let step = 1; step <= 6; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: handleX + step * 3, y: handleY + step * 4 }] });
    await overlay.waitFor();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const paletteBox = await palette.boundingBox();
    if (!paletteBox) throw new Error('Mobile node palette is missing');
    const startX = paletteBox.x + 90;
    const startY = paletteBox.y + paletteBox.height - 30;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
    for (let step = 1; step <= 12; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX, y: startY - step * 12 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(200);
    if (await palette.evaluate(element => element.scrollTop) < 30) throw new Error('Touch swipe did not scroll the mobile subscription node list');
    if (await overlay.isVisible()) throw new Error('Touch scroll started a node drag');
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: '部署节点', exact: true }).click();
    await page.locator('.nowhere-launch').click();
    dialog = page.locator('dialog[open]');
    await dialog.locator('label').filter({ hasText: /^服务器/ }).locator('select').selectOption('my');
    const managedName = dialog.locator('label').filter({ hasText: /^节点名称/ }).locator('input');
    if (!(await managedName.inputValue()).startsWith('🇲🇾 马来西亚 |')) throw new Error('Managed node name did not follow the selected server');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.nowhere-launch').click();
    dialog = page.locator('dialog[open]');
    if (await dialog.locator('label').filter({ hasText: /^服务器/ }).locator('select').inputValue() !== 'my') throw new Error('Deployment draft was not restored');

    // Komari embeds plugin pages without allow-downloads: use a save picker or show a usable fallback.
    await page.addInitScript(() => {
      window.showSaveFilePicker = async () => ({ createWritable: async () => ({
        write: async (content) => { window.__backupBytesWritten = content.length; },
        close: async () => {}, abort: async () => {},
      }) });
    });
    await page.setContent(`<iframe title="Komari plugin" sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts" src="${base}/admin.html" style="width:100%;height:800px"></iframe>`);
    const embedded = page.frameLocator('iframe');
    await embedded.getByRole('button', { name: '打开设置' }).click();
    await embedded.getByRole('button', { name: '下载备份' }).click();
    await embedded.getByText('备份已保存。').waitFor();
    if (!(await embedded.locator('body').evaluate(() => window.__backupBytesWritten)) > 100) throw new Error('Sandboxed backup was not written with the save picker');
    await embedded.locator('body').evaluate(() => { window.showSaveFilePicker = undefined; });
    await embedded.getByRole('button', { name: '下载备份' }).click();
    await embedded.getByText('Komari 内嵌页不允许普通下载', { exact: false }).waitFor();

    console.log(JSON.stringify({ ok: true, automaticNames: true, neutralNodeEditor: true, pointerAnchoredDrag: true, touchScroll: true, modalBackdropSafe: true, sessionDrafts: true, backupUi: true, embeddedBackup: true, settings: true }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
