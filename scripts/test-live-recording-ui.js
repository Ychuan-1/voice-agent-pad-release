const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const sourceRoot = path.resolve(__dirname, '..');
const packageDirectory = process.env.VOICE_PAD_PACKAGE_DIR;
const root = packageDirectory ? path.join(packageDirectory, 'resources', 'app') : sourceRoot;

async function main() {
  const directory = await fs.mkdtemp(path.join(sourceRoot, 'tmp', 'live-recording-ui-'));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ provider: 'local', localEngine: 'paraformer', language: 'zh-en',
    startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '', recordTriggerMode: 'tap', liveExternalInput: true,
    expressionMode: 'daily', directPasteAfterShortcut: true, localPythonPath: path.join(root, '.venv/Scripts/python.exe') }));
  const env = { ...process.env, VOICE_PAD_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  if (packageDirectory) { delete env.NODE_PATH; delete env.PYTHONHOME; delete env.PYTHONPATH; env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot};${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`; }
  const electron = await _electron.launch({ executablePath: packageDirectory ? path.join(packageDirectory, 'VoiceAgentPad.exe') : path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packageDirectory ? [] : [path.join(__dirname, 'test-electron-entry.js')]), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.join(root, 'models/paraformer-streaming-zh-en/test_wavs/0.wav')}%noloop`], env, timeout: 45000 });
  const page = await electron.firstWindow();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const results = [];
  try {
    await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
    if (packageDirectory) {
      const settings = await page.evaluate(() => api.getSettings());
      assert.equal(settings.bundledRuntime, true);
      assert.equal(settings.localPythonPath, path.join(root, 'runtime', 'python', 'python.exe'));
      assert.equal(settings.openaiApiKey, '');
      assert.equal(await page.evaluate(() => transcript.value), '');
      assert.deepEqual(await page.evaluate(() => featureState.history), []);
      assert(await electron.evaluate(({ app }) => app.isPackaged));
      results.push({ portableRuntime: true, emptyPersonalData: true, noDeveloperPathEnvironment: true });
    }
    const target = await electron.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 650, height: 300 }); globalThis.liveRecordingTarget = w;
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>Live Recording Target</title><textarea id="message" aria-label="Message" style="width:95%;height:200px"></textarea><script>window.enters=0;document.addEventListener("keydown",e=>{if(e.key==="Enter")window.enters++})</script>'));
      return { hwnd: Number(w.getNativeWindowHandle().readBigUInt64LE()) };
    });
    const targetPage = (await electron.windows()).find((p) => p.url().startsWith('data:text/html'));
    for (const hidden of [false, true]) {
      if (hidden) await page.evaluate(() => api.hide());
      await targetPage.locator('#message').fill('已有内容：');
      await electron.evaluate(() => { globalThis.liveRecordingTarget.show(); globalThis.liveRecordingTarget.focus(); });
      await targetPage.locator('#message').focus(); await targetPage.locator('#message').press('End');
      // BrowserWindow.focus() can be only logical focus under Windows foreground
      // lock. Activate this owned test window through the existing native path.
      assert((await page.evaluate((hwnd) => api.pasteText('', { targetHwnd: hwnd, inputMethod: 'type', saveHistory: false }), target.hwnd)).ok);
      await targetPage.waitForTimeout(300);
      await page.evaluate(() => clearTranscript());
      await electron.evaluate(({ BrowserWindow }, hwnd) => {
        BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).webContents.send('shortcut:start-stop', { direct: true, action: 'start', targetHwnd: hwnd });
      }, target.hwnd);
      await page.waitForFunction(() => mediaRecorder?.state === 'recording', null, { timeout: 30000 });
      assert(await page.evaluate(() => featureState.live?.active), JSON.stringify(await page.evaluate(() => featureState.live)));
      await targetPage.waitForFunction(() => document.querySelector('#message').value.length > '已有内容：'.length, null, { timeout: 20000 });
      assert.equal(await page.evaluate(() => mediaRecorder?.state), 'recording');
      const during = await targetPage.locator('#message').inputValue();
      assert(await page.evaluate(() => transcript.value.length > 0));
      if (!hidden) {
        assert(await page.evaluate(() => appShell.classList.contains('expanded')));
        assert(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible()));
      }
      if (hidden) {
        const visible = await electron.evaluate(({ BrowserWindow }) => ({
          main: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible(),
          hud: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/hud.html')).isVisible()
        }));
        assert.deepEqual(visible, { main: false, hud: true });
        const hud = (await electron.windows()).find((p) => p.url().endsWith('/hud.html'));
        await hud.screenshot({ path: path.join(directory, 'recording-waveform.png') });
      }
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).webContents.send('shortcut:start-stop', { direct: true, action: 'stop' }));
      await page.waitForFunction(() => !isRecordingBusy(), null, { timeout: 45000 });
      const final = await page.evaluate(() => ({ live: featureState.live, revision: featureState.revision, pending: featureState.pendingInsertion, status: statusLabel.textContent }));
      assert(!final.live.blocked, JSON.stringify(final));
      assert.equal(final.revision.mode, 'original');
      const text = await targetPage.locator('#message').inputValue();
      assert.equal(text, '已有内容：' + final.revision.text);
      await page.evaluate(() => pasteText());
      assert.equal(await targetPage.locator('#message').inputValue(), text);
      assert.equal(await targetPage.evaluate(() => window.enters), 0);
      if (hidden) assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible()), false);
      results.push({ hidden, duringRecording: during, finalText: text });
    }
    await page.evaluate(async () => fillSettingsForm(await api.saveSettings({ language: 'zh-to-en' })));
    await targetPage.locator('#message').fill('翻译前缀：');
    await targetPage.locator('#message').focus(); await targetPage.locator('#message').press('End');
    assert((await page.evaluate((hwnd) => api.pasteText('', { targetHwnd: hwnd, inputMethod: 'type', saveHistory: false }), target.hwnd)).ok);
    await page.evaluate(() => clearTranscript());
    await electron.evaluate(({ BrowserWindow }, hwnd) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).webContents.send('shortcut:start-stop', { direct: true, action: 'start', targetHwnd: hwnd }), target.hwnd);
    await page.waitForFunction(() => mediaRecorder?.state === 'recording');
    await page.waitForTimeout(3000);
    assert.equal(await targetPage.locator('#message').inputValue(), '翻译前缀：');
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).webContents.send('shortcut:start-stop', { direct: true, action: 'stop' }));
    await page.waitForFunction(() => !isRecordingBusy(), null, { timeout: 90000 });
    const translation = await page.evaluate(() => featureState.revision);
    assert.equal(translation.mode, 'translate-en'); assert.equal(translation.notice, '');
    assert.equal(await targetPage.locator('#message').inputValue(), '翻译前缀：');
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible()), false);
    await page.evaluate(() => pasteText());
    assert.equal(await targetPage.locator('#message').inputValue(), '翻译前缀：' + translation.text);
    assert.equal(await targetPage.evaluate(() => window.enters), 0);
    results.push({ hidden: true, translationReview: true, translated: translation.text });
    assert.deepEqual(errors, []);
    const report = { passed: true, directory, packageDirectory, results, errors };
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), hwnd: Number(w.getNativeWindowHandle().readBigUInt64LE()), focused: w.isFocused() })))));
    console.error(JSON.stringify({ directory, errors, state: await page.evaluate(() => ({ live: featureState.live, status: statusLabel.textContent, recording: mediaRecorder?.state })).catch(() => null) }));
    throw error;
  } finally { await electron.close().catch(() => {}); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
