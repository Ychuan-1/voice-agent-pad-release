const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { NativeLiveInput, LiveInputSession } = require('../src/live-input');
const root = path.resolve(__dirname, '..');

async function main() {
  const directory = await fs.mkdtemp(path.join(root, 'tmp', 'live-input-ui-'));
  await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify({ provider: 'local', localEngine: 'paraformer', language: 'zh-en',
    startStopShortcut: '', hideShowShortcut: '', pasteShortcut: '', liveExternalInput: true, expressionMode: 'original' }));
  const env = { ...process.env, VOICE_PAD_TEST_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE;
  const electron = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [path.join(__dirname, 'test-electron-entry.js'), '--force-renderer-accessibility'], env, timeout: 45000 });
  const page = await electron.firstWindow();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const native = new NativeLiveInput(root);
  const live = new LiveInputSession(native);
  const results = {};
  try {
    await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady);
    await native.ensureReady();
    const target = await electron.evaluate(async ({ BrowserWindow }) => {
      const window = new BrowserWindow({ width: 620, height: 320, title: 'Live Input Test' });
      globalThis.liveTarget = window;
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<title>Live Input Test</title><textarea id="a" aria-label="First message" style="width:95%;height:80px"></textarea><textarea id="b" aria-label="Second message" style="width:95%;height:80px"></textarea><input type="password" id="password"><script>window.enters=0;document.addEventListener("keydown",e=>{if(e.key==="Enter")window.enters++})</script>'));
      window.show(); window.focus();
      return { id: window.id, hwnd: Number(window.getNativeWindowHandle().readBigUInt64LE()) };
    });
    const targetPage = (await electron.windows()).find((p) => p.url().startsWith('data:text/html'));
    await targetPage.evaluate(() => {
      const rich = document.createElement('div');
      rich.id = 'rich'; rich.contentEditable = 'true'; rich.setAttribute('role', 'textbox');
      rich.setAttribute('aria-multiline', 'true'); rich.textContent = '聊天：';
      document.body.append(rich);
    });
    async function focus(field = 'a') {
      await electron.evaluate(() => { globalThis.liveTarget.show(); globalThis.liveTarget.focus(); });
      await targetPage.locator('#' + field).focus();
      await targetPage.locator('#' + field).press('End');
      // Electron focus alone does not bypass Windows foreground activation rules.
      assert((await page.evaluate((hwnd) => api.pasteText('', {
        targetHwnd: hwnd, inputMethod: 'type', saveHistory: false
      }), target.hwnd)).ok);
      await targetPage.waitForTimeout(250);
    }
    await targetPage.locator('#a').fill('原有内容：'); await focus();
    const clipboard = await electron.evaluate(({ clipboard }) => clipboard.availableFormats().map((f) => [f, clipboard.readBuffer(f).toString('base64')]));
    const armed = await live.start('native', target.hwnd, 'F8');
    assert(armed.active, JSON.stringify(armed));
    live.update('native', '测试'); live.update('native', '测试实时');
    await live.flush(live.state);
    await targetPage.waitForFunction(() => document.querySelector('#a').value === '原有内容：测试');
    assert.equal(live.snapshot().active, true);
    const done = await live.finish('native', '测试实时输入。');
    assert(!done.blocked, JSON.stringify(done));
    await targetPage.waitForFunction(() => document.querySelector('#a').value === '原有内容：测试实时输入。');
    assert.equal(await targetPage.evaluate(() => window.enters), 0);
    results.nativeAppendWhileActive = true;

    await focus(); await live.start('change-field', target.hwnd, 'F8');
    await targetPage.locator('#b').focus();
    live.update('change-field', '禁止'); live.update('change-field', '禁止写入'); await live.flush(live.state);
    assert(live.snapshot().blocked);
    assert.equal(await targetPage.locator('#b').inputValue(), ''); await live.end();
    await focus(); await live.start('move-caret', target.hwnd, 'F8');
    await targetPage.locator('#a').press('Home');
    live.update('move-caret', '禁止'); live.update('move-caret', '禁止写入'); await live.flush(live.state);
    assert(live.snapshot().blocked); await live.end();
    await focus(); await targetPage.locator('#a').press('Control+A');
    assert.equal((await live.start('selection', target.hwnd, 'F8')).active, false); await live.end();
    await focus('password');
    assert.equal((await live.start('password', target.hwnd, 'F8')).active, false); await live.end();
    await targetPage.locator('#b').evaluate((field) => { field.readOnly = true; });
    await focus('b');
    assert.equal((await live.start('readonly', target.hwnd, 'F8')).active, false); await live.end();
    results.fieldCaretSelectionPasswordReadonlyGuards = true;

    await focus('rich');
    const richArm = await live.start('richtext', target.hwnd, 'F8');
    assert(richArm.active, JSON.stringify(richArm));
    live.update('richtext', '实时'); live.update('richtext', '实时聊天'); await live.flush(live.state);
    await targetPage.waitForFunction(() => document.querySelector('#rich').textContent === '聊天：实时');
    assert(!(await live.finish('richtext', '实时聊天。')).blocked);
    await targetPage.waitForFunction(() => document.querySelector('#rich').textContent === '聊天：实时聊天。');
    results.contentEditableChatInput = true;

    await focus();
    const before = await targetPage.locator('#a').inputValue();
    // The same main-process IPC and partial events used by recording, with deterministic ASR hypotheses.
    await page.evaluate(async (hwnd) => { await api.recordingActivity(true); window.liveTestArm = await api.beginLiveInput('ipc-live', hwnd); await api.hide(); }, target.hwnd);
    assert(await page.evaluate(() => window.liveTestArm.active), JSON.stringify(await page.evaluate(() => window.liveTestArm)));
    const windowState = await electron.evaluate(({ BrowserWindow, screen }) => ({
      mainVisible: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible(),
      hud: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/hud.html')).getBounds(),
      area: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    }));
    assert.equal(windowState.mainVisible, false);
    assert(Math.abs(windowState.hud.x + windowState.hud.width / 2 - windowState.area.x - windowState.area.width / 2) <= 1);
    assert(Math.abs(windowState.hud.y - (windowState.area.y + windowState.area.height - 100)) <= 1);
    const hud = (await electron.windows()).find((p) => p.url().endsWith('/hud.html'));
    await page.evaluate(() => { api.hudLevel(0.8, 12); api.hudStatus('recording'); });
    await hud.waitForFunction(() => document.getElementById('duration').textContent === '0:12');
    await hud.screenshot({ path: path.join(directory, 'bottom-waveform.png') });
    const active = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id);
    assert.equal(active, target.id);
    await page.evaluate(() => api.showPreview());
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/index.html')).isVisible()), false);
    const final = await page.evaluate(() => api.finishLiveInput('ipc-live', '后台输入。'));
    assert(!final.blocked, JSON.stringify(final));
    await targetPage.waitForFunction((value) => document.querySelector('#a').value === value, before + '后台输入。');
    await page.evaluate(() => api.recordingActivity(false));
    await page.waitForTimeout(1200);
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/hud.html')).isVisible()), false);
    assert.deepEqual(await electron.evaluate(({ clipboard }) => clipboard.availableFormats().map((f) => [f, clipboard.readBuffer(f).toString('base64')])), clipboard);
    results.minimizedHudPositionNoFocusOrClipboardChange = true;
    assert.deepEqual(errors, []);
    const report = { passed: true, directory, results, errors };
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    console.error(JSON.stringify({ directory, errors })); throw error;
  } finally { live.stop(); await electron.close().catch(() => {}); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
