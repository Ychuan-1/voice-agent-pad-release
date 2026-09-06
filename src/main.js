const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, session, shell, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { StreamingAsrClient } = require('./streaming-asr');
const { LocalStore, pruneHistory } = require('./local-store');
const { featureDefaults, normalizeFeatures, formatText, prepareDailyText, inspectRewrite, inspectTranslation, textDifference, simplify } = require('./text-tools');
const { LocalEditor } = require('./local-editor');
const { withTemporaryClipboard } = require('./clipboard-guard');
const { DictionaryPacks } = require('./dictionary-packs');
const dictionaryCatalog = require('../resources/dictionary-catalog.json');
const { NativeLiveInput, LiveInputSession } = require('./live-input');
const { RecordingHud } = require('./recording-hud');

const APP_NAME = 'Voice Agent Pad';
const COMPACT_SIZE = { width: 116, height: 116 };
const EXPANDED_SIZE = { width: 700, height: 410 };
const SETTINGS_SIZE = { width: 620, height: 560 };
const PROJECT_ROOT = path.join(__dirname, '..');
const BUNDLED_PYTHON = path.join(PROJECT_ROOT, 'runtime', 'python', 'python.exe');
const BUNDLED_RUNTIME = fs.existsSync(BUNDLED_PYTHON);
const PROJECT_VENV_PYTHON = BUNDLED_RUNTIME ? BUNDLED_PYTHON : path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
if (BUNDLED_RUNTIME) {
  const isolated = process.env.VOICE_PAD_TEST_DATA;
  app.setPath('userData', isolated && path.isAbsolute(isolated) ? isolated : path.join(app.getPath('appData'), 'VoiceAgentPad'));
  app.setAppUserModelId('VoiceAgentPad.Desktop');
}

let mainWindow;
let settings = {};
let localWorker = null;
let localWorkerKey = '';
let localWorkerBuffer = '';
let localWorkerRequestId = 0;
let localWorkerStartupError = '';
const localWorkerPending = new Map();
let holdHotkeyProcess = null;
let holdHotkeyBuffer = '';
let holdHotkeyActive = false;
let streamingClient = null;
let streamingSession = null;
let store;
let tray;
let idleTimer;
let lastActivity = Date.now();
let recordingActive = false;
let legacyRequests = 0;
const editor = new LocalEditor(PROJECT_ROOT);
const editingJobs = new Map();
let inputQueue = Promise.resolve();
let quitPrepared = false;
let dictionaryPacks;
let backgroundMode = false;
let aiExtensionJob = null;
const recordingHud = new RecordingHud();
const liveInput = new LiveInputSession(new NativeLiveInput(PROJECT_ROOT), (state) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('live:state', state);
  if (state.blocked && backgroundMode) recordingHud.update({ status: 'blocked' });
});

function getDictionaryPacks() {
  dictionaryPacks ||= new DictionaryPacks(app.getPath('userData'), dictionaryCatalog, {
    onChange: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('packs:changed');
    }
  });
  return dictionaryPacks;
}

const defaultSettings = {
  ...featureDefaults,
  provider: 'local',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini-transcribe',
  language: 'zh',
  micDeviceId: '',
  localEngine: 'paraformer',
  localPythonPath: PROJECT_VENV_PYTHON,
  localModel: 'base',
  localSenseVoiceModel: 'iic/SenseVoiceSmall',
  localDevice: 'cpu',
  recordTriggerMode: 'tap',
  startStopShortcut: 'F8',
  hideShowShortcut: 'CommandOrControl+Alt+H',
  pasteShortcut: 'CommandOrControl+Alt+Enter',
  directPasteAfterShortcut: true,
  inputMethod: 'type',
  liveInputMode: 'compatible',
  autoHideAfterPaste: false,
  launchAtLogin: false,
  aiExtensionUrl: '',
  saveHistory: true,
  maxHistoryItems: 200
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function dataPath(fileName) {
  return path.join(app.getPath('userData'), fileName);
}

async function readJson(fileName, fallback) {
  store ||= new LocalStore(app.getPath('userData'));
  return store.read(fileName, fallback);
}

async function writeJson(fileName, value) {
  store ||= new LocalStore(app.getPath('userData'));
  return store.write(fileName, value);
}

async function loadSettings() {
  settings = normalizeFeatures({ ...defaultSettings, ...(await readJson('settings.json', {})) });
  if (BUNDLED_RUNTIME) Object.assign(settings, { bundledRuntime: true, localPythonPath: BUNDLED_PYTHON, localEngine: 'paraformer', localDevice: 'cpu' });
  settings.language = normalizeLanguageSetting(settings.language);
  settings.inputMethod = normalizeInputMethod(settings.inputMethod);
  settings.launchAtLogin = readLaunchAtLogin(settings.launchAtLogin);
  return settings;
}

async function saveSettings(nextSettings) {
  if (streamingSession || recordingActive || editingJobs.size || legacyRequests) throw new Error('请结束当前录音或整理后再保存设置。');
  const next = normalizeFeatures({ ...defaultSettings, ...settings, ...nextSettings });
  if (BUNDLED_RUNTIME) Object.assign(next, { bundledRuntime: true, localPythonPath: BUNDLED_PYTHON, localEngine: 'paraformer', localDevice: 'cpu' });
  next.language = normalizeLanguageSetting(next.language);
  next.inputMethod = normalizeInputMethod(next.inputMethod);
  next.launchAtLogin = !!next.launchAtLogin;
  applyLaunchAtLogin(next.launchAtLogin);
  next.launchAtLogin = readLaunchAtLogin(next.launchAtLogin);
  await writeJson('settings.json', next);
  settings = next;
  if (!settings.saveDraft) await writeJson('draft.json', { text: '', revision: null });
  if (
    Object.prototype.hasOwnProperty.call(nextSettings, 'localEngine')
    || Object.prototype.hasOwnProperty.call(nextSettings, 'localPythonPath')
    || Object.prototype.hasOwnProperty.call(nextSettings, 'localModel')
    || Object.prototype.hasOwnProperty.call(nextSettings, 'localSenseVoiceModel')
    || Object.prototype.hasOwnProperty.call(nextSettings, 'localDevice')
  ) {
    stopLocalWorker();
    stopStreamingClient();
  }
  registerShortcuts();
  warmStreamingClient();
  updateTray();
  return settings;
}

function stopStreamingClient() {
  const previous = streamingClient;
  streamingClient = null;
  streamingSession = null;
  previous?.stop();
}

function getStreamingClient() {
  if (!streamingClient) {
    const client = new StreamingAsrClient({ root: PROJECT_ROOT, python: settings.localPythonPath || PROJECT_VENV_PYTHON });
    streamingClient = client;
    client.on('partial', (message) => {
      if (streamingClient === client && message.session === streamingSession && !mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send('streaming:partial', message);
        liveInput.update(message.session, message.text);
      }
    });
    client.on('failure', (error) => {
      if (streamingClient !== client) return;
      if (streamingSession && !mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send('streaming:failure', { session: streamingSession, error: error.message });
      }
      streamingSession = null;
      void liveInput.end();
    });
  }
  return streamingClient;
}

function warmStreamingClient() {
  lastActivity = Date.now();
  if (settings.provider === 'local' && getLocalEngine() === 'paraformer') {
    getStreamingClient().ensureReady().catch((error) => console.warn(error.message));
  } else {
    stopStreamingClient();
  }
}

async function appendHistory(text, provider, action = 'transcribed', detail = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText || !settings.saveHistory) {
    return [];
  }

  return store.update('history.json', [], (history) => pruneHistory([{
    id: randomUUID(), text: cleanText, provider, action,
    original: String(detail.original || cleanText),
    expressionMode: detail.mode || 'original',
    createdAt: new Date().toISOString(), pinned: false
  }, ...history], settings));
}

async function getHistory() {
  return store.update('history.json', [], (history) => pruneHistory(history, settings));
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip('语音输入助手');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示语音输入', click: () => showMainWindow() },
    { label: '开机自启动', type: 'checkbox', checked: !!settings.launchAtLogin, click: async () => {
      try {
        await saveSettings({ launchAtLogin: !settings.launchAtLogin });
        mainWindow?.webContents.send('app:settings-updated', settings);
      } catch (error) { console.warn(error.message); updateTray(); }
    } },
    { label: '节能待命', type: 'checkbox', checked: settings.standbyMode === 'eco', click: async () => {
      try {
        await saveSettings({ standbyMode: settings.standbyMode === 'eco' ? 'fast' : 'eco' });
        mainWindow?.webContents.send('app:settings-updated', settings);
      } catch (error) { console.warn(error.message); updateTray(); }
    } },
    { label: '释放空闲模型', click: () => releaseIdleModels(true) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
}

function getLoginItemOptions(openAtLogin = false) {
  const options = { openAtLogin: !!openAtLogin, path: process.execPath };
  if (process.defaultApp) options.args = [app.getAppPath()];
  return options;
}

function readLaunchAtLogin(fallback = false) {
  try {
    return !!app.getLoginItemSettings(getLoginItemOptions()).openAtLogin;
  } catch {
    return !!fallback;
  }
}

function applyLaunchAtLogin(enabled) {
  try {
    app.setLoginItemSettings(getLoginItemOptions(enabled));
  } catch (error) {
    console.warn('Launch at login:', error.message);
  }
}

function releaseIdleModels(force = false) {
  if (recordingActive || streamingSession || legacyRequests || editingJobs.size) return false;
  const idle = Date.now() - lastActivity;
  if (force || (settings.standbyMode === 'eco' && idle >= settings.idleMinutes * 60000)) {
    stopStreamingClient();
    stopLocalWorker();
    editor.stop();
    return true;
  }
  if (Date.now() - editor.lastUsed > settings.idleMinutes * 60000) editor.stop();
  return false;
}

function sendAiExtensionProgress(state) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai-extension:progress', state);
  }
}

function assertCanInstallAiExtension() {
  if (recordingActive || streamingSession || legacyRequests || editingJobs.size) {
    throw new Error('请结束录音或整理后再安装 AI 扩展。');
  }
  if (aiExtensionJob) {
    throw new Error('AI 扩展正在处理中。');
  }
}

function requestUrl(rawUrl, redirectCount = 0) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('下载链接只支持 http 或 https。');
  }
  const client = url.protocol === 'https:' ? https : http;
  return { url, client, redirectCount };
}

function downloadFile(rawUrl, target, controller) {
  return new Promise((resolve, reject) => {
    const run = (urlText, redirectCount = 0) => {
      let requestInfo;
      try {
        requestInfo = requestUrl(urlText, redirectCount);
      } catch (error) {
        reject(error);
        return;
      }
      const { url, client } = requestInfo;
      const request = client.get(url, { headers: { 'User-Agent': 'VoiceAgentPad-AI-Extension' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          if (redirectCount >= 5) {
            reject(new Error('下载重定向次数过多。'));
            return;
          }
          run(new URL(response.headers.location, url).toString(), redirectCount + 1);
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`下载失败：HTTP ${response.statusCode}`));
          return;
        }

        const total = Number(response.headers['content-length']) || 0;
        let received = 0;
        const output = fs.createWriteStream(target);
        response.on('data', (chunk) => {
          received += chunk.length;
          sendAiExtensionProgress({ phase: 'download', received, total });
        });
        response.pipe(output);
        output.on('finish', () => output.close(resolve));
        output.on('error', reject);
      });
      request.on('error', reject);
      controller.signal.addEventListener('abort', () => {
        request.destroy(new Error('下载已取消'));
      }, { once: true });
    };
    run(rawUrl);
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function expandZip(zipPath, targetPath) {
  return new Promise((resolve, reject) => {
    const command = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(targetPath)} -Force`;
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      timeout: 20 * 60 * 1000,
      maxBuffer: 1024 * 1024
    }, (error) => {
      if (error) reject(new Error('AI 扩展解压失败：' + error.message.slice(-240)));
      else resolve();
    });
  });
}

async function findAiExtensionResources(directory) {
  const candidates = [];
  async function walk(current, depth = 0) {
    if (depth > 3) return;
    const resources = path.join(current, 'resources');
    const qwen = path.join(resources, 'app', 'models', 'text-editor', 'Qwen3-1.7B-Q8_0.gguf');
    const llama = path.join(resources, 'app', 'runtime', 'llama-b10816', 'llama-server.exe');
    if (fs.existsSync(qwen) && fs.existsSync(llama)) {
      candidates.push(resources);
      return;
    }
    for (const item of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (item.isDirectory()) await walk(path.join(current, item.name), depth + 1);
    }
  }
  await walk(directory);
  return candidates[0] || null;
}

async function installAiExtensionZip(zipPath) {
  assertCanInstallAiExtension();
  const controller = new AbortController();
  aiExtensionJob = { controller };
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'voice-agent-pad-ai-'));
  try {
    sendAiExtensionProgress({ phase: 'extract' });
    await expandZip(zipPath, tempDir);
    if (controller.signal.aborted) throw new Error('安装已取消');
    const resources = await findAiExtensionResources(tempDir);
    if (!resources) throw new Error('没有在 ZIP 中找到有效的 AI 扩展内容。');
    sendAiExtensionProgress({ phase: 'install' });
    await fsp.cp(path.join(resources, 'app', 'models', 'text-editor'), path.join(PROJECT_ROOT, 'models', 'text-editor'), { recursive: true, force: true });
    await fsp.cp(path.join(resources, 'app', 'runtime', 'llama-b10816'), path.join(PROJECT_ROOT, 'runtime', 'llama-b10816'), { recursive: true, force: true });
    const status = editor.status();
    if (!status.installed) throw new Error('AI 扩展复制完成，但模型或运行时仍未检测到。');
    sendAiExtensionProgress({ phase: 'done', status });
    return { ok: true, status };
  } finally {
    aiExtensionJob = null;
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadAndInstallAiExtension(urlText) {
  assertCanInstallAiExtension();
  const url = String(urlText || settings.aiExtensionUrl || '').trim();
  if (!url) {
    throw new Error('还没有设置 AI 扩展下载链接；可以先选择本地扩展 ZIP 安装。');
  }
  const controller = new AbortController();
  aiExtensionJob = { controller };
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'voice-agent-pad-ai-download-'));
  const zipPath = path.join(tempDir, 'ai-extension.zip');
  try {
    sendAiExtensionProgress({ phase: 'download', received: 0, total: 0 });
    await downloadFile(url, zipPath, controller);
  } catch (error) {
    aiExtensionJob = null;
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  aiExtensionJob = null;
  try {
    return await installAiExtensionZip(zipPath);
  } finally {
    fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processText(payload) {
  const id = String(payload?.id || '');
  const original = String(payload?.text || '').trim();
  if (!id || id.length > 100 || original.length > 100000) throw new Error('文字请求无效');
  if (editingJobs.size) throw new Error('上一段文字仍在整理');
  const current = { ...settings };
  const realtime = !!liveInput.state && liveInput.state.id === payload?.liveSession;
  const translating = current.language === 'zh-to-en';
  const mode = realtime ? 'original' : translating ? 'translate-en' : ['daily', 'organized'].includes(payload.mode) ? payload.mode : 'original';
  let baseline = formatText(original, realtime ? { ...current, formatNumbers: false } : current);
  const controller = new AbortController();
  editingJobs.set(id, controller);
  lastActivity = Date.now();
  const started = Date.now();
  let text = baseline;
  let notice = '';
  let warnings = [];
  try {
    const context = realtime ? { dictionary: [], terms: [] } : await getDictionaryPacks().context(original);
    controller.signal.throwIfAborted();
    baseline = formatText(original, realtime ? { ...current, formatNumbers: false } : current, context.dictionary);
    text = baseline;
    if (mode !== 'original' && baseline) {
      const limit = translating ? 1000 : 1600;
      if (baseline.length > limit) throw new Error(`这段超过 ${limit} 字，请分段${translating ? '翻译' : '整理'}`);
      const prepared = mode === 'daily' ? prepareDailyText(baseline) : baseline;
      text = simplify(await editor.rewrite(prepared, mode, controller.signal, context.terms));
      if (translating && (!/[a-z]/i.test(text) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text))) {
        throw new Error('没有得到完整英文译文');
      }
      if (!translating && (/[\u3040-\u30ff\uac00-\ud7af]/.test(text) || (current.language === 'en' && /[\u3400-\u9fff]/.test(text)))) {
        throw new Error('整理结果语言不符，已保留原文');
      }
      warnings = translating ? inspectTranslation(baseline, text) : inspectRewrite(baseline, text);
    }
  } catch (error) {
    if (controller.signal.aborted) return { cancelled: true };
    text = baseline;
    notice = translating ? `翻译未完成：${error.message || '本地模型错误'}，已保留原文。` : `${error.message || '本地整理失败'}，可直接使用原文。`;
  } finally {
    editingJobs.delete(id);
    lastActivity = Date.now();
  }
  return {
    original, text, baseline, mode, notice, warnings,
    needsReview: translating || !!notice || warnings.length > 0 || (mode !== 'original' && current.cleanupPreview),
    diff: textDifference(original, text), elapsedMs: Date.now() - started
  };
}

function normalizeLanguageSetting(language) {
  const value = String(language || '').trim().toLowerCase();
  if (value === 'zh-to-en') return value;
  if (value === 'en' || value === 'english') {
    return 'en';
  }
  if (value === 'zh-en' || value === 'zhen' || value === 'bilingual' || value === 'auto') {
    return 'zh-en';
  }
  return 'zh';
}

function getTranscriptionLanguage() {
  const language = normalizeLanguageSetting(settings.language || defaultSettings.language);
  // Keep embedded English names in Chinese speech; translation is a later step.
  return language === 'zh-to-en' ? 'zh-en' : language;
}

function getSingleLanguageHint() {
  const language = getTranscriptionLanguage();
  return language === 'zh-en' ? '' : language;
}

function sanitizeTranscriptForLanguage(text, language = getTranscriptionLanguage()) {
  const cleanText = String(text || '').replace(/<\|[^|]+\|>/g, '');
  if (!cleanText) {
    return '';
  }

  const normalizedLanguage = normalizeLanguageSetting(language);
  if (normalizedLanguage === 'en') {
    return cleanText
      .replace(/[\u3040-\u30ff\uff66-\uff9f\u3400-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, ' ')
      .replace(/[^\x20-\x7e\r\n]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  const allowedTextPattern = normalizedLanguage === 'zh-en'
    ? /[^\u3400-\u9fff\uf900-\ufaffA-Za-z0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]/g
    : /[^\u3400-\u9fff\uf900-\ufaff0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]/g;

  return cleanText
    .replace(/[\u3040-\u30ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, '')
    .replace(allowedTextPattern, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function createWindow() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;

  mainWindow = new BrowserWindow({
    width: COMPACT_SIZE.width,
    height: COMPACT_SIZE.height,
    x: workArea.x + workArea.width - COMPACT_SIZE.width - 32,
    y: workArea.y + Math.round(workArea.height * 0.35),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function resize(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const size = mode === 'settings'
    ? SETTINGS_SIZE
    : mode === 'expanded'
      ? EXPANDED_SIZE
      : COMPACT_SIZE;

  const bounds = mainWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  mainWindow.setBounds({
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - size.width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - size.height)),
    width: size.width,
    height: size.height
  }, true);
}

function isUnsafeBareAccelerator(accelerator) {
  const cleanAccelerator = String(accelerator || '').trim();
  return cleanAccelerator
    && !cleanAccelerator.includes('+')
    && !/^F([1-9]|1\d|2[0-4])$/i.test(cleanAccelerator);
}

function isHoldTriggerMode() {
  return settings.recordTriggerMode === 'hold';
}

function normalizeWindowHandle(value) {
  const handle = Number(value || 0);
  return Number.isFinite(handle) && handle > 0 ? Math.trunc(handle) : 0;
}

function normalizeInputMethod(value) {
  return String(value || '').toLowerCase() === 'paste' ? 'paste' : 'type';
}

function sendStartStopShortcut(source, targetHwnd = 0, action = 'toggle') {
  mainWindow?.webContents.send('shortcut:start-stop', {
    direct: true,
    source,
    action,
    targetHwnd: normalizeWindowHandle(targetHwnd)
  });
}

function handleHoldHotkeyLine(line) {
  const cleanLine = String(line || '').trim();
  if (!cleanLine) {
    return;
  }

  let event;
  try {
    event = JSON.parse(cleanLine);
  } catch {
    console.warn(`Hold hotkey output: ${cleanLine}`);
    return;
  }

  if (event.type === 'ready') {
    console.info(`Hold hotkey ready: ${event.accelerator || ''}`);
    return;
  }

  if (event.type === 'error') {
    console.warn(`Hold hotkey error: ${event.message || 'unknown error'}`);
    return;
  }

  if (event.type === 'down' && !holdHotkeyActive) {
    holdHotkeyActive = true;
    sendStartStopShortcut('hold-hotkey', event.targetHwnd, 'start');
    return;
  }

  if (event.type === 'up' && holdHotkeyActive) {
    holdHotkeyActive = false;
    sendStartStopShortcut('hold-hotkey', 0, 'stop');
  }
}

function stopHoldHotkey() {
  const processToStop = holdHotkeyProcess;
  holdHotkeyProcess = null;
  holdHotkeyBuffer = '';
  holdHotkeyActive = false;

  if (processToStop && !processToStop.killed) {
    try {
      processToStop.kill();
    } catch {
      // The helper may already have exited.
    }
  }
}

function startHoldHotkey() {
  stopHoldHotkey();

  const accelerator = settings.startStopShortcut;
  if (!accelerator || isUnsafeBareAccelerator(accelerator)) {
    return;
  }

  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'hotkey_hold_hook.ps1');
  if (!fs.existsSync(scriptPath)) {
    console.warn(`Hold hotkey script missing: ${scriptPath}`);
    return;
  }

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-Accelerator',
    accelerator
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  holdHotkeyProcess = child;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    holdHotkeyBuffer += chunk;
    const lines = holdHotkeyBuffer.split(/\r?\n/);
    holdHotkeyBuffer = lines.pop() || '';
    for (const line of lines) {
      handleHoldHotkeyLine(line);
    }
  });
  child.stderr.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) {
      console.warn(`Hold hotkey stderr: ${message}`);
    }
  });
  child.on('exit', (code, signal) => {
    if (holdHotkeyProcess === child) {
      holdHotkeyProcess = null;
      holdHotkeyBuffer = '';
      holdHotkeyActive = false;
      if (isHoldTriggerMode() && code !== 0) {
        console.warn(`Hold hotkey exited: code=${code} signal=${signal || ''}`);
      }
    }
  });
}

function registerShortcuts() {
  if (!app.isReady()) {
    return;
  }

  globalShortcut.unregisterAll();
  const useHoldHotkey = isHoldTriggerMode()
    && settings.startStopShortcut
    && !isUnsafeBareAccelerator(settings.startStopShortcut);

  const bindings = [
    [useHoldHotkey ? '' : settings.startStopShortcut, () => sendStartStopShortcut('tap-hotkey')],
    [settings.hideShowShortcut, toggleWindowVisibility],
    [settings.pasteShortcut, () => mainWindow?.webContents.send('shortcut:paste')]
  ];

  for (const [accelerator, handler] of bindings) {
    if (!accelerator) {
      continue;
    }
    if (isUnsafeBareAccelerator(accelerator)) {
      console.warn(`Shortcut skipped because it is a bare key: ${accelerator}`);
      continue;
    }
    try {
      globalShortcut.register(accelerator, handler);
    } catch (error) {
      console.warn(`Shortcut failed: ${accelerator}`, error);
    }
  }

  if (useHoldHotkey) {
    startHoldHotkey();
  } else {
    stopHoldHotkey();
  }
}

function toggleWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isVisible()) {
    hideMainWindow();
  } else {
    showMainWindow();
  }
}

async function showMainWindow() {
  backgroundMode = false;
  recordingHud.hide();
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
  if (typeof mainWindow.moveTop === 'function') {
    mainWindow.moveTop();
  }
}

function hideMainWindow() {
  backgroundMode = true;
  mainWindow?.hide();
  if (recordingActive) void recordingHud.show('recording').catch((error) => console.warn('Recording indicator:', error.message));
}

async function writeTempAudio(arrayBuffer, mimeType) {
  const extension = mimeType.includes('wav')
    ? 'wav'
    : mimeType.includes('mp4')
      ? 'm4a'
      : 'webm';
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'voice-agent-pad-'));
  const filePath = path.join(tempDir, `speech.${extension}`);
  await fsp.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

function multipartTranscriptionRequest({ filePath, mimeType, apiKey, model, language }) {
  return new Promise((resolve, reject) => {
    const boundary = `----voice-agent-pad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const fileBuffer = fs.readFileSync(filePath);
    const fields = {
      model,
      response_format: 'json'
    };

    if (language) {
      fields.language = language;
    }

    const chunks = [];
    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(chunks);
    const request = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(responseChunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`OpenAI transcription failed (${response.statusCode}): ${raw}`));
          return;
        }

        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.text || '');
        } catch (error) {
          reject(new Error(`OpenAI returned invalid JSON: ${error.message}`));
        }
      });
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function toFriendlyLocalError(message) {
  const raw = String(message || '').trim();
  if (!raw) {
    return '本地语音识别失败。';
  }

  if (/No module named|依赖还没有安装|ModuleNotFoundError/i.test(raw)) {
    if (/funasr|modelscope|torch|torchaudio/i.test(raw)) {
      return '本地 SenseVoice 依赖还没装好。请在项目目录安装 requirements-local.txt。';
    }
    if (/faster_whisper|faster-whisper/i.test(raw)) {
      return '本地 Whisper 依赖还没装好。请在项目目录安装 requirements-local.txt。';
    }
    return '本地识别依赖还没装好。请在项目目录安装 requirements-local.txt。';
  }
  if (/model|download|huggingface|modelscope|connection|network|timed out|SSL|certificate/i.test(raw)) {
    return '本地模型还没下载成功，或网络下载被拦截。首次使用 base/tiny 模型需要先下载一次。';
  }
  if (/cuda|cudnn|cublas|gpu/i.test(raw)) {
    return '本地 GPU 识别失败。可以在设置里把设备切换成 CPU 后再试。';
  }
  if (/Invalid data|Failed to open|could not open|decode|format|av\.error/i.test(raw)) {
    return '本地引擎没有读懂这段录音格式。请重新录一小段，或切换 tiny/base 模型再试。';
  }

  const firstLine = raw.split(/\r?\n/).find(Boolean) || raw;
  if (/Command failed:/i.test(firstLine)) {
    return '本地语音识别失败。底层进程没有正常返回结果。';
  }

  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function readLocalResult(stdout, stderr, error) {
  const output = String(stdout || '').trim();
  if (output) {
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('{') && line.endsWith('}'))
      .reverse();

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed.ok) {
          return { ok: true, text: parsed.text || '' };
        }
        return { ok: false, error: toFriendlyLocalError(parsed.error || stderr || error?.message) };
      } catch {
        // Keep looking for a valid JSON payload.
      }
    }
  }

  return { ok: false, error: toFriendlyLocalError(stderr || error?.message) };
}

function getLocalEngine() {
  return ['paraformer', 'sensevoice', 'whisper'].includes(settings.localEngine)
    ? settings.localEngine : defaultSettings.localEngine;
}

function getLocalModelForEngine(engine = getLocalEngine()) {
  return engine === 'sensevoice'
    ? (settings.localSenseVoiceModel || defaultSettings.localSenseVoiceModel)
    : (settings.localModel || defaultSettings.localModel);
}

function getLocalScriptName(engine = getLocalEngine(), worker = false) {
  if (engine === 'sensevoice') {
    return worker ? 'sensevoice_transcribe_worker.py' : 'sensevoice_transcribe.py';
  }
  return worker ? 'local_transcribe_worker.py' : 'local_transcribe.py';
}

function getLocalHistoryProvider(engine = getLocalEngine()) {
  return engine === 'sensevoice' ? 'local-sensevoice' : 'local-whisper';
}

function runLocalEngineOnce(filePath) {
  return new Promise((resolve, reject) => {
    const engine = getLocalEngine();
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', getLocalScriptName(engine, false));
    const args = [
      scriptPath,
      '--audio', filePath,
      '--model', getLocalModelForEngine(engine),
      '--language', getTranscriptionLanguage(),
      '--device', settings.localDevice || 'auto'
    ];

    execFile(settings.localPythonPath || 'python', args, {
      cwd: PROJECT_ROOT,
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 1024 * 1024 * 8
    }, (error, stdout, stderr) => {
      const result = readLocalResult(stdout, stderr, error);
      if (result.ok) {
        resolve(result.text);
        return;
      }

      if (error) {
        reject(new Error(result.error));
        return;
      }

      reject(new Error(result.error));
    });
  });
}

function getLocalWorkerKey() {
  const engine = getLocalEngine();
  return JSON.stringify({
    engine,
    python: settings.localPythonPath || 'python',
    model: getLocalModelForEngine(engine),
    device: settings.localDevice || defaultSettings.localDevice
  });
}

function rejectLocalWorkerPending(error) {
  for (const pending of localWorkerPending.values()) {
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  }
  localWorkerPending.clear();
}

function stopLocalWorker() {
  if (localWorker && !localWorker.killed) {
    localWorker.kill();
  }
  localWorker = null;
  localWorkerKey = '';
  localWorkerBuffer = '';
  localWorkerStartupError = '';
}

function handleLocalWorkerLine(line) {
  const cleanLine = String(line || '').trim();
  if (!cleanLine) {
    return;
  }

  const jsonStart = cleanLine.indexOf('{');
  const jsonEnd = cleanLine.lastIndexOf('}');
  const payloadLine = jsonStart >= 0 && jsonEnd > jsonStart && /"(ok|event|id)"\s*:/.test(cleanLine)
    ? cleanLine.slice(jsonStart, jsonEnd + 1)
    : cleanLine;

  let message;
  try {
    message = JSON.parse(payloadLine);
  } catch {
    localWorkerStartupError = cleanLine;
    return;
  }

  if (message.event === 'startup-error') {
    localWorkerStartupError = message.error || '本地识别 worker 启动失败。';
    return;
  }

  const pending = localWorkerPending.get(message.id);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  localWorkerPending.delete(message.id);

  if (message.ok) {
    pending.resolve(message.text || '');
  } else {
    pending.reject(new Error(toFriendlyLocalError(message.error)));
  }
}

function ensureLocalWorker() {
  const nextKey = getLocalWorkerKey();
  if (localWorker && !localWorker.killed && localWorkerKey === nextKey) {
    return localWorker;
  }

  stopLocalWorker();

  const engine = getLocalEngine();
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', getLocalScriptName(engine, true));
  const pythonPath = settings.localPythonPath || 'python';
  const worker = spawn(pythonPath, [
    scriptPath,
    '--model', getLocalModelForEngine(engine),
    '--device', settings.localDevice || defaultSettings.localDevice
  ], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  localWorker = worker;
  localWorkerKey = nextKey;
  localWorkerBuffer = '';
  localWorkerStartupError = '';

  worker.stderr.on('data', (chunk) => {
    localWorkerStartupError = `${localWorkerStartupError}\n${chunk.toString('utf8')}`.trim().slice(-4000);
  });

  worker.stdout.on('data', (chunk) => {
    localWorkerBuffer += chunk.toString('utf8');
    let newlineIndex = localWorkerBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = localWorkerBuffer.slice(0, newlineIndex);
      localWorkerBuffer = localWorkerBuffer.slice(newlineIndex + 1);
      handleLocalWorkerLine(line);
      newlineIndex = localWorkerBuffer.indexOf('\n');
    }
  });

  worker.on('error', (error) => {
    if (localWorker !== worker) return;
    rejectLocalWorkerPending(new Error(toFriendlyLocalError(error.message)));
    stopLocalWorker();
  });

  worker.on('exit', (code) => {
    if (localWorker !== worker) return;
    const reason = localWorkerStartupError || `本地识别 worker 已退出，退出码 ${code ?? '未知'}。`;
    rejectLocalWorkerPending(new Error(toFriendlyLocalError(reason)));
    stopLocalWorker();
  });

  return worker;
}

function runLocalEngine(filePath) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = ensureLocalWorker();
    } catch (error) {
      runLocalEngineOnce(filePath).then(resolve, reject);
      return;
    }

    if (!worker.stdin.writable) {
      runLocalEngineOnce(filePath).then(resolve, reject);
      return;
    }

    const id = String(++localWorkerRequestId);
    const timeoutId = setTimeout(() => {
      localWorkerPending.delete(id);
      reject(new Error('本地识别超时。可以切换另一个本地引擎，或把设备改成 CPU 后再试。'));
    }, 10 * 60 * 1000);

    localWorkerPending.set(id, { resolve, reject, timeoutId });
    try {
      worker.stdin.write(`${JSON.stringify({
        id,
        audio: filePath,
        language: getTranscriptionLanguage()
      })}\n`);
    } catch (error) {
      clearTimeout(timeoutId);
      localWorkerPending.delete(id);
      reject(new Error(toFriendlyLocalError(error.message)));
    }
  });
}

async function transcribe(arrayBuffer, mimeType, options = {}) {
  lastActivity = Date.now();
  const audioPath = await writeTempAudio(arrayBuffer, mimeType || 'audio/webm');
  legacyRequests += 1;
  const provider = settings.provider || defaultSettings.provider;
  const isPreview = Boolean(options.preview);
  const shouldSaveHistory = !isPreview && options.saveHistory !== false;

  try {
    if (provider === 'cloud') {
      const apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('还没有设置 OpenAI API Key。可以在设置里填写，或使用系统环境变量 OPENAI_API_KEY。');
      }
      const text = sanitizeTranscriptForLanguage(await multipartTranscriptionRequest({
        filePath: audioPath,
        mimeType,
        apiKey,
        model: settings.openaiModel || defaultSettings.openaiModel,
        language: getSingleLanguageHint()
      }));
      if (shouldSaveHistory) {
        await appendHistory(text, 'cloud');
      }
      return { ok: true, text, provider: 'cloud' };
    }

    if (provider === 'local') {
      const engine = getLocalEngine();
      if (engine === 'paraformer') throw new Error('Paraformer 使用连续录音接口，请重新开始录音。');
      const text = sanitizeTranscriptForLanguage(await runLocalEngine(audioPath));
      if (shouldSaveHistory) {
        await appendHistory(text, getLocalHistoryProvider(engine));
      }
      return { ok: true, text, provider: 'local', engine };
    }

    throw new Error('未知转写模式。请在设置里选择云端或本地。');
  } finally {
    legacyRequests -= 1;
    lastActivity = Date.now();
    fsp.rm(path.dirname(audioPath), { recursive: true, force: true }).catch(() => {});
  }
}

async function pasteTextToForeground(text, options = {}) {
  const send = async (inputMethod) => {
      const targetHwnd = normalizeWindowHandle(options.targetHwnd);
      let textFile = '';

      if (settings.autoHideAfterPaste && mainWindow?.isVisible()) {
        hideMainWindow();
      } else {
        mainWindow?.blur();
      }

      const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'send_paste.ps1');
      const ps = [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath
      ];
      if (targetHwnd) {
        ps.push('-TargetHwnd', String(targetHwnd));
      }
      if (inputMethod === 'type') {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'voice-agent-pad-input-'));
        textFile = path.join(tempDir, 'input.txt');
        await fsp.writeFile(textFile, text || '', 'utf8');
        ps.push('-Mode', 'Type', '-TextFile', textFile);
      } else {
        ps.push('-Mode', 'Paste');
      }

      return new Promise((resolve) => execFile('powershell.exe', ps, { windowsHide: true, timeout: 10000 }, (error) => {
        if (textFile) {
          fsp.rm(path.dirname(textFile), { recursive: true, force: true }).catch(() => {});
        }
        resolve({ ok: !error, copied: false, method: inputMethod, error: error ? '目标窗口不可用或权限不匹配；文字已保留，可手动复制。' : null, diagnostic: error?.message?.slice(-1600) || null });
      }));
  };
  try {
    if (normalizeInputMethod(options.inputMethod || settings.inputMethod) === 'type') return await send('type');
    const result = await withTemporaryClipboard(clipboard, String(text), () => send('paste'));
    // Unknown native clipboard formats (for example copied files) must not be destroyed.
    return result.unsupportedClipboard ? await send('type') : result;
  } catch (error) {
    return { ok: false, copied: false, error: error.message || '自动输入准备失败，文字已保留。' };
  }
}

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    showMainWindow().catch((error) => {
      console.warn('Failed to show existing window', error);
    });
  });

  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media' || permission === 'microphone');
    });

    await loadSettings();
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      if (Math.hypot(x - 15.5, y - 15.5) < 15) {
        const offset = (y * 32 + x) * 4;
        const mic = (x >= 12 && x <= 19 && y >= 7 && y <= 20) || (y >= 23 && y <= 25 && x >= 10 && x <= 21);
        pixels.set(mic ? [245, 250, 250, 255] : [65, 125, 24, 255], offset);
      }
    }
    tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }));
    tray.on('click', () => showMainWindow());
    updateTray();
    if (settings.liveExternalInput) await liveInput.native.ensureReady().catch((error) => console.warn('Live input:', error.message));
    await createWindow();
    void recordingHud.ensure().catch((error) => console.warn('Recording indicator:', error.message));
    registerShortcuts();
    warmStreamingClient();
    idleTimer = setInterval(() => releaseIdleModels(), 15000);
    idleTimer.unref();
  });
}

app.on('before-quit', (event) => {
  if (dictionaryPacks?.job && !dictionaryPacks.job.committing) dictionaryPacks.cancel(dictionaryPacks.job.id);
  if (quitPrepared || !store || !mainWindow || mainWindow.isDestroyed()) return;
  event.preventDefault();
  quitPrepared = true;
  const draft = mainWindow.webContents.executeJavaScript('({ text: document.getElementById("transcript").value, revision: featureState.revision })');
  Promise.race([draft, new Promise((resolve) => setTimeout(() => resolve(null), 800))])
    .then((value) => value && settings.saveDraft ? writeJson('draft.json', value) : null)
    .catch((error) => console.warn(error.message))
    .finally(async () => { await store.queue; await dictionaryPacks?.store.queue; app.quit(); });
});

app.on('will-quit', () => {
  liveInput.stop();
  recordingHud.close();
  clearInterval(idleTimer);
  for (const controller of editingJobs.values()) controller.abort();
  editor.stop();
  tray?.destroy();
  stopStreamingClient();
  stopLocalWorker();
  stopHoldHotkey();
  globalShortcut.unregisterAll();
});

ipcMain.handle('app:get-settings', async () => settings);
ipcMain.handle('packs:list', () => getDictionaryPacks().list());
ipcMain.handle('packs:preview', (_event, id) => getDictionaryPacks().preview(id));
ipcMain.handle('packs:install', (_event, id) => getDictionaryPacks().install(id));
ipcMain.handle('packs:cancel', (_event, id) => getDictionaryPacks().cancel(id));
ipcMain.handle('packs:change', (_event, { id, action, enabled }) => {
  if (recordingActive || streamingSession || editingJobs.size || legacyRequests) throw new Error('请结束录音或整理后再更改词包');
  return getDictionaryPacks().change(id, action, enabled);
});
ipcMain.handle('packs:open-source', async (_event, id) => {
  await shell.openExternal(getDictionaryPacks().find(id).sourceUrl);
});
ipcMain.handle('app:save-settings', async (_event, nextSettings) => saveSettings(nextSettings));
ipcMain.handle('app:get-history', getHistory);
ipcMain.handle('app:history-action', async (_event, { id, action }) => store.update('history.json', [], (history) => {
  if (action === 'delete') return history.filter((item) => item.id !== id);
  if (action === 'pin') return history.map((item) => item.id === id ? { ...item, pinned: !item.pinned } : item);
  return history;
}));
ipcMain.handle('app:get-draft', async () => settings.saveDraft ? readJson('draft.json', { text: '', revision: null }) : { text: '', revision: null });
ipcMain.handle('app:save-draft', async (_event, draft) => {
  if (!settings.saveDraft) return { ok: true };
  const text = String(draft?.text || '');
  if (text.length > 300000) throw new Error('草稿过长，请先保存到文档');
  const revision = draft?.revision && JSON.stringify(draft.revision).length <= 350000 ? draft.revision : null;
  await writeJson('draft.json', { text, revision, updatedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('app:process-text', (_event, payload) => processText(payload));
ipcMain.handle('app:cancel-processing', (_event, id) => { editingJobs.get(String(id))?.abort(); return { ok: true }; });
ipcMain.handle('app:feature-status', () => ({ ...editor.status(), asrRunning: !!streamingClient?.child, standbyMode: settings.standbyMode }));
ipcMain.handle('app:release-models', () => ({ ok: releaseIdleModels(true) }));
ipcMain.handle('ai-extension:download-install', (_event, url) => downloadAndInstallAiExtension(url));
ipcMain.handle('ai-extension:install-local', async () => {
  assertCanInstallAiExtension();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 AI 整理扩展 ZIP',
    properties: ['openFile'],
    filters: [{ name: 'AI 扩展 ZIP', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { cancelled: true };
  return installAiExtensionZip(result.filePaths[0]);
});
ipcMain.handle('ai-extension:cancel', () => {
  aiExtensionJob?.controller.abort();
  return { ok: true };
});
ipcMain.handle('app:recording-activity', (_event, active) => {
  recordingActive = !!active; lastActivity = Date.now();
  if (active && backgroundMode) void recordingHud.show('recording').catch(() => {});
  if (!active && backgroundMode) recordingHud.finish(['blocked', 'review', 'cancelled'].includes(recordingHud.state.status) ? recordingHud.state.status : 'done');
});
ipcMain.handle('live:begin', async (event, { session: id, targetHwnd }) => {
  if (event.sender !== mainWindow?.webContents || !recordingActive || !settings.liveExternalInput || !settings.directPasteAfterShortcut
    || settings.language === 'zh-to-en' || settings.provider !== 'local' || getLocalEngine() !== 'paraformer') return { attempted: false, written: '' };
  if (typeof id !== 'string' || !id || id.length > 100) return { attempted: true, blocked: true, written: '', reason: 'no-target' };
  const own = BrowserWindow.getAllWindows().some((window) => Number(window.getNativeWindowHandle().readBigUInt64LE()) === Number(targetHwnd));
  if (own && !process.env.VOICE_PAD_TEST_DATA) return { attempted: true, blocked: true, written: '', reason: 'own-window' };
  return liveInput.start(id, normalizeWindowHandle(targetHwnd), settings.startStopShortcut, process.env.VOICE_PAD_TEST_DATA ? 0 : process.pid, settings.liveInputMode !== 'strict');
});
ipcMain.handle('live:finish', (event, { session: id, text }) => {
  if (event.sender !== mainWindow?.webContents || typeof text !== 'string' || text.length > 100000) throw new Error('无效实时输入请求');
  return liveInput.finish(id, text);
});
ipcMain.handle('live:cancel', async (event) => { if (event.sender === mainWindow?.webContents) await liveInput.end(); });
ipcMain.on('hud:level', (event, state) => {
  if (event.sender !== mainWindow?.webContents || !recordingActive || !backgroundMode) return;
  recordingHud.update({ level: Math.max(0, Math.min(1, Number(state?.level) || 0)), seconds: Math.max(0, Number(state?.seconds) || 0) });
});
ipcMain.on('hud:status', (event, status) => {
  if (event.sender !== mainWindow?.webContents || !backgroundMode || !recordingActive) return;
  if (['recording', 'processing', 'translating', 'review', 'blocked', 'cancelled'].includes(status)) recordingHud.update({ status });
});
ipcMain.handle('app:clear-history', async () => {
  await writeJson('history.json', []);
  return [];
});
ipcMain.handle('app:transcribe', async (_event, payload) => transcribe(payload.arrayBuffer, payload.mimeType, payload.options));
ipcMain.handle('streaming:start', async (_event, payload) => {
  lastActivity = Date.now();
  if (settings.provider !== 'local' || getLocalEngine() !== 'paraformer') throw new Error('请先保存本地 Paraformer 引擎设置。');
  if (streamingSession) throw new Error('上一段录音还没有结束。');
  const sessionId = String(payload?.session || '');
  if (!sessionId || sessionId.length > 100) throw new Error('无效录音编号。');
  streamingSession = sessionId;
  try {
    await getStreamingClient().request('start', { session: sessionId, language: getTranscriptionLanguage() });
    return { ok: true };
  } catch (error) {
    if (streamingSession === sessionId) streamingSession = null;
    throw error;
  }
});
ipcMain.handle('streaming:audio', async (_event, payload) => {
  if (!streamingClient || payload.session !== streamingSession) throw new Error('录音已结束。');
  const pcm = Buffer.from(payload.pcm);
  if (pcm.length > 384000 || pcm.length % 4) throw new Error('录音数据格式无效。');
  return streamingClient.request('audio', { session: streamingSession, sampleRate: payload.sampleRate, pcm: pcm.toString('base64') });
});
ipcMain.handle('streaming:finish', async (_event, payload) => {
  if (!streamingClient || payload.session !== streamingSession) throw new Error('录音已结束。');
  try {
    return await streamingClient.request('finish', { session: streamingSession });
  } finally {
    lastActivity = Date.now();
    if (streamingSession === payload.session) streamingSession = null;
  }
});
ipcMain.handle('streaming:cancel', async (_event, payload) => {
  if (streamingClient && payload.session === streamingSession) {
    try {
      await streamingClient.request('cancel', { session: streamingSession });
    } finally {
      if (streamingSession === payload.session) streamingSession = null;
    }
  }
  return { ok: true };
});
ipcMain.handle('app:paste-text', async (_event, payload) => {
  const text = typeof payload === 'object' && payload !== null ? payload.text : payload;
  const options = typeof payload === 'object' && payload !== null ? payload.options || {} : {};
  if (options.saveHistory !== false) {
    await appendHistory(text, settings.provider || 'manual', 'pasted');
  }
  const operation = inputQueue.then(() => pasteTextToForeground(text, options));
  inputQueue = operation.catch(() => {});
  return operation;
});
ipcMain.handle('app:copy-text', async (_event, text) => {
  clipboard.writeText(text || '');
  await appendHistory(text, settings.provider || 'manual', 'copied');
  return { ok: true };
});
ipcMain.handle('app:save-transcript', async (_event, payload) => {
  await appendHistory(payload?.text || '', payload?.provider || settings.provider || 'manual', 'transcribed', payload?.detail || {});
  return { ok: true };
});
ipcMain.handle('app:get-window-bounds', async () => mainWindow?.getBounds() || null);
ipcMain.handle('app:set-window-position', async (_event, position) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false };
  }

  const x = Math.round(Number(position?.x) || 0);
  const y = Math.round(Number(position?.y) || 0);
  mainWindow.setPosition(x, y, false);
  return { ok: true };
});
ipcMain.handle('app:set-mode', async (_event, mode) => resize(mode));
ipcMain.handle('app:show-preview', async () => {
  if (!backgroundMode) mainWindow?.showInactive();
  return { ok: true };
});
ipcMain.handle('app:focus-preview', async () => {
  if (backgroundMode) { recordingHud.update({ status: 'review' }); return { ok: true, hidden: true }; }
  mainWindow?.show();
  mainWindow?.focus();
  return { ok: true };
});
ipcMain.handle('app:hide', async () => {
  hideMainWindow();
  return { ok: true };
});
ipcMain.handle('app:quit', async () => {
  app.quit();
  return { ok: true };
});
ipcMain.handle('app:open-user-data', async () => {
  await shell.openPath(app.getPath('userData'));
  return app.getPath('userData');
});
ipcMain.handle('app:open-app-folder', async () => {
  await shell.openPath(PROJECT_ROOT);
  return PROJECT_ROOT;
});
