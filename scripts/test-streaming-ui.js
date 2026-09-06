const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');

const root = path.resolve(__dirname, '..');

async function main() {
  const testData = await fs.mkdtemp(path.join(root, 'tmp', 'streaming-ui-'));
  await fs.writeFile(path.join(testData, 'settings.json'), JSON.stringify({
    provider: 'local', localEngine: 'paraformer', language: 'zh-en',
    localPythonPath: path.join(root, '.venv', 'Scripts', 'python.exe'),
    recordTriggerMode: 'tap', startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '',
    directPasteAfterShortcut: false, saveHistory: true
  }));
  const environment = { ...process.env, VOICE_PAD_TEST_DATA: testData };
  delete environment.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({
    executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [path.join(__dirname, 'test-electron-entry.js'),
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(root, 'models', 'paraformer-streaming-zh-en', 'test_wavs', '0.wav')}%noloop`,
      '--autoplay-policy=no-user-gesture-required'],
    env: environment,
    timeout: 45000
  });
  const errors = [];
  try {
    const page = await electron.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
    await page.locator('#recordToggle').click({ delay: 120 });
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('recording'));
    const started = Date.now();
    await page.waitForFunction(() => document.querySelector('#transcript').value.length > 0, { timeout: 15000 });
    const firstPartialMs = Date.now() - started;
    await page.waitForTimeout(3000);
    const partialText = await page.locator('#transcript').inputValue();
    assert(partialText);
    await page.screenshot({ path: path.join(testData, 'recording.png') });
    const beforeStop = Date.now();
    await page.locator('#recordToggle').click({ delay: 120 });
    await page.waitForFunction(() => !document.querySelector('#transcript').readOnly && !document.querySelector('#app').classList.contains('transcribing'));
    const stopMs = Date.now() - beforeStop;
    const finalText = await page.locator('#transcript').inputValue();
    assert(finalText);
    assert.equal(await page.locator('#statusLabel').innerText(), '转写完成');
    await page.screenshot({ path: path.join(testData, 'completed.png') });
    // Editing is preserved while a new recording is appended.
    const prefix = '这是我手动写的内容。';
    await page.locator('#transcript').fill(prefix);
    await page.locator('#recordToggle').click({ delay: 120 });
    await page.waitForFunction((base) => document.querySelector('#transcript').value.length > base.length, prefix, { timeout: 15000 });
    await page.locator('#recordToggle').click({ delay: 120 });
    await page.waitForFunction(() => !document.querySelector('#transcript').readOnly);
    const appended = await page.locator('#transcript').inputValue();
    assert(appended.startsWith(prefix), appended);
    assert.equal(appended.split(prefix).length - 1, 1);
    await page.locator('#hideButton').click();
    assert(await page.locator('#recordToggle').isVisible());
    assert(!(await page.locator('#transcript').isVisible()));
    await page.locator('#settingsToggle').click();
    assert(!(await page.locator('#openaiApiKey').isVisible()));
    assert(!(await page.locator('#localModel').isVisible()));
    await page.locator('#localEngine').selectOption('whisper');
    assert(await page.locator('#localModel').isVisible());
    assert((await page.locator('#engineLabel').textContent()).includes('本地流式'));
    await page.locator('#closeSettings').click();
    assert.equal(await page.locator('#localEngine').inputValue(), 'paraformer');
    await page.locator('#settingsToggle').click();
    await page.locator('#language').selectOption('zh');
    await page.locator('#saveSettingsTop').click();
    await page.waitForFunction(() => document.querySelector('#settingsStatus').textContent.includes('已保存'));
    assert.equal(await page.locator('#engineLabel').textContent(), '本地流式 · 中文');
    await page.screenshot({ path: path.join(testData, 'settings.png') });
    await page.locator('#closeSettings').click();
    // A key release arriving during startup must stop that same recording.
    await electron.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.send('shortcut:start-stop', { direct: true, action: 'start' });
      window.webContents.send('shortcut:start-stop', { direct: true, action: 'stop' });
    });
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => isRecordingBusy()), false);
    assert((await page.locator('#transcript').inputValue()).startsWith(prefix));
    await page.locator('#clearTranscriptButton').click();
    assert.equal(await page.locator('#transcript').inputValue(), '');
    // Exercise the actual Windows text-insertion path into an isolated target window.
    await page.evaluate(() => api.saveSettings({ directPasteAfterShortcut: true, inputMethod: 'type' }).then(fillSettingsForm));
    const target = await electron.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({ width: 600, height: 220, show: true });
      window.loadURL('data:text/html,<title>Voice Pad Test Target</title><textarea id="target" autofocus style="width:90%;height:120px"></textarea>');
      return { id: window.id, hwnd: Number(window.getNativeWindowHandle().readBigUInt64LE()) };
    });
    const targetPage = await electron.waitForEvent('window');
    await targetPage.locator('#target').fill('测试前缀：');
    await targetPage.locator('#target').press('End');
    await electron.evaluate(({ BrowserWindow }, hwnd) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html'))
        .webContents.send('shortcut:start-stop', { direct: true, action: 'start', targetHwnd: hwnd });
    }, target.hwnd);
    await page.waitForFunction(() => transcript.value.length > 0);
    await page.waitForTimeout(1500);
    await electron.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith('/index.html'))
        .webContents.send('shortcut:start-stop', { direct: true, action: 'stop' });
    });
    await page.waitForFunction(() => !isRecordingBusy());
    const insertedText = await targetPage.locator('#target').inputValue();
    assert(insertedText.startsWith('测试前缀：'));
    assert(insertedText.length > '测试前缀：'.length, await page.locator('#statusLabel').textContent());
    assert.equal(insertedText.slice('测试前缀：'.length), await page.locator('#transcript').inputValue());
    await electron.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), target.id);
    assert.deepEqual(errors, []);
    const result = { passed: true, testData, firstPartialMs, stopMs, partialText, finalText, appended, insertedText, errors };
    await fs.writeFile(path.join(testData, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await electron.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
