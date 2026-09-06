const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceAgentPad', {
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  beginLiveInput: (session, targetHwnd) => ipcRenderer.invoke('live:begin', { session, targetHwnd }),
  finishLiveInput: (session, text) => ipcRenderer.invoke('live:finish', { session, text }),
  cancelLiveInput: () => ipcRenderer.invoke('live:cancel'),
  onLiveInputState: (callback) => ipcRenderer.on('live:state', (_event, state) => callback(state)),
  hudLevel: (level, seconds) => ipcRenderer.send('hud:level', { level, seconds }),
  hudStatus: (status) => ipcRenderer.send('hud:status', status),
  listPacks: () => ipcRenderer.invoke('packs:list'),
  previewPack: (id) => ipcRenderer.invoke('packs:preview', id),
  installPack: (id) => ipcRenderer.invoke('packs:install', id),
  cancelPack: (id) => ipcRenderer.invoke('packs:cancel', id),
  changePack: (id, action, enabled) => ipcRenderer.invoke('packs:change', { id, action, enabled }),
  openPackSource: (id) => ipcRenderer.invoke('packs:open-source', id),
  onPacksChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('packs:changed', listener);
    return () => ipcRenderer.removeListener('packs:changed', listener);
  },
  saveSettings: (settings) => ipcRenderer.invoke('app:save-settings', settings),
  getHistory: () => ipcRenderer.invoke('app:get-history'),
  clearHistory: () => ipcRenderer.invoke('app:clear-history'),
  historyAction: (id, action) => ipcRenderer.invoke('app:history-action', { id, action }),
  getDraft: () => ipcRenderer.invoke('app:get-draft'),
  saveDraft: (draft) => ipcRenderer.invoke('app:save-draft', draft),
  processText: (payload) => ipcRenderer.invoke('app:process-text', payload),
  cancelProcessing: (id) => ipcRenderer.invoke('app:cancel-processing', id),
  featureStatus: () => ipcRenderer.invoke('app:feature-status'),
  releaseModels: () => ipcRenderer.invoke('app:release-models'),
  downloadAiExtension: (url) => ipcRenderer.invoke('ai-extension:download-install', url),
  installLocalAiExtension: () => ipcRenderer.invoke('ai-extension:install-local'),
  cancelAiExtension: () => ipcRenderer.invoke('ai-extension:cancel'),
  onAiExtensionProgress: (callback) => {
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('ai-extension:progress', listener);
    return () => ipcRenderer.removeListener('ai-extension:progress', listener);
  },
  recordingActivity: (active) => ipcRenderer.invoke('app:recording-activity', active),
  onSettingsUpdated: (callback) => ipcRenderer.on('app:settings-updated', (_event, payload) => callback(payload)),
  transcribe: (arrayBuffer, mimeType, options = {}) => ipcRenderer.invoke('app:transcribe', { arrayBuffer, mimeType, options }),
  startStreaming: (session) => ipcRenderer.invoke('streaming:start', { session }),
  streamAudio: (session, pcm, sampleRate) => ipcRenderer.invoke('streaming:audio', { session, pcm, sampleRate }),
  finishStreaming: (session) => ipcRenderer.invoke('streaming:finish', { session }),
  cancelStreaming: (session) => ipcRenderer.invoke('streaming:cancel', { session }),
  onStreamingPartial: (callback) => ipcRenderer.on('streaming:partial', (_event, payload) => callback(payload)),
  onStreamingFailure: (callback) => ipcRenderer.on('streaming:failure', (_event, payload) => callback(payload)),
  pasteText: (text, options = {}) => ipcRenderer.invoke('app:paste-text', { text, options }),
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),
  saveTranscript: (text, provider, detail = {}) => ipcRenderer.invoke('app:save-transcript', { text, provider, detail }),
  getWindowBounds: () => ipcRenderer.invoke('app:get-window-bounds'),
  setWindowPosition: (position) => ipcRenderer.invoke('app:set-window-position', position),
  setMode: (mode) => ipcRenderer.invoke('app:set-mode', mode),
  showPreview: () => ipcRenderer.invoke('app:show-preview'),
  focusPreview: () => ipcRenderer.invoke('app:focus-preview'),
  hide: () => ipcRenderer.invoke('app:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openUserData: () => ipcRenderer.invoke('app:open-user-data'),
  openAppFolder: () => ipcRenderer.invoke('app:open-app-folder'),
  onStartStopShortcut: (callback) => ipcRenderer.on('shortcut:start-stop', (_event, payload) => callback(payload || {})),
  onPasteShortcut: (callback) => ipcRenderer.on('shortcut:paste', (_event, payload) => callback(payload || {}))
});
