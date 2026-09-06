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
  return { electron, page };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(root, 'tmp', 'translation-ui-'));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ language: 'zh-en',
    startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '', cleanupPreview: false,
    expressionMode: 'organized', dictionary: [{ from: '苹果', to: 'banana', enabled: true }] }));
  let { electron, page } = await launch(directory);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const results = {};
  try {
    await page.locator('#settingsToggle').click();
    assert.equal(await page.locator('[data-view="dictionary"], #dictionaryList, #correctionSuggestion').count(), 0);
    assert.equal((await page.evaluate(() => api.getSettings())).dictionary, undefined);
    const legacy = await page.evaluate(() => api.processText({ id: 'legacy', text: '我想吃苹果', mode: 'original' }));
    assert.equal(legacy.text, '我想吃苹果。');
    await page.locator('#language').selectOption('zh-to-en');
    assert.equal((await page.evaluate(() => api.getSettings())).language, 'zh-en');
    await page.locator('#saveSettingsTop').click();
    await page.waitForFunction(() => currentSettings.language === 'zh-to-en' && !settingsDirty);
    assert.equal((await page.evaluate(() => api.getSettings())).expressionMode, 'organized');
    await page.screenshot({ path: path.join(directory, 'language-setting.png') });
    await page.locator('#closeSettings').click();
    await page.evaluate(() => setMode('expanded'));
    assert.equal(await page.locator('[data-expression]:visible').count(), 0);
    assert(await page.locator('#translationModeLabel').isVisible());
    assert((await page.locator('#engineLabel').innerText()).includes('中文 → 英文'));
    assert.equal(await page.evaluate(() => normalizeRecognizedText('请检查ComfyUI。こんにちは')), '请检查ComfyUI。');
    const source = '你明天下午有空吗？我们一起去喝咖啡吧。';
    await page.locator('#transcript').fill(source);
    await page.getByRole('button', { name: '翻译当前文字', exact: true }).click();
    await page.waitForFunction(() => !isRecordingBusy(), null, { timeout: 90000 });
    const revision = await page.evaluate(() => featureState.revision);
    assert.equal(revision.mode, 'translate-en');
    assert.equal(revision.original, source);
    assert.equal(revision.notice, '');
    assert.equal(revision.needsReview, true);
    assert(/tomorrow/i.test(revision.text) && /coffee/i.test(revision.text));
    assert(!/[\p{Script=Han}]/u.test(revision.text));
    results.realTranslation = revision.text;
    results.elapsedMs = revision.elapsedMs;
    await page.locator('#revisionDetails summary').click();
    await page.screenshot({ path: path.join(directory, 'english-preview.png') });
    await page.locator('#restoreOriginalButton').click();
    assert.equal(await page.locator('#transcript').inputValue(), source);
    const history = await page.evaluate(() => api.getHistory());
    assert(history.some((row) => row.expressionMode === 'translate-en' && row.original === source && row.text === revision.text));

    // Deterministic errors verify fallback and cancellation, not model quality.
    await electron.evaluate(() => {
      globalThis.originalTranslationRewrite = globalThis.voicePadTestEditor.prototype.rewrite;
      globalThis.voicePadTestEditor.prototype.rewrite = async () => '这不是英文';
    });
    const failed = await page.evaluate(() => api.processText({ id: 'bad-language', text: '不要订票。', mode: 'original' }));
    assert.equal(failed.text, '不要订票。');
    assert(failed.notice.includes('翻译未完成') && failed.needsReview);
    await electron.evaluate(() => { globalThis.voicePadTestEditor.prototype.rewrite = async () => { throw new Error('model unavailable'); }; });
    const missing = await page.evaluate(() => api.processText({ id: 'missing', text: '不要订票。', mode: 'daily' }));
    assert.equal(missing.text, '不要订票。');
    assert(missing.notice.includes('model unavailable') && missing.needsReview);
    await electron.evaluate(() => { globalThis.voicePadTestEditor.prototype.rewrite = async () => { await new Promise((resolve) => setTimeout(resolve, 800)); return 'A late translation.'; }; });
    await page.locator('#transcript').fill('取消后保留这段中文');
    await page.locator('#processTextButton').click();
    await page.waitForFunction(() => !!featureState.request);
    await page.locator('#cancelTaskButton').click();
    await page.waitForFunction(() => !isRecordingBusy());
    assert.equal(await page.locator('#transcript').inputValue(), '取消后保留这段中文');
    await electron.evaluate(() => { globalThis.voicePadTestEditor.prototype.rewrite = globalThis.originalTranslationRewrite; });
    results.errorAndCancelPreserveChinese = true;
    const oversized = await page.evaluate(() => api.processText({ id: 'long', text: '请检查。'.repeat(251), mode: 'original' }));
    assert(oversized.notice.includes('1000') && oversized.needsReview);
    const raw = JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8'));
    assert.equal(raw.dictionary, undefined);
    await electron.close();
    ({ electron, page } = await launch(directory));
    page.on('pageerror', (error) => errors.push(error.message));
    assert.equal((await page.evaluate(() => api.getSettings())).language, 'zh-to-en');
    assert.equal(await page.locator('#transcript').inputValue(), '取消后保留这段中文');
    await page.locator('#settingsToggle').click();
    await page.locator('#language').selectOption('zh-en');
    await page.locator('#saveSettingsTop').click();
    await page.waitForFunction(() => currentSettings.language === 'zh-en' && !settingsDirty);
    await page.locator('#closeSettings').click();
    await page.evaluate(() => setMode('expanded'));
    assert.equal(await page.locator('[data-expression]:visible').count(), 3);
    assert(await page.locator('[data-expression="organized"][aria-pressed="true"]').count());
    results.saveRestartAndExitMode = true;
    assert.deepEqual(errors, []);
    const report = { passed: true, directory, results, errors };
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ directory, errors }));
    throw error;
  } finally { await electron.close().catch(() => {}); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
