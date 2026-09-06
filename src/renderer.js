const api = window.voiceAgentPad;

const appShell = document.getElementById('app');
const recordToggle = document.getElementById('recordToggle');
const settingsToggle = document.getElementById('settingsToggle');
const closeSettings = document.getElementById('closeSettings');
const hideButton = document.getElementById('hideButton');
const orbMinimize = document.getElementById('orbMinimize');
const orbClose = document.getElementById('orbClose');
const transcript = document.getElementById('transcript');
const statusLabel = document.getElementById('statusLabel');
const settingsStatus = document.getElementById('settingsStatus');
const orbLabel = document.getElementById('orbLabel');
const engineLabel = document.getElementById('engineLabel');
const providerSwitch = document.getElementById('providerSwitch');
const copyButton = document.getElementById('copyButton');
const pasteButton = document.getElementById('pasteButton');
const clearTranscriptButton = document.getElementById('clearTranscriptButton');
const historyList = document.getElementById('historyList');
const refreshMicsButton = document.getElementById('refreshMics');
const waveformBars = Array.from(document.querySelectorAll('.orb-wave span'));

const settingsInputs = {
  provider: document.getElementById('provider'),
  language: document.getElementById('language'),
  micDeviceId: document.getElementById('micDeviceId'),
  openaiApiKey: document.getElementById('openaiApiKey'),
  openaiModel: document.getElementById('openaiModel'),
  localEngine: document.getElementById('localEngine'),
  localPythonPath: document.getElementById('localPythonPath'),
  localModel: document.getElementById('localModel'),
  localSenseVoiceModel: document.getElementById('localSenseVoiceModel'),
  localDevice: document.getElementById('localDevice'),
  recordTriggerMode: document.getElementById('recordTriggerMode'),
  startStopShortcut: document.getElementById('startStopShortcut'),
  hideShowShortcut: document.getElementById('hideShowShortcut'),
  pasteShortcut: document.getElementById('pasteShortcut'),
  inputMethod: document.getElementById('inputMethod'),
  liveInputMode: document.getElementById('liveInputMode'),
  autoHideAfterPaste: document.getElementById('autoHideAfterPaste'),
  launchAtLogin: document.getElementById('launchAtLogin'),
  aiExtensionUrl: document.getElementById('aiExtensionUrl')
};
for (const key of featureKeys) settingsInputs[key] = document.getElementById(key);

const saveSettingsButton = document.getElementById('saveSettings');
const saveSettingsTopButton = document.getElementById('saveSettingsTop');
const saveSettingsButtons = [saveSettingsButton, saveSettingsTopButton].filter(Boolean);
const clearHistoryButton = document.getElementById('clearHistory');
const openDataFolderButton = document.getElementById('openDataFolder');
const openAppFolderButton = document.getElementById('openAppFolder');
const downloadAiExtensionButton = document.getElementById('downloadAiExtension');
const installLocalAiExtensionButton = document.getElementById('installLocalAiExtension');
const cancelAiExtensionButton = document.getElementById('cancelAiExtension');
const shortcutCaptureButtons = document.querySelectorAll('.shortcut-capture');

let currentSettings = {};
let mediaStream = null;
let mediaRecorder = null;
let chunks = [];
let recordingStartedAt = 0;
let timerId = null;
let previewTimerId = null;
let previewPromise = null;
let recordingToken = 0;
let audioContext = null;
let audioAnalyser = null;
let audioSourceNode = null;
let audioCaptureProcessor = null;
let audioCaptureSilence = null;
let audioLevelData = null;
let audioVisualFrameId = null;
let audioSampleRate = 0;
let fullAudioSamples = [];
let fullAudioSampleCount = 0;
let previewAudioSamples = [];
let previewAudioSampleCount = 0;
let previewTranscriptText = '';
let recordingBaseText = '';
let finalizingRecordingToken = null;
let activeRecordingMode = 'panel';
let directPasteTargetHwnd = 0;
let transcriptRevealTarget = '';
let transcriptRevealTimerId = null;
let speechRecognition = null;
let interimText = '';
let dragState = null;
let capturingShortcut = null;
let orbHoldTimerId = null;
let orbHoldStartInFlight = false;
let stopWhenHoldStartCompletes = false;
let savedSettings = {};
let savedSettingsSnapshot = '';
let settingsDirty = false;
let recordingStartInFlight = false;
let stopAfterRecordingStart = false;
let activeStreaming = null;
let resolveCaptureFlush = null;
let appReady = false;

const LOCAL_PREVIEW_INTERVAL_MS = 4200;
const SENSEVOICE_PREVIEW_INTERVAL_MS = 1900;
const LOCAL_PREVIEW_WARMUP_MS = 2500;
const SENSEVOICE_PREVIEW_WARMUP_MS = 1300;
const TYPEWRITER_CHAR_INTERVAL_MS = 24;
const HOLD_TO_RECORD_DELAY_MS = 260;
const SIMPLIFIED_MAP = {
  後: '后',
  裡: '里',
  裏: '里',
  這: '这',
  個: '个',
  們: '们',
  來: '来',
  為: '为',
  會: '会',
  說: '说',
  語: '语',
  話: '话',
  轉: '转',
  寫: '写',
  識: '识',
  錯: '错',
  誤: '误',
  顯: '显',
  現: '现',
  當: '当',
  輸: '输',
  點: '点',
  擊: '击',
  開: '开',
  啟: '启',
  關: '关',
  錄: '录',
  聲: '声',
  紋: '纹',
  設: '设',
  選: '选',
  擇: '择',
  麥: '麦',
  風: '风',
  電: '电',
  腦: '脑',
  內: '内',
  帶: '带',
  統: '统',
  認: '认',
  體: '体',
  簡: '简',
  復: '复',
  製: '制',
  貼: '贴',
  歷: '历',
  記: '记',
  資: '资',
  檔: '档',
  學: '学',
  習: '习',
  圖: '图',
  庫: '库',
  節: '节',
  構: '构',
  劃: '划',
  軟: '软',
  應: '应',
  該: '该',
  無: '无',
  論: '论',
  時: '时',
  並: '并',
  與: '与',
  還: '还',
  讓: '让',
  級: '级',
  務: '务',
  確: '确',
  實: '实',
  權: '权',
  網: '网',
  絡: '络',
  雲: '云',
  數: '数',
  據: '据',
  腳: '脚',
  視: '视',
  頻: '频',
  訊: '讯',
  號: '号',
  標: '标',
  籤: '签',
  題: '题',
  頁: '页',
  線: '线',
  遠: '远',
  過: '过',
  長: '长',
  準: '准',
  壓: '压',
  縮: '缩',
  檢: '检',
  測: '测',
  覽: '览',
  預: '预',
  熱: '热',
  詞: '词',
  彙: '汇',
  專: '专',
  業: '业',
  術: '术'
};

function compactMessage(text, limit = 72) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function toSimplifiedText(text) {
  if (window.OpenCC) {
    toSimplifiedText.converter ||= window.OpenCC.Converter({ from: 't', to: 'cn' });
    return toSimplifiedText.converter(String(text || ''));
  }
  return String(text || '').replace(/[後裡裏這個們來為會說語話轉寫識錯誤顯現當輸點擊開啟關錄聲紋設選擇麥風電腦內帶統認體簡復製貼歷記資檔學習圖庫節構劃軟應該無論時並與還讓級務確實權網絡雲數據腳視頻訊號標籤題頁線遠過長準壓縮檢測覽預熱詞彙專業術]/g, (char) => {
    return SIMPLIFIED_MAP[char] || char;
  });
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

function filterTextByLanguage(text, language = currentSettings.language) {
  const mode = normalizeLanguageSetting(language);
  let cleanText = String(text || '').replace(/<\|[^|]+\|>/g, '');

  if (mode === 'en') {
    return cleanText
      .replace(/[\u3040-\u30ff\uff66-\uff9f\u3400-\u9fff\uf900-\ufaff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, ' ')
      .replace(/[^\x20-\x7e\r\n]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  const allowedTextPattern = mode === 'zh-en' || mode === 'zh-to-en'
    ? /[^\u3400-\u9fff\uf900-\ufaffA-Za-z0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]/g
    : /[^\u3400-\u9fff\uf900-\ufaff0-9\s，。！？、；：,.!?;:'"()[\]{}<>《》【】+\-*/_=#@&%$`~^|\\/]/g;

  cleanText = toSimplifiedText(cleanText)
    .replace(/[\u3040-\u30ff\uff66-\uff9f\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, '')
    .replace(allowedTextPattern, '');

  return cleanText.replace(/[ \t]+/g, ' ').trim();
}

function normalizeRecognizedText(text) {
  return filterTextByLanguage(text).replace(/\s+/g, ' ').trim();
}

function needsJoinSpace(left, right) {
  if (!left || /\s$/.test(left) || /^[，。！？、；：,.!?;:]/.test(right)) {
    return false;
  }

  const leftIsAscii = /[A-Za-z0-9)]$/.test(left);
  const rightIsAscii = /^[A-Za-z0-9(]/.test(right);
  return leftIsAscii || rightIsAscii;
}

function joinTranscriptText(left, right) {
  const base = String(left || '');
  const addition = normalizeRecognizedText(right);
  if (!addition) {
    return base;
  }
  if (!base) {
    return addition;
  }
  return `${base}${needsJoinSpace(base, addition) ? ' ' : ''}${addition}`;
}

function getCommonPrefix(left, right) {
  const leftText = String(left || '');
  const rightText = String(right || '');
  const length = Math.min(leftText.length, rightText.length);
  let index = 0;
  while (index < length && leftText[index] === rightText[index]) {
    index += 1;
  }
  return leftText.slice(0, index);
}

function stopTranscriptReveal() {
  if (transcriptRevealTimerId) {
    window.clearTimeout(transcriptRevealTimerId);
    transcriptRevealTimerId = null;
  }
}

function scrollTranscriptToBottom() {
  transcript.scrollTop = transcript.scrollHeight;
}

function setTranscriptText(text, options = {}) {
  const cleanText = String(text || '');
  transcriptRevealTarget = cleanText;

  if (options.immediate) {
    stopTranscriptReveal();
    transcript.value = cleanText;
    scrollTranscriptToBottom();
    scheduleDraftSave();
    return;
  }

  if (!cleanText.startsWith(transcript.value)) {
    transcript.value = getCommonPrefix(transcript.value, cleanText);
  }

  if (!transcriptRevealTimerId) {
    revealNextTranscriptChar();
  }
}

function revealNextTranscriptChar() {
  transcriptRevealTimerId = null;

  if (transcript.value === transcriptRevealTarget) {
    return;
  }

  if (!transcriptRevealTarget.startsWith(transcript.value)) {
    transcript.value = getCommonPrefix(transcript.value, transcriptRevealTarget);
  }

  const remaining = transcriptRevealTarget.slice(transcript.value.length);
  const [nextChar] = Array.from(remaining);
  if (!nextChar) {
    return;
  }

  transcript.value += nextChar;
  scrollTranscriptToBottom();
  transcriptRevealTimerId = window.setTimeout(revealNextTranscriptChar, TYPEWRITER_CHAR_INTERVAL_MS);
}

function flushTranscriptReveal() {
  if (transcriptRevealTimerId || transcript.value !== transcriptRevealTarget) {
    stopTranscriptReveal();
    transcript.value = transcriptRevealTarget;
    scrollTranscriptToBottom();
  }
}

function setMode(mode) {
  appShell.classList.remove('compact', 'expanded', 'settings');
  appShell.classList.add(mode);
  api.setMode(mode);
}

function getRecordTriggerMode() {
  return currentSettings.recordTriggerMode === 'hold' ? 'hold' : 'tap';
}

function isHoldTriggerMode() {
  return getRecordTriggerMode() === 'hold';
}

function getIdleOrbLabel() {
  if (transcript.value.trim()) {
    return '已完成';
  }
  return isHoldTriggerMode() ? '按住说' : '点按';
}

function updateOrbIdleState() {
  if (
    !appShell.classList.contains('recording')
    && !appShell.classList.contains('transcribing')
    && !appShell.classList.contains('error')
  ) {
    orbLabel.textContent = getIdleOrbLabel();
  }

  recordToggle.title = isHoldTriggerMode()
    ? '按住说话，松开停止'
    : '点击开始/停止语音转文字';
}

function setStatus(text, type = 'ready') {
  statusLabel.textContent = compactMessage(text);
  statusLabel.title = text || '';
  appShell.classList.remove('recording', 'transcribing', 'error');
  if (type !== 'ready') {
    appShell.classList.add(type);
  }

  if (type === 'recording') {
    orbLabel.textContent = '录音中';
  } else if (type === 'transcribing') {
    orbLabel.textContent = '转写中';
  } else if (type === 'error') {
    orbLabel.textContent = '出错';
  } else {
    orbLabel.textContent = getIdleOrbLabel();
  }
  updateOrbIdleState();
  updateFeatureControls();
}

function setSettingsStatus(text, type = 'ready') {
  if (!settingsStatus) {
    return;
  }
  settingsStatus.textContent = compactMessage(text);
  settingsStatus.title = text || '';
  settingsStatus.classList.toggle('error-text', type === 'error');
}

function settingsComparable(settings) {
  return JSON.stringify({
    ...featureComparable(settings),
    provider: settings.provider || 'local',
    language: normalizeLanguageSetting(settings.language),
    micDeviceId: settings.micDeviceId || '',
    openaiApiKey: settings.openaiApiKey || '',
    openaiModel: settings.openaiModel || 'gpt-4o-mini-transcribe',
    localEngine: settings.localEngine || 'paraformer',
    localPythonPath: settings.localPythonPath || 'python',
    localModel: settings.localModel || 'base',
    localSenseVoiceModel: settings.localSenseVoiceModel || 'iic/SenseVoiceSmall',
    localDevice: settings.localDevice || 'auto',
    recordTriggerMode: settings.recordTriggerMode === 'hold' ? 'hold' : 'tap',
    startStopShortcut: settings.startStopShortcut || '',
    hideShowShortcut: settings.hideShowShortcut || '',
    pasteShortcut: settings.pasteShortcut || '',
    inputMethod: settings.inputMethod === 'paste' ? 'paste' : 'type',
    liveInputMode: settings.liveInputMode === 'strict' ? 'strict' : 'compatible',
    autoHideAfterPaste: !!settings.autoHideAfterPaste,
    launchAtLogin: !!settings.launchAtLogin,
    aiExtensionUrl: settings.aiExtensionUrl || ''
  });
}

function updateSettingsDirtyState(forceDirty = null) {
  settingsDirty = forceDirty === null
    ? settingsComparable(readSettingsForm()) !== savedSettingsSnapshot
    : forceDirty;

  for (const button of saveSettingsButtons) {
    const label = button.dataset.label || '保存设置';
    button.textContent = settingsDirty ? `${label} *` : label;
    button.classList.toggle('dirty', settingsDirty);
  }

  if (settingsDirty) {
    setSettingsStatus('未保存，点保存后生效');
  }
}

function updateEngineLabel() {
  const provider = currentSettings.provider || 'local';
  const localEngine = getLocalEngine();
  const languageLabel = { zh: '中文', en: '英文', 'zh-en': '中英文', 'zh-to-en': '中文 → 英文' }[normalizeLanguageSetting(currentSettings.language)];
  const localLabel = localEngine === 'paraformer'
    ? `本地流式 · ${languageLabel}`
    : localEngine === 'sensevoice'
      ? `本地 SenseVoice · ${currentSettings.localSenseVoiceModel || 'iic/SenseVoiceSmall'}`
      : `本地 Whisper · ${currentSettings.localModel || 'base'}`;
  const label = provider === 'local'
    ? localLabel
    : `云端 OpenAI · ${currentSettings.openaiModel || 'gpt-4o-mini-transcribe'}`;
  engineLabel.textContent = currentSettings.language === 'zh-to-en' && (provider !== 'local' || localEngine !== 'paraformer') ? `${label} · ${languageLabel}` : label;
  providerSwitch.textContent = provider === 'local' ? '本地' : '云端';
  providerSwitch.title = provider === 'local' ? `当前：${localLabel}。点击切换到云端 OpenAI。` : '当前：云端 OpenAI。点击切换到本地识别。';
  providerSwitch.classList.toggle('local', provider === 'local');
  providerSwitch.classList.toggle('cloud', provider === 'cloud');
  updateOrbIdleState();
  updateLocalEngineFields();
}

function getLocalEngine() {
  return ['paraformer', 'sensevoice', 'whisper'].includes(currentSettings.localEngine)
    ? currentSettings.localEngine : 'paraformer';
}

function getLocalEngineName() {
  return { paraformer: 'Paraformer 流式', sensevoice: 'SenseVoice', whisper: 'Whisper' }[getLocalEngine()];
}

function isStreamingLocal() {
  return currentSettings.provider === 'local' && getLocalEngine() === 'paraformer';
}

function isRecordingBusy() {
  return recordingStartInFlight || mediaRecorder?.state === 'recording' || finalizingRecordingToken !== null || !!featureState.request || featureState.canceling || featureState.pasteBusy;
}

function updateLocalEngineFields() {
  const engine = settingsInputs.localEngine.value || getLocalEngine();
  document.querySelectorAll('[data-provider]').forEach((element) => {
    element.hidden = element.dataset.provider !== settingsInputs.provider.value;
  });
  settingsInputs.localModel.closest('label').hidden = engine !== 'whisper';
  settingsInputs.localSenseVoiceModel.closest('label').hidden = engine !== 'sensevoice';
  settingsInputs.localDevice.closest('label').hidden = engine === 'paraformer';
  document.querySelectorAll('[data-local-engine]').forEach((element) => {
    element.hidden = element.dataset.localEngine !== engine;
  });
}

function getLocalPreviewInterval() {
  return getLocalEngine() === 'sensevoice' ? SENSEVOICE_PREVIEW_INTERVAL_MS : LOCAL_PREVIEW_INTERVAL_MS;
}

function getLocalPreviewWarmupMs() {
  return getLocalEngine() === 'sensevoice' ? SENSEVOICE_PREVIEW_WARMUP_MS : LOCAL_PREVIEW_WARMUP_MS;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function getRecordingStatusText() {
  const prefix = activeRecordingMode === 'direct' ? '快捷直输中' : '正在听你说话';
  return `${prefix} ${formatDuration(Date.now() - recordingStartedAt)}`;
}

function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    setStatus(getRecordingStatusText(), 'recording');
  }, 250);
}

function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function getSupportedMimeType() {
  const choices = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/wav'
  ];

  return choices.find((type) => window.MediaRecorder?.isTypeSupported(type)) || '';
}

function createAudioConstraints() {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };

  if (currentSettings.micDeviceId) {
    audio.deviceId = { exact: currentSettings.micDeviceId };
  }

  return { audio };
}

async function getMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(createAudioConstraints());
  } catch (error) {
    const canFallback = currentSettings.micDeviceId
      && ['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError'].includes(error.name);
    if (!canFallback) {
      throw error;
    }

    setStatus('找不到已选麦克风，已改用系统默认麦克风', 'transcribing');
    currentSettings.micDeviceId = '';
    if (settingsInputs.micDeviceId) {
      settingsInputs.micDeviceId.value = '';
    }
    api.saveSettings({ ...currentSettings, micDeviceId: '' }).catch(() => {});
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  }
}

function formatMicLabel(device, index) {
  if (device.label) {
    return device.label;
  }
  return `麦克风 ${index + 1}`;
}

async function populateMicrophones(options = {}) {
  const { requestPermission = false } = options;
  if (!navigator.mediaDevices?.enumerateDevices || !settingsInputs.micDeviceId) {
    setStatus('当前环境不能读取麦克风列表', 'error');
    return;
  }

  let permissionStream = null;
  try {
    if (requestPermission) {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    const selectedId = currentSettings.micDeviceId || settingsInputs.micDeviceId.value || '';
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === 'audioinput');

    settingsInputs.micDeviceId.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '系统默认麦克风';
    settingsInputs.micDeviceId.append(defaultOption);

    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = formatMicLabel(device, index);
      settingsInputs.micDeviceId.append(option);
    });

    if (selectedId && devices.some((device) => device.deviceId === selectedId)) {
      settingsInputs.micDeviceId.value = selectedId;
    } else if (selectedId) {
      const missingOption = document.createElement('option');
      missingOption.value = selectedId;
      missingOption.textContent = '已保存的麦克风（当前不可用）';
      settingsInputs.micDeviceId.append(missingOption);
      settingsInputs.micDeviceId.value = selectedId;
    }

    if (requestPermission) {
      setStatus(devices.length ? `已找到 ${devices.length} 个麦克风输入` : '没有发现可用麦克风', devices.length ? 'ready' : 'error');
    }
  } catch (error) {
    setStatus(`读取麦克风失败：${error.message || '权限被拒绝'}`, 'error');
  } finally {
    if (permissionStream) {
      for (const track of permissionStream.getTracks()) {
        track.stop();
      }
    }
  }
}

function setVoiceLevel(level) {
  const cleanLevel = Math.max(0, Math.min(1, Number(level) || 0));
  if (!setVoiceLevel.lastHud || performance.now() - setVoiceLevel.lastHud > 90) {
    setVoiceLevel.lastHud = performance.now();
    api.hudLevel(cleanLevel, recordingStartedAt ? (Date.now() - recordingStartedAt) / 1000 : 0);
  }
  appShell.style.setProperty('--voice-level', cleanLevel.toFixed(3));
  appShell.style.setProperty('--voice-opacity', String(0.16 + cleanLevel * 0.84));

  const boosts = [0.58, 0.86, 1.18, 0.92, 0.66];
  waveformBars.forEach((bar, index) => {
    const lift = Math.min(1, cleanLevel * boosts[index] * 1.7);
    const scale = 0.16 + lift * 0.92;
    bar.style.transform = `scaleY(${scale.toFixed(3)})`;
    bar.style.opacity = String(0.42 + lift * 0.58);
  });
}

async function startAudioVisualizer(stream) {
  stopAudioVisualizer();

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    throw new Error('当前环境不支持麦克风音频采集。');
  }

  try {
    audioContext = new AudioContext();
    audioSampleRate = audioContext.sampleRate;
    audioSourceNode = audioContext.createMediaStreamSource(stream);
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioAnalyser.smoothingTimeConstant = 0.68;
    audioLevelData = new Uint8Array(audioAnalyser.fftSize);
    audioSourceNode.connect(audioAnalyser);

    if (activeStreaming) {
      await audioContext.audioWorklet.addModule('./pcm-capture.js');
      audioCaptureProcessor = new AudioWorkletNode(audioContext, 'pcm-capture');
      audioCaptureProcessor.port.onmessage = ({ data }) => {
        if (data.type === 'pcm') queueStreamingAudio(data.pcm);
        if (data.type === 'flushed') resolveCaptureFlush?.();
      };
    } else {
      audioCaptureProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      audioCaptureProcessor.onaudioprocess = (event) => {
        if ((currentSettings.provider || 'local') === 'local') {
          pushAudioSamples(event.inputBuffer.getChannelData(0));
        }
      };
    }
    audioCaptureSilence = audioContext.createGain();
    audioCaptureSilence.gain.value = 0;
    audioSourceNode.connect(audioCaptureProcessor);
    audioCaptureProcessor.connect(audioCaptureSilence);
    audioCaptureSilence.connect(audioContext.destination);
    await audioContext.resume();

    const draw = () => {
      if (!audioAnalyser) {
        return;
      }

      audioAnalyser.getByteTimeDomainData(audioLevelData);
      let sum = 0;
      for (const value of audioLevelData) {
        const centered = (value - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / audioLevelData.length);
      setVoiceLevel(Math.min(1, rms * 5.5));
      audioVisualFrameId = window.requestAnimationFrame(draw);
    };

    draw();
  } catch (error) {
    stopAudioVisualizer();
    throw error;
  }
}

function failStreaming(state, error) {
  if (state !== activeStreaming || state.error) return;
  state.error = error;
  if (mediaRecorder?.state === 'recording') void stopRecording();
}

function queueStreamingAudio(pcm) {
  const state = activeStreaming;
  if (!state || state.error) return;
  const rate = audioSampleRate;
  const seconds = pcm.byteLength / 4 / rate;
  state.queuedSeconds += seconds;
  if (state.queuedSeconds > 8) {
    failStreaming(state, new Error('识别处理跟不上录音，已保留文字。请关闭占用较高的程序后重试。'));
    return;
  }
  state.queue = state.queue.then(async () => {
    if (!state.error) await api.streamAudio(state.id, pcm, rate);
  }).catch((error) => failStreaming(state, error)).finally(() => {
    state.queuedSeconds -= seconds;
  });
}

async function flushStreamingCapture() {
  if (!audioCaptureProcessor?.port) return;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      resolveCaptureFlush = null;
      reject(new Error('麦克风收尾失败，已保留识别文字，请重试。'));
    }, 2000);
    resolveCaptureFlush = () => {
      window.clearTimeout(timeout);
      resolveCaptureFlush = null;
      resolve();
    };
    audioCaptureProcessor.port.postMessage('stop');
  });
}

function stopAudioVisualizer() {
  if (audioVisualFrameId) {
    window.cancelAnimationFrame(audioVisualFrameId);
    audioVisualFrameId = null;
  }
  if (audioSourceNode) {
    try {
      audioSourceNode.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  if (audioCaptureProcessor) {
    audioCaptureProcessor.onaudioprocess = null;
    if (audioCaptureProcessor.port) audioCaptureProcessor.port.onmessage = null;
    try {
      audioCaptureProcessor.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  if (audioCaptureSilence) {
    try {
      audioCaptureSilence.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
  }

  audioContext = null;
  audioSourceNode = null;
  audioCaptureProcessor = null;
  audioCaptureSilence = null;
  audioAnalyser = null;
  audioLevelData = null;
  setVoiceLevel(0);
}

function startBrowserSpeechHints() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }

  try {
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = normalizeLanguageSetting(currentSettings.language) === 'en' ? 'en-US' : 'zh-CN';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = true;
    speechRecognition.onresult = (event) => {
      let text = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }
      interimText = text.trim();
      if (interimText) {
        setTranscriptText(joinTranscriptText(recordingBaseText, interimText));
      }
    };
    speechRecognition.start();
  } catch {
    speechRecognition = null;
  }
}

function stopBrowserSpeechHints() {
  if (!speechRecognition) {
    return;
  }
  try {
    speechRecognition.stop();
  } catch {
    // The browser engine may already have stopped.
  }
  speechRecognition = null;
}

function appendPreviewText(text) {
  const cleanText = normalizeRecognizedText(text);
  if (!cleanText) {
    return;
  }

  previewTranscriptText = joinTranscriptText(previewTranscriptText, cleanText);
  setTranscriptText(previewTranscriptText);
}

function canAcceptPreviewResult(token) {
  return token === recordingToken
    && (mediaRecorder?.state === 'recording' || finalizingRecordingToken === token);
}

async function runLocalPreview(token) {
  if (token !== recordingToken) {
    return;
  }
  if (previewPromise || !mediaRecorder || mediaRecorder.state !== 'recording') {
    return;
  }
  if ((currentSettings.provider || 'local') !== 'local') {
    return;
  }
  if (Date.now() - recordingStartedAt < getLocalPreviewWarmupMs()) {
    return;
  }

  const wavBuffer = takePreviewWav();
  if (!wavBuffer) {
    return;
  }

  previewPromise = (async () => {
    try {
      const result = await api.transcribe(wavBuffer, 'audio/wav', { preview: true });
      if (canAcceptPreviewResult(token)) {
        appendPreviewText(result.text);
      }
    } catch (error) {
      if (canAcceptPreviewResult(token)) {
        setStatus(`本地${getLocalEngineName()}预览暂不可用：${error.message || '转写失败'}`, 'recording');
      }
    } finally {
      previewPromise = null;
    }
  })();

  await previewPromise;
}

function startLocalPreviewLoop(token) {
  stopLocalPreviewLoop();
  window.setTimeout(() => runLocalPreview(token), getLocalPreviewWarmupMs());
  previewTimerId = window.setInterval(() => runLocalPreview(token), getLocalPreviewInterval());
}

function stopLocalPreviewLoop() {
  if (previewTimerId) {
    window.clearInterval(previewTimerId);
    previewTimerId = null;
  }
}

function resetAudioBuffers() {
  audioSampleRate = 0;
  fullAudioSamples = [];
  fullAudioSampleCount = 0;
  previewAudioSamples = [];
  previewAudioSampleCount = 0;
}

function pushAudioSamples(input) {
  const copy = new Float32Array(input.length);
  copy.set(input);
  fullAudioSamples.push(copy);
  previewAudioSamples.push(copy);
  fullAudioSampleCount += copy.length;
  previewAudioSampleCount += copy.length;
}

function mergeAudioSamples(parts, totalSamples) {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function calculateRms(samples) {
  if (!samples.length) {
    return 0;
  }

  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

function downsampleAudio(samples, sourceRate, targetRate) {
  if (!sourceRate || sourceRate <= targetRate) {
    return samples;
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += samples[inputIndex];
    }
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function buildWavFromSamples(samples, sourceRate) {
  const targetRate = 16000;
  const downsampled = downsampleAudio(samples, sourceRate, targetRate);
  return encodeWav(downsampled, sourceRate > targetRate ? targetRate : sourceRate);
}

function takePreviewWav(options = {}) {
  const minSeconds = options.minSeconds ?? 1.2;
  const minRms = options.minRms ?? 0.0015;
  const sourceRate = audioSampleRate;
  const samples = previewAudioSamples;
  const totalSamples = previewAudioSampleCount;
  previewAudioSamples = [];
  previewAudioSampleCount = 0;

  if (!sourceRate || totalSamples < sourceRate * minSeconds) {
    return null;
  }

  const merged = mergeAudioSamples(samples, totalSamples);
  if (calculateRms(merged) < minRms) {
    return null;
  }

  return buildWavFromSamples(merged, sourceRate);
}

function buildFinalLocalWav() {
  if (!audioSampleRate || fullAudioSampleCount < audioSampleRate * 0.25) {
    return null;
  }

  const merged = mergeAudioSamples(fullAudioSamples, fullAudioSampleCount);
  if (calculateRms(merged) < 0.0007) {
    return null;
  }

  return buildWavFromSamples(merged, audioSampleRate);
}

async function startRecording(options = {}) {
  if (!appReady || isRecordingBusy()) {
    return;
  }
  recordingStartInFlight = true;
  stopAfterRecordingStart = false;
  featureState.cancelRequested = false;
  featureState.revision = null;
  featureState.pendingInsertion = null;
  featureState.live = null;
  renderRevision();

  const isDirect = Boolean(options.direct);
  activeRecordingMode = isDirect ? 'direct' : 'panel';
  directPasteTargetHwnd = isDirect ? Number(options.targetHwnd || 0) : 0;

  try {
    await api.recordingActivity(true);
    if (appShell.classList.contains('settings')) fillSettingsForm(savedSettings);
    if (!isDirect) setMode('expanded');
    setStatus(isDirect ? '快捷直输：正在请求麦克风权限' : '正在请求麦克风权限', 'transcribing');
    transcript.readOnly = true;
    chunks = [];
    interimText = '';
    recordingBaseText = transcript.value;
    previewTranscriptText = recordingBaseText;
    setTranscriptText(recordingBaseText, { immediate: true });
    resetAudioBuffers();
    finalizingRecordingToken = null;
    recordingToken += 1;
    const token = recordingToken;

    if (isStreamingLocal()) {
      activeStreaming = { id: `recording-${Date.now()}-${token}`, queue: Promise.resolve(), queuedSeconds: 0, error: null };
      if (isDirect) {
        featureState.live = await api.beginLiveInput(activeStreaming.id, directPasteTargetHwnd);
        if (featureState.live.targetHwnd) directPasteTargetHwnd = featureState.live.targetHwnd;
      }
      if (isDirect) { setMode('expanded'); await api.showPreview(); }
      setStatus('正在准备本地流式识别', 'transcribing');
      await api.startStreaming(activeStreaming.id);
      if (featureState.cancelRequested) throw new Error('已取消录音');
    }
    if (isDirect && !activeStreaming) { setMode('expanded'); await api.showPreview(); }
    mediaStream = await getMicrophoneStream();
    if (featureState.cancelRequested) throw new Error('已取消录音');
    await startAudioVisualizer(mediaStream);
    if (featureState.cancelRequested) throw new Error('已取消录音');

    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && !activeStreaming) {
        chunks.push(event.data);
      }
    };
    mediaRecorder.onstop = handleRecordingStopped;
    mediaRecorder.start(1000);

    recordingStartedAt = Date.now();
    if (!activeStreaming && (currentSettings.provider || 'local') === 'local') {
      startLocalPreviewLoop(token);
    } else if (!activeStreaming) {
      startBrowserSpeechHints();
    }
    startTimer();
    setStatus(getRecordingStatusText(), 'recording');
    api.hudStatus(featureState.live?.blocked ? 'blocked' : 'recording');
  } catch (error) {
    stopEverything();
    await api.cancelLiveInput().catch(() => {});
    if (activeStreaming) await api.cancelStreaming(activeStreaming.id).catch(() => {});
    activeStreaming = null;
    await api.recordingActivity(false);
    transcript.readOnly = false;
    if (!isDirect) {
      setMode('expanded');
    }
    activeRecordingMode = 'panel';
    directPasteTargetHwnd = 0;
    setStatus(featureState.cancelRequested ? '已取消，草稿已保留' : `录音启动失败：${error.message}`, featureState.cancelRequested ? 'ready' : 'error');
  } finally {
    recordingStartInFlight = false;
    featureState.canceling = false;
    updateFeatureControls();
    if (stopAfterRecordingStart) {
      stopAfterRecordingStart = false;
      await stopRecording();
    }
  }
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') {
    return;
  }
  stopTimer();
  stopBrowserSpeechHints();
  stopLocalPreviewLoop();
  finalizingRecordingToken = recordingToken;
  const isDirect = activeRecordingMode === 'direct';
  const statusText = isDirect
    ? '快捷直输：正在识别并准备粘贴'
    : ((currentSettings.provider || 'local') === 'local' ? '正在收尾最后一段' : '正在转写，请稍等');
  setStatus(statusText, 'transcribing');
  api.hudStatus(currentSettings.language === 'zh-to-en' ? 'translating' : 'processing');
  try {
    mediaRecorder.requestData();
  } catch {
    // Some MediaRecorder implementations flush automatically on stop.
  }
  mediaRecorder.stop();
}

function stopEverything() {
  stopTimer();
  stopBrowserSpeechHints();
  stopLocalPreviewLoop();
  stopAudioVisualizer();
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) {
      track.stop();
    }
  }
  mediaStream = null;
  mediaRecorder = null;
}

async function handleRecordingStopped() {
  const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
  const mimeType = blob.type || 'audio/webm';
  const token = recordingToken;
  finalizingRecordingToken = token;
  const isLocal = (currentSettings.provider || 'local') === 'local';
  const recordingMode = activeRecordingMode;
  const isDirect = recordingMode === 'direct';
  const streaming = activeStreaming;

  try {
    if (streaming) await flushStreamingCapture();
    stopEverything();
    if (streaming) {
      await streaming.queue;
      if (streaming.error) throw streaming.error;
      const result = await api.finishStreaming(streaming.id);
      if (token !== recordingToken) return;
      const newText = normalizeRecognizedText(result.text);
      await completeTranscript(newText, 'local-paraformer', token, isDirect);
      return;
    }
    if (blob.size < 512) {
      throw new Error('录音太短，没有可转写的内容。');
    }

    if (isLocal) {
      if (previewPromise) {
        await previewPromise.catch(() => {});
      }
      if (token !== recordingToken) return;

      const remainingWav = takePreviewWav({ minSeconds: 0.35, minRms: 0.0012 });
      if (remainingWav) {
        const result = await api.transcribe(remainingWav, 'audio/wav', { preview: true });
        if (token === recordingToken) {
          appendPreviewText(result.text);
        }
      }

      flushTranscriptReveal();
      let finalText = filterTextByLanguage(previewTranscriptText || transcript.value).trim();
      let newText = finalText.startsWith(recordingBaseText.trim()) ? finalText.slice(recordingBaseText.trim().length).trim() : finalText;
      if (!newText && !previewTranscriptText.trim()) {
        const finalWav = buildFinalLocalWav();
        const finalAudio = finalWav || await blob.arrayBuffer();
        const finalMimeType = finalWav ? 'audio/wav' : mimeType;
        if (finalAudio) {
          setStatus('预览没有出字，正在用完整录音识别', 'transcribing');
          const result = await api.transcribe(finalAudio, finalMimeType, { preview: true });
          newText = filterTextByLanguage(result.text || '').trim();
        }
      }
      if (token !== recordingToken) return;
      await completeTranscript(newText, `local-${getLocalEngine()}`, token, isDirect);
      return;
    }

    const finalWav = (currentSettings.provider || 'local') === 'local' ? buildFinalLocalWav() : null;
    const transcribeOptions = { saveHistory: false };
    const result = finalWav
      ? await api.transcribe(finalWav, 'audio/wav', transcribeOptions)
      : await api.transcribe(await blob.arrayBuffer(), mimeType, transcribeOptions);
    if (token !== recordingToken) return;
    await completeTranscript(filterTextByLanguage(result.text || interimText || '').trim(), result.provider || currentSettings.provider || 'cloud', token, isDirect);
  } catch (error) {
    if (token !== recordingToken) return;
    if (featureState.live?.attempted) {
      featureState.pendingInsertion = { base: transcript.value, blocked: true };
      api.hudStatus('blocked');
    }
    if (streaming) await api.cancelStreaming(streaming.id).catch(() => {});
    transcript.readOnly = false;
    if (!transcript.value && interimText) {
      setTranscriptText(interimText, { immediate: true });
    }
    setStatus(isDirect ? `快捷直输失败：${error.message || '转写失败'}` : (error.message || '转写失败'), 'error');
  } finally {
    stopEverything();
    await api.cancelLiveInput().catch(() => {});
    await api.recordingActivity(false);
    if (activeStreaming === streaming) activeStreaming = null;
    if (finalizingRecordingToken === token) {
      finalizingRecordingToken = null;
    }
    if (activeRecordingMode === recordingMode) {
      activeRecordingMode = 'panel';
      directPasteTargetHwnd = 0;
    }
    updateFeatureControls();
    scheduleDraftSave();
  }
}

async function toggleRecording(options = {}) {
  if (recordingStartInFlight) {
    if (options.action !== 'start') stopAfterRecordingStart = true;
    return;
  }
  if (finalizingRecordingToken !== null) return;
  if (options.action === 'stop') {
    await stopRecording();
    return;
  }
  if (options.action === 'start' && mediaRecorder?.state === 'recording') return;
  if (mediaRecorder?.state === 'recording') {
    await stopRecording();
  } else {
    await startRecording(options);
  }
}

async function copyText() {
  if (transcriptRevealTimerId) {
    flushTranscriptReveal();
  }
  const text = transcript.value.trim();
  if (!text) {
    setStatus('没有可复制的文字', 'error');
    return;
  }
  await api.copyText(text);
  setStatus('已复制到剪贴板');
  await refreshHistory();
}

async function pasteRecognizedText(text, options = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    setStatus(options.emptyStatus || '没有可粘贴的文字', 'error');
    return { ok: false, copied: false };
  }
  const result = await api.pasteText(cleanText, {
    saveHistory: options.saveHistory !== false,
    targetHwnd: options.targetHwnd || 0,
    inputMethod: options.inputMethod || currentSettings.inputMethod || 'type'
  });
  setStatus(
    result.ok
      ? (options.successStatus || '已粘贴到当前输入框')
      : `输入未完成，草稿已保留：${result.error || '可能被目标软件拦截'}`,
    result.ok ? 'ready' : 'error'
  );
  if (options.refreshHistory !== false) {
    await refreshHistory();
  }
  return result;
}

async function pasteText() {
  if (isRecordingBusy()) return;
  if (transcriptRevealTimerId) {
    flushTranscriptReveal();
  }
  const pending = featureState.pendingInsertion;
  if (pending?.blocked) { setStatus('实时输入已暂停，请复制全文并确认目标位置', 'error'); return; }
  if (pending && !transcript.value.startsWith(pending.base)) {
    setStatus('已有文字被修改，请先复制并确认目标位置', 'error');
    return;
  }
  const text = pending ? transcript.value.slice(pending.base.length).trim() : transcript.value;
  featureState.pasteBusy = true;
  updateFeatureControls();
  try {
    const result = await pasteRecognizedText(text, { targetHwnd: pending?.targetHwnd || 0 });
    if (result.ok && pending) featureState.pendingInsertion = { ...pending, base: transcript.value };
  } finally { featureState.pasteBusy = false; updateFeatureControls(); }
}

function clearTranscript() {
  if (isRecordingBusy()) {
    return;
  }

  setTranscriptText('', { immediate: true });
  featureState.revision = null;
  featureState.pendingInsertion = null;
  renderRevision();
  void flushDraftSave();
  previewTranscriptText = '';
  recordingBaseText = '';
  interimText = '';
  setStatus('当前文字已清除');
}

function enableTranscriptEditing() {
  if (isRecordingBusy()) {
    return;
  }

  transcript.readOnly = false;
  if (transcriptRevealTimerId) {
    stopTranscriptReveal();
    transcriptRevealTarget = transcript.value;
  }
  if (transcript.value.trim()) {
    setStatus('可以编辑');
  }
}

function fillSettingsForm(settings) {
  currentSettings = { ...settings, language: normalizeLanguageSetting(settings.language) };
  savedSettings = { ...currentSettings };
  for (const option of settingsInputs.localEngine.options) {
    option.disabled = !!settings.bundledRuntime && option.value !== 'paraformer';
    if (option.disabled) option.textContent = option.value === 'sensevoice' ? 'SenseVoice（未包含）' : 'Whisper（未包含）';
  }
  settingsInputs.localPythonPath.readOnly = !!settings.bundledRuntime;
  for (const key of ['localDevice', 'localModel', 'localSenseVoiceModel']) settingsInputs[key].disabled = !!settings.bundledRuntime;
  for (const [key, input] of Object.entries(settingsInputs)) {
    if (!input) {
      continue;
    }
    const value = currentSettings[key];
    if (input.type === 'checkbox') input.checked = value !== false;
    else input.value = typeof value === 'boolean' ? String(value) : (value ?? '');
  }
  renderExpressionMode();
  updateEngineLabel();
  savedSettingsSnapshot = settingsComparable(readSettingsForm());
  updateSettingsDirtyState(false);
  setSettingsStatus('设置');
}

function syncSettingsPreview() {
  updateLocalEngineFields();
  updateSettingsDirtyState();
}

function readSettingsForm() {
  return {
    ...readFeatureSettings(),
    provider: settingsInputs.provider.value,
    language: normalizeLanguageSetting(settingsInputs.language.value),
    micDeviceId: settingsInputs.micDeviceId.value,
    openaiApiKey: settingsInputs.openaiApiKey.value.trim(),
    openaiModel: settingsInputs.openaiModel.value,
    localEngine: settingsInputs.localEngine.value,
    localPythonPath: settingsInputs.localPythonPath.value.trim() || 'python',
    localModel: settingsInputs.localModel.value,
    localSenseVoiceModel: settingsInputs.localSenseVoiceModel.value.trim() || 'iic/SenseVoiceSmall',
    localDevice: settingsInputs.localDevice.value,
    recordTriggerMode: settingsInputs.recordTriggerMode.value,
    startStopShortcut: settingsInputs.startStopShortcut.value.trim(),
    hideShowShortcut: settingsInputs.hideShowShortcut.value.trim(),
    pasteShortcut: settingsInputs.pasteShortcut.value.trim(),
    inputMethod: settingsInputs.inputMethod.value === 'paste' ? 'paste' : 'type',
    liveInputMode: settingsInputs.liveInputMode.value === 'strict' ? 'strict' : 'compatible',
    autoHideAfterPaste: settingsInputs.autoHideAfterPaste.value === 'true',
    launchAtLogin: settingsInputs.launchAtLogin.checked,
    aiExtensionUrl: settingsInputs.aiExtensionUrl.value.trim()
  };
}

async function saveSettings() {
  if (isRecordingBusy()) return;
  try {
    for (const button of saveSettingsButtons) {
      button.disabled = true;
    }
    setSettingsStatus('正在保存...');
    const nextSettings = await api.saveSettings(readSettingsForm());
    fillSettingsForm(nextSettings);
    setMode('settings');
    setSettingsStatus('已保存，设置已生效');
    setStatus('设置已保存');
  } catch (error) {
    setSettingsStatus(`保存失败：${error.message || '未知错误'}`, 'error');
  } finally {
    for (const button of saveSettingsButtons) {
      button.disabled = false;
    }
  }
}

async function toggleProvider() {
  if (isRecordingBusy()) {
    return;
  }

  const currentProvider = currentSettings.provider || 'local';
  const provider = currentProvider === 'local' ? 'cloud' : 'local';
  const nextSettings = await api.saveSettings({ ...currentSettings, provider });
  fillSettingsForm(nextSettings);
  setStatus(provider === 'local' ? `已切换到本地 ${getLocalEngineName()}` : '已切换到云端 OpenAI');
}

function getShortcutButton(key) {
  return document.querySelector(`[data-shortcut="${key}"]`);
}

function finishShortcutCapture() {
  if (!capturingShortcut) {
    return;
  }

  const button = getShortcutButton(capturingShortcut.key);
  if (button) {
    button.textContent = '重设';
    button.classList.remove('capturing');
  }
  capturingShortcut = null;
}

function beginShortcutCapture(event) {
  event.preventDefault();
  event.stopPropagation();

  const key = event.currentTarget.dataset.shortcut;
  if (!key || !settingsInputs[key]) {
    return;
  }
  if (capturingShortcut?.key === key) {
    return;
  }

  finishShortcutCapture();
  capturingShortcut = {
    key,
    previousValue: settingsInputs[key].value,
    startedAt: Date.now()
  };
  settingsInputs[key].value = '请直接按新的快捷键';
  event.currentTarget.textContent = '监听中';
  event.currentTarget.classList.add('capturing');
  setStatus('正在监听快捷键，按 Esc 取消');
}

function normalizeShortcutKey(event) {
  if (event.repeat) {
    return '';
  }

  const ignoredKeys = new Set([
    'Control',
    'Shift',
    'Alt',
    'Meta',
    'Fn',
    'FnLock',
    'NumLock',
    'CapsLock',
    'ScrollLock',
    'Process',
    'Unidentified',
    'Dead'
  ]);
  if (ignoredKeys.has(event.key)) {
    return '';
  }

  const namedKeys = {
    ' ': 'Space',
    Spacebar: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Tab: 'Tab',
    Enter: 'Enter',
    Escape: 'Escape'
  };

  if (namedKeys[event.key]) {
    return namedKeys[event.key];
  }
  if (/^F([1-9]|1\d|2[0-4])$/i.test(event.key)) {
    return event.key.toUpperCase();
  }
  if (event.code?.startsWith('Key')) {
    return event.code.slice(3).toUpperCase();
  }
  if (event.code?.startsWith('Digit')) {
    return event.code.slice(5);
  }
  if (event.key?.length === 1) {
    return event.key.toUpperCase();
  }

  return event.key || '';
}

function buildShortcutAccelerator(event) {
  const key = normalizeShortcutKey(event);
  if (!key) {
    return '';
  }

  const parts = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push('CommandOrControl');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  if (!parts.includes(key)) {
    parts.push(key);
  }

  return parts.join('+');
}

function shortcutAlreadyUsed(targetKey, accelerator) {
  return ['startStopShortcut', 'hideShowShortcut', 'pasteShortcut'].some((key) => {
    return key !== targetKey
      && settingsInputs[key]?.value.trim().toLowerCase() === accelerator.toLowerCase();
  });
}

function isUnsafeBareAccelerator(accelerator) {
  const cleanAccelerator = String(accelerator || '').trim();
  return cleanAccelerator
    && !cleanAccelerator.includes('+')
    && !/^F([1-9]|1\d|2[0-4])$/i.test(cleanAccelerator);
}

async function handleShortcutCapture(event) {
  if (!capturingShortcut) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (Date.now() - capturingShortcut.startedAt < 180) {
    return;
  }

  if (event.key === 'Escape') {
    settingsInputs[capturingShortcut.key].value = capturingShortcut.previousValue;
    finishShortcutCapture();
    setStatus('已取消快捷键重设');
    return;
  }

  const accelerator = buildShortcutAccelerator(event);
  if (!accelerator) {
    setStatus('请再按一个普通键，或直接按一个功能键', 'error');
    return;
  }
  if (isUnsafeBareAccelerator(accelerator)) {
    setStatus('普通单键会影响打字，请加 Ctrl/Alt/Shift，或直接用 F1-F12。', 'error');
    return;
  }
  if (shortcutAlreadyUsed(capturingShortcut.key, accelerator)) {
    setStatus('这个快捷键已经被另一个功能占用了', 'error');
    return;
  }

  const targetKey = capturingShortcut.key;
  settingsInputs[targetKey].value = accelerator;
  finishShortcutCapture();
  syncSettingsPreview();
  setSettingsStatus(`已填入 ${accelerator}，点保存后生效`);
}

function formatDate(iso) {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

async function refreshHistory() {
  const history = await api.getHistory();
  featureState.history = history;
  renderHistory();
}

function clearOrbHoldTimer() {
  if (orbHoldTimerId) {
    window.clearTimeout(orbHoldTimerId);
    orbHoldTimerId = null;
  }
}

function startOrbHoldTimer(pointerId) {
  clearOrbHoldTimer();
  stopWhenHoldStartCompletes = false;

  orbHoldTimerId = window.setTimeout(() => {
    orbHoldTimerId = null;
    if (
      !dragState
      || dragState.pointerId !== pointerId
      || dragState.dragging
      || appShell.classList.contains('transcribing')
      || mediaRecorder?.state === 'recording'
    ) {
      return;
    }

    dragState.holdStarted = true;
    orbHoldStartInFlight = true;
    void (async () => {
      await startRecording();
      orbHoldStartInFlight = false;
      if (stopWhenHoldStartCompletes) {
        stopWhenHoldStartCompletes = false;
        if (mediaRecorder?.state === 'recording') {
          await stopRecording();
        }
      }
    })().catch((error) => {
      orbHoldStartInFlight = false;
      stopWhenHoldStartCompletes = false;
      setStatus(`录音启动失败：${error.message || '未知错误'}`, 'error');
    });
  }, HOLD_TO_RECORD_DELAY_MS);
}

async function stopOrbHoldRecording() {
  stopWhenHoldStartCompletes = true;
  if (mediaRecorder?.state === 'recording') {
    stopWhenHoldStartCompletes = false;
    await stopRecording();
  } else if (!orbHoldStartInFlight) {
    stopWhenHoldStartCompletes = false;
  }
}

async function beginOrbPointer(event) {
  if (event.button !== 0) {
    return;
  }

  const bounds = await api.getWindowBounds();
  if (!bounds) {
    return;
  }

  const triggerMode = getRecordTriggerMode();
  dragState = {
    pointerId: event.pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    windowX: bounds.x,
    windowY: bounds.y,
    dragging: false,
    holdStarted: false,
    triggerMode
  };
  recordToggle.setPointerCapture(event.pointerId);
  if (triggerMode === 'hold') {
    startOrbHoldTimer(event.pointerId);
  }
}

function moveOrbPointer(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }
  if (dragState.holdStarted) {
    return;
  }

  const dx = event.screenX - dragState.startScreenX;
  const dy = event.screenY - dragState.startScreenY;
  if (!dragState.dragging && Math.hypot(dx, dy) > 5) {
    dragState.dragging = true;
    clearOrbHoldTimer();
  }

  if (dragState.dragging) {
    api.setWindowPosition({
      x: dragState.windowX + dx,
      y: dragState.windowY + dy
    });
  }
}

async function endOrbPointer(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) {
    return;
  }

  const wasDragging = dragState.dragging;
  const wasHoldStarted = dragState.holdStarted;
  const wasHoldMode = dragState.triggerMode === 'hold';
  clearOrbHoldTimer();
  dragState = null;
  try {
    recordToggle.releasePointerCapture(event.pointerId);
  } catch {
    // Pointer capture may have already been released by the browser.
  }

  if (wasHoldMode) {
    if (wasHoldStarted) {
      await stopOrbHoldRecording();
    } else if (!wasDragging) {
      setStatus('按住圆钮说话，松开结束');
    }
    return;
  }

  if (!wasDragging) {
    await toggleRecording();
  }
}

async function cancelOrbPointer() {
  const shouldStopHold = dragState?.triggerMode === 'hold' && dragState.holdStarted;
  clearOrbHoldTimer();
  dragState = null;
  if (shouldStopHold) {
    await stopOrbHoldRecording();
  }
}

recordToggle.addEventListener('pointerdown', beginOrbPointer);
recordToggle.addEventListener('pointermove', moveOrbPointer);
recordToggle.addEventListener('pointerup', endOrbPointer);
recordToggle.addEventListener('pointercancel', () => {
  void cancelOrbPointer();
});
settingsToggle.addEventListener('click', async () => {
  if (isRecordingBusy()) {
    return;
  }
  setMode('settings');
  await populateMicrophones({ requestPermission: true });
  await refreshHistory();
  await refreshFeatureStatus();
});
refreshMicsButton.addEventListener('click', () => populateMicrophones({ requestPermission: true }));
providerSwitch.addEventListener('click', toggleProvider);
for (const button of shortcutCaptureButtons) {
  button.addEventListener('click', beginShortcutCapture);
  button.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}
closeSettings.addEventListener('click', () => {
  finishShortcutCapture();
  fillSettingsForm(savedSettings);
  setMode('compact');
});
hideButton.addEventListener('click', () => {
  setMode('compact');
});
for (const button of [orbMinimize, orbClose]) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}
orbMinimize.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  api.hide();
});
orbClose.addEventListener('click', async (event) => {
  event.preventDefault();
  event.stopPropagation();
  await flushDraftSave();
  api.quit();
});
clearTranscriptButton.addEventListener('click', clearTranscript);
copyButton.addEventListener('click', copyText);
pasteButton.addEventListener('click', pasteText);
for (const button of saveSettingsButtons) {
  button.addEventListener('click', saveSettings);
}
settingsInputs.provider.addEventListener('change', syncSettingsPreview);
settingsInputs.language.addEventListener('change', syncSettingsPreview);
settingsInputs.micDeviceId.addEventListener('change', syncSettingsPreview);
settingsInputs.localEngine.addEventListener('change', syncSettingsPreview);
settingsInputs.localModel.addEventListener('change', syncSettingsPreview);
settingsInputs.localSenseVoiceModel.addEventListener('input', syncSettingsPreview);
settingsInputs.openaiModel.addEventListener('change', syncSettingsPreview);
settingsInputs.localDevice.addEventListener('change', syncSettingsPreview);
settingsInputs.recordTriggerMode.addEventListener('change', syncSettingsPreview);
settingsInputs.inputMethod.addEventListener('change', syncSettingsPreview);
settingsInputs.liveInputMode.addEventListener('change', syncSettingsPreview);
settingsInputs.autoHideAfterPaste.addEventListener('change', syncSettingsPreview);
settingsInputs.launchAtLogin.addEventListener('change', syncSettingsPreview);
settingsInputs.aiExtensionUrl.addEventListener('input', syncSettingsPreview);
settingsInputs.openaiApiKey.addEventListener('input', syncSettingsPreview);
settingsInputs.localPythonPath.addEventListener('input', syncSettingsPreview);
clearHistoryButton.addEventListener('click', async () => {
  if (!window.confirm('清空全部语音记录？当前草稿不会删除。')) return;
  await api.clearHistory();
  await refreshHistory();
});
openDataFolderButton.addEventListener('click', () => api.openUserData());
openAppFolderButton.addEventListener('click', () => api.openAppFolder());

transcript.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    await pasteText();
  }
});
transcript.addEventListener('focus', enableTranscriptEditing);
transcript.addEventListener('click', enableTranscriptEditing);

document.addEventListener('keydown', handleShortcutCapture, true);

document.addEventListener('keydown', async (event) => {
  if (event.defaultPrevented || capturingShortcut) return;
  if (event.key === 'Escape') {
    if (isRecordingBusy()) await cancelCurrentTask();
    else setMode('compact');
  }
});

api.onStartStopShortcut((payload) => toggleRecording(payload));
api.onPasteShortcut(() => pasteText());
api.onStreamingPartial((message) => {
  if (!activeStreaming || message.session !== activeStreaming.id || activeStreaming.error) return;
  setTranscriptText(joinTranscriptText(recordingBaseText, message.text), { immediate: true });
});
api.onLiveInputState((state) => {
  if (activeStreaming?.id !== state.session) return;
  featureState.live = state;
  if (state.blocked) element('reviewNotice').textContent = '实时输入已暂停，完整文字仍保留在这里';
});
api.onStreamingFailure((message) => {
  if (activeStreaming?.id === message.session) failStreaming(activeStreaming, new Error(message.error));
});

async function boot() {
  recordToggle.disabled = true;
  setMode('compact');
  fillSettingsForm(await api.getSettings());
  await populateMicrophones();
  await refreshHistory();
  await initFeatures();
  appReady = true;
  recordToggle.disabled = false;
}

boot();
