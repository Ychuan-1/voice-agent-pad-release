const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

async function launch(directory) {
  const env = { ...process.env, VOICE_PAD_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(__dirname, 'test-electron-entry.js')], env, timeout: 45000 });
  const page = await electron.firstWindow();
  await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
  page.on('dialog', (dialog) => dialog.accept());
  return { electron, page };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(root, 'tmp', 'packs-ui-'));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
    language: 'zh-en', startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '',
    dictionary: [{ from: '个人旧词', to: '个人新词', enabled: true }], expressionMode: 'original'
  }));
  let { electron, page } = await launch(directory);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const results = {};
  try {
    await page.locator('#settingsToggle').click();
    await page.locator('[data-view="packs"]').click();
    assert.equal(await page.locator('.pack-row').count(), 16);
    await page.locator('#packCategory').selectOption('daily');
    assert.equal(await page.locator('.pack-row').count(), 9);
    await page.screenshot({ path: path.join(directory, 'daily-catalog.png') });
    await page.locator('#packCategory').selectOption('professional');
    assert.equal(await page.locator('.pack-row').count(), 7);
    await page.locator('#packCategory').selectOption('all');
    await page.locator('#packSearch').fill('ComfyUI');
    assert.equal(await page.locator('.pack-row').count(), 1);
    await page.locator('[data-pack="image-video"] summary').click();
    await page.waitForFunction(() => document.querySelector('.pack-word-search'));
    assert((await page.locator('.pack-words').innerText()).includes('ComfyUI'));
    await page.screenshot({ path: path.join(directory, 'new-terms.png') });
    await page.locator('#packSearch').fill('');
    await page.locator('[data-pack="image-video"] summary').click();
    await page.screenshot({ path: path.join(directory, 'catalog.png') });
    results.catalogSearchPreview = true;

    // These downloads use the actual public pinned source, not route interception.
    const downloadStarted = Date.now();
    await page.getByRole('button', { name: '下载AI 模型与智能体', exact: true }).click();
    await page.waitForFunction(() => { const p = packView.data.packs.find((p) => p.id === 'ai-models'); return p.installed || p.error; }, null, { timeout: 180000 });
    assert(await page.evaluate(() => packView.data.packs.find((p) => p.id === 'ai-models').installed), await page.locator('#packStatus').innerText());
    assert.equal(await page.getByRole('switch', { name: '启用AI 模型与智能体', exact: true }).isChecked(), false);
    await page.getByRole('switch', { name: '启用AI 模型与智能体', exact: true }).check();
    await page.waitForFunction(() => packView.data.packs.find((p) => p.id === 'ai-models').enabled);
    const fixed = await page.evaluate(() => api.processText({ id: 'pack-test-1', text: '请打开chat gpt再使用code x和m c p', mode: 'original' }));
    assert(fixed.text.includes('ChatGPT'));
    assert(fixed.text.includes('Codex'));
    assert(fixed.text.includes('MCP'));
    results.realDownloadMs = Date.now() - downloadStarted;
    results.pipelineText = fixed.text;
    await page.locator('[data-pack="ai-models"] summary').click();
    await page.waitForFunction(() => document.querySelector('[data-pack="ai-models"] .pack-words'));
    await page.getByRole('searchbox', { name: '搜索AI 模型与智能体词条' }).fill('deep');
    assert((await page.locator('[data-pack="ai-models"] .pack-words').innerText()).includes('DeepSeek'));
    await page.screenshot({ path: path.join(directory, 'installed.png') });

    await page.getByRole('button', { name: '下载生图与视频', exact: true }).click();
    await page.waitForFunction(() => { const p = packView.data.packs.find((p) => p.id === 'image-video'); return p.installed || p.error; }, null, { timeout: 180000 });
    assert(await page.evaluate(() => packView.data.packs.find((p) => p.id === 'image-video').installed), await page.locator('#packStatus').innerText());
    await page.locator('#packFilter').selectOption('installed');
    assert.equal(await page.locator('.pack-row').count(), 2);
    await page.locator('#packFilter').selectOption('enabled');
    assert.equal(await page.locator('.pack-row').count(), 1);
    results.downloadEnableFilter = true;
    await page.locator('#packFilter').selectOption('all');
    await page.locator('#packCategory').selectOption('daily');
    const dailyStarted = Date.now();
    await page.getByRole('button', { name: '下载聊天与口语', exact: true }).click();
    await page.waitForFunction(() => { const p = packView.data.packs.find((p) => p.id === 'daily-chat'); return p.installed || p.error; }, null, { timeout: 270000 });
    assert(await page.evaluate(() => packView.data.packs.find((p) => p.id === 'daily-chat').installed), await page.locator('#packStatus').innerText());
    results.dailyDownloadMs = Date.now() - dailyStarted;
    assert.equal(await page.getByRole('switch', { name: '启用聊天与口语', exact: true }).isChecked(), false);
    await page.getByRole('switch', { name: '启用聊天与口语', exact: true }).check();
    await page.waitForFunction(() => packView.data.packs.find((p) => p.id === 'daily-chat').enabled);
    await page.locator('[data-pack="daily-chat"] summary').click();
    await page.getByRole('searchbox', { name: '搜索聊天与口语词条' }).fill('没太听懂');
    assert((await page.locator('[data-pack="daily-chat"] .pack-words').innerText()).includes('没太听懂'));
    await page.screenshot({ path: path.join(directory, 'daily-installed.png') });
    const dailyText = await page.evaluate(() => api.processText({ id: 'daily-test', text: '我不是这个意思，先不用了，晚点再聊。', mode: 'original' }));
    assert.equal(dailyText.text, '我不是这个意思，先不用了，晚点再聊。');
    const cachedStarted = Date.now();
    await page.getByRole('button', { name: '下载吃饭与餐饮', exact: true }).click();
    await page.waitForFunction(() => { const p = packView.data.packs.find((p) => p.id === 'daily-food'); return p.installed || p.error; }, null, { timeout: 270000 });
    assert(await page.evaluate(() => packView.data.packs.find((p) => p.id === 'daily-food').installed), await page.locator('#packStatus').innerText());
    results.dailyCachedInstallMs = Date.now() - cachedStarted;
    results.dailyUnchanged = dailyText.text;
    assert.equal((await page.evaluate(() => api.getSettings())).dictionary, undefined);
    assert.deepEqual(errors, []);
    await electron.close();
    ({ electron, page } = await launch(directory));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('#settingsToggle').click();
    await page.locator('[data-view="packs"]').click();
    assert(await page.getByRole('switch', { name: '启用聊天与口语', exact: true }).isChecked());
    assert(await page.getByRole('switch', { name: '启用AI 模型与智能体', exact: true }).isChecked());
    await page.getByRole('switch', { name: '启用AI 模型与智能体', exact: true }).uncheck();
    await page.waitForFunction(() => !packView.data.packs.find((p) => p.id === 'ai-models').enabled);
    const unchanged = await page.evaluate(() => api.processText({ id: 'pack-test-2', text: '请打开chat gpt', mode: 'original' }));
    assert(unchanged.text.includes('chat gpt'));
    await page.getByRole('button', { name: '删除AI 模型与智能体', exact: true }).click();
    await page.waitForFunction(() => !packView.data.packs.find((p) => p.id === 'ai-models').installed);
    assert.equal((await page.evaluate(() => api.getSettings())).dictionary, undefined);
    results.restartDisableDelete = true;
    assert.deepEqual(errors, []);
    const report = { passed: true, directory, results, errors };
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(directory, 'failure.txt'), error.stack + '\n' + JSON.stringify(errors));
    throw error;
  } finally { await electron.close().catch(() => {}); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
