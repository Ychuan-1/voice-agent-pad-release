const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');

async function launch(directory) {
  const env = { ...process.env, VOICE_PAD_TEST_DATA: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(__dirname, 'test-electron-entry.js'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(root, 'models', 'paraformer-streaming-zh-en', 'test_wavs', '0.wav')}%noloop`],
    env, timeout: 45000
  });
  const page = await electron.firstWindow();
  await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
  return { electron, page };
}

async function main() {
  const directory = await fs.mkdtemp(path.join(root, 'tmp', 'product-ui-'));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({
    provider: 'local', localEngine: 'paraformer', language: 'zh-en', recordTriggerMode: 'tap',
    localPythonPath: path.join(root, '.venv', 'Scripts', 'python.exe'),
    startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '', directPasteAfterShortcut: false,
    expressionMode: 'original', saveHistory: true, saveDraft: true,
    dictionary: [{ from: '奥比西安', to: 'Obsidian', enabled: true }]
  }));
  await fs.writeFile(path.join(directory, 'draft.json'), JSON.stringify({ text: '恢复的草稿。', revision: null }));
  let { electron, page } = await launch(directory);
  const errors = [];
  const recordErrors = () => page.on('pageerror', (error) => errors.push(error.message));
  recordErrors();
  const results = {};
  try {
    assert.equal(await page.locator('#transcript').inputValue(), '恢复的草稿。');
    await page.locator('#settingsToggle').click();
    assert.equal(await page.locator('[data-view="dictionary"], #addDictionaryEntry, #correctionSuggestion').count(), 0);
    assert.equal((await page.evaluate(() => api.getSettings())).dictionary, undefined);
    await page.screenshot({ path: path.join(directory, 'settings-no-dictionary.png') });
    await page.locator('#closeSettings').click();
    await page.evaluate(() => setMode('expanded'));
    await page.locator('#transcript').fill('請把奥比西安的資料保存九月五日七点半提醒我预算一百二十元');
    await page.locator('#processTextButton').click();
    await page.waitForFunction(() => !isRecordingBusy());
    const formatted = await page.locator('#transcript').inputValue();
    assert(formatted.includes('奥比西安'));
    assert(!formatted.includes('Obsidian'));
    assert(formatted.includes('9月5日7:30'));
    assert(formatted.includes('120元'));
    assert(!formatted.includes('請'));
    await page.locator('#revisionDetails summary').click();
    assert((await page.locator('#revisionDiff ins').count()) > 0);
    await page.locator('#restoreOriginalButton').click();
    assert((await page.locator('#transcript').inputValue()).startsWith('請把'));
    results.removedDictionaryAndFormatting = true;

    await page.locator('[data-expression="daily"]').click();
    await page.locator('#transcript').fill('那个你今晚有空吗要不一起吃个饭我七点不对七点半才下班');
    await page.locator('#processTextButton').click();
    await page.waitForFunction(() => !isRecordingBusy(), { timeout: 60000 });
    const daily = await page.locator('#transcript').inputValue();
    assert(daily.includes('下班'));
    assert.equal(await page.locator('#statusLabel').innerText(), '整理完成，请确认后输入');
    await page.screenshot({ path: path.join(directory, 'daily.png') });
    results.daily = daily;

    // Deterministic delayed engine response exercises cancellation, not model quality.
    await electron.evaluate(() => {
      globalThis.__originalRewrite = globalThis.voicePadTestEditor.prototype.rewrite;
      globalThis.voicePadTestEditor.prototype.rewrite = async () => { await new Promise((resolve) => setTimeout(resolve, 800)); return '迟到的结果不能覆盖草稿。'; };
    });
    const original = '我不想发送这段话';
    await page.locator('#transcript').fill(original);
    await page.locator('#processTextButton').click();
    await page.waitForFunction(() => !!featureState.request);
    await page.locator('#cancelTaskButton').click();
    await page.waitForFunction(() => !isRecordingBusy());
    assert.equal(await page.locator('#transcript').inputValue(), original);
    await electron.evaluate(() => { globalThis.voicePadTestEditor.prototype.rewrite = globalThis.__originalRewrite; });
    results.cancelLateResult = true;

    await page.locator('[data-expression="original"]').click();
    await page.locator('#recordToggle').click({ delay: 100 });
    await page.waitForFunction(() => !!activeStreaming && mediaRecorder?.state === 'recording');
    await page.waitForTimeout(1700);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !isRecordingBusy());
    assert((await page.locator('#transcript').inputValue()).startsWith(original));
    assert.equal(await page.evaluate(() => mediaStream), null);
    results.cancelRecording = true;

    await page.evaluate(async () => {
      await api.saveTranscript('这是可搜索的最终文字', 'local-editor', { original: '词库测试原文', mode: 'daily' });
      await api.saveTranscript('另一条不匹配', 'local');
    });
    await page.locator('#settingsToggle').click();
    await page.locator('[data-view="history"]').click();
    await page.locator('#historySearch').fill('词库测试原文');
    assert.equal(await page.locator('.history-item').count(), 1);
    await page.getByRole('button', { name: '置顶', exact: true }).click();
    await page.waitForFunction(() => featureState.history.some((row) => row.pinned));
    await page.screenshot({ path: path.join(directory, 'history.png') });
    results.historySearchAndPin = true;

    await page.locator('[data-view="general"]').click();
    await page.locator('#standbyMode').selectOption('eco');
    await page.locator('#saveSettingsTop').click();
    await page.waitForFunction(() => settingsStatus.textContent.includes('已保存'));
    await page.locator('#releaseModels').click();
    await page.waitForFunction(() => document.querySelector('#resourceStatus').textContent.includes('识别待唤醒'));
    const sleep = await page.evaluate(() => api.featureStatus());
    assert.equal(sleep.running, false);
    assert.equal(sleep.asrRunning, false);
    await page.locator('#closeSettings').click();
    await page.evaluate(() => setMode('expanded'));
    await page.locator('#clearTranscriptButton').click();
    await page.locator('#recordToggle').click({ delay: 100 });
    await page.waitForFunction(() => transcript.value.length > 0);
    await page.locator('#recordToggle').click({ delay: 100 });
    await page.waitForFunction(() => !isRecordingBusy());
    assert((await page.locator('#transcript').inputValue()).length > 0);
    results.unloadAndResume = true;

    const clipboardBefore = await electron.evaluate(({ clipboard }) => clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format).toString('base64')]));
    const target = await electron.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({ width: 600, height: 220 });
      globalThis.voicePadInputTestWindow = window;
      window.loadURL('data:text/html,<title>Voice Pad Clipboard Test</title><textarea id="target" autofocus></textarea><script>window.enterCount=0;document.addEventListener("keydown",e=>{if(e.key==="Enter")window.enterCount++})</script>');
      return { id: window.id, hwnd: Number(window.getNativeWindowHandle().readBigUInt64LE()) };
    });
    const targetPage = await electron.waitForEvent('window');
    await targetPage.locator('#target').fill('前缀：');
    await targetPage.locator('#target').press('End');
    const typed = await page.evaluate((hwnd) => api.pasteText('直接输入\n第二行', { targetHwnd: hwnd, inputMethod: 'type', saveHistory: false }), target.hwnd);
    assert(typed.ok, JSON.stringify(typed));
    assert.equal(await targetPage.locator('#target').inputValue(), '前缀：直接输入 第二行');
    assert.equal(await targetPage.evaluate(() => window.enterCount), 0);
    const clipboardAfterType = await electron.evaluate(({ clipboard }) => clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format).toString('base64')]));
    assert.deepEqual(clipboardAfterType, clipboardBefore);
    await targetPage.locator('#target').press('End');
    const pasted = await page.evaluate((hwnd) => api.pasteText('剪贴板输入\n保留换行', { targetHwnd: hwnd, inputMethod: 'paste', saveHistory: false }), target.hwnd);
    assert(pasted.ok, JSON.stringify(pasted));
    assert.equal(await targetPage.locator('#target').inputValue(), '前缀：直接输入 第二行剪贴板输入\n保留换行');
    const clipboardAfterPaste = await electron.evaluate(({ clipboard }) => clipboard.availableFormats().map((format) => [format, clipboard.readBuffer(format).toString('base64')]));
    assert.deepEqual(clipboardAfterPaste, clipboardBefore);
    await page.evaluate(async () => fillSettingsForm(await api.saveSettings({ language: 'zh-to-en', expressionMode: 'daily', cleanupPreview: false, directPasteAfterShortcut: true })));
    const existingTarget = await targetPage.locator('#target').inputValue();
    await electron.evaluate(({ BrowserWindow }, hwnd) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html'))
        .webContents.send('shortcut:start-stop', { direct: true, action: 'start', targetHwnd: hwnd });
    }, target.hwnd);
    await page.waitForFunction(() => mediaRecorder?.state === 'recording');
    await page.waitForTimeout(2800);
    await electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html'))
        .webContents.send('shortcut:start-stop', { direct: true, action: 'stop' });
    });
    await page.waitForFunction(() => !isRecordingBusy());
    assert.equal(await page.evaluate(() => featureState.revision?.mode), 'translate-en');
    assert.equal(await page.evaluate(() => featureState.revision?.needsReview), true);
    assert.equal(await page.evaluate(() => featureState.revision?.notice), '');
    assert(!/[\p{Script=Han}]/u.test(await page.evaluate(() => featureState.revision.text)));
    assert.equal(await targetPage.locator('#target').inputValue(), existingTarget);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'transcript');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !isRecordingBusy());
    const once = await targetPage.locator('#target').inputValue();
    assert(once.length > existingTarget.length);
    await page.evaluate(() => pasteText());
    assert.equal(await targetPage.locator('#target').inputValue(), once);
    assert.equal(await targetPage.evaluate(() => window.enterCount), 0);
    results.translationReviewBeforeInputAndNoDuplicate = true;
    await electron.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), target.id);
    results.clipboardPreserved = true;

    await page.locator('#transcript').fill('退出前刚写的草稿也要保存。');
    await electron.close();
    ({ electron, page } = await launch(directory));
    recordErrors();
    assert.equal(await page.locator('#transcript').inputValue(), '退出前刚写的草稿也要保存。');
    await page.evaluate(() => setMode('expanded'));
    await page.locator('#clearTranscriptButton').click();
    await electron.close();
    ({ electron, page } = await launch(directory));
    recordErrors();
    assert.equal(await page.locator('#transcript').inputValue(), '');
    results.draftRecoveryAndClear = true;
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: true, directory, results, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, directory, results, errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'failed.png') }).catch(() => {});
    console.error(JSON.stringify({ directory, errors, state: await page.evaluate(() => ({ status: statusLabel.textContent, busy: isRecordingBusy() })).catch(() => null) }));
    throw error;
  } finally { await electron.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
