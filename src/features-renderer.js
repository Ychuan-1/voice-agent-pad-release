const featureKeys = ['expressionMode', 'cleanupPreview', 'formatNumbers', 'formatPunctuation', 'standbyMode', 'idleMinutes', 'historyRetentionDays', 'saveDraft', 'saveHistory', 'liveExternalInput'];
const featureState = {
  revision: null, request: null, history: [], draftTimer: null,
  pendingInsertion: null, live: null, booted: false,
  cancelRequested: false, canceling: false, pasteBusy: false,
  editorInstalled: true, aiInstalling: false, aiExtensionSource: null
};
const element = (id) => document.getElementById(id);

function featureComparable(settings) {
  return Object.fromEntries(featureKeys.map((key) => [key, settings[key]]));
}

function readFeatureSettings() {
  return {
    ...Object.fromEntries(featureKeys.map((key) => {
      const input = element(key);
      return [key, input.type === 'checkbox' ? input.checked : input.type === 'number' || key === 'historyRetentionDays' ? Number(input.value) : input.value];
    }))
  };
}

function iconButton(icon, label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-icon';
  button.title = label;
  button.setAttribute('aria-label', label);
  const glyph = document.createElement('i');
  glyph.setAttribute('data-lucide', icon);
  button.append(glyph);
  button.addEventListener('click', handler);
  return button;
}

function refreshIcons() { window.lucide?.createIcons(); }

function renderExpressionMode() {
  const translating = currentSettings.language === 'zh-to-en';
  for (const button of document.querySelectorAll('[data-expression]')) {
    button.hidden = translating;
    button.setAttribute('aria-pressed', String(!translating && button.dataset.expression === (currentSettings.expressionMode || 'original')));
  }
  element('translationModeLabel').hidden = !translating;
  const label = translating ? '翻译当前文字' : '整理当前文字';
  element('processTextButton').title = label;
  element('processTextButton').setAttribute('aria-label', label);
}

function needsEditor(mode = currentSettings.expressionMode || 'original') {
  return currentSettings.language === 'zh-to-en' || ['daily', 'organized'].includes(mode);
}

function effectiveExpressionMode() {
  const mode = currentSettings.expressionMode || 'original';
  return needsEditor(mode) && !featureState.editorInstalled ? 'original' : mode;
}

function updateFeatureControls() {
  const busy = isRecordingBusy();
  transcript.readOnly = busy;
  element('cancelTaskButton').hidden = !busy || featureState.pasteBusy;
  element('processTextButton').disabled = busy || !transcript.value.trim() || (needsEditor() && !featureState.editorInstalled);
  element('clearTranscriptButton').disabled = busy;
  element('pasteButton').disabled = busy || !transcript.value.trim();
  for (const button of document.querySelectorAll('[data-expression]')) {
    button.disabled = busy || (button.dataset.expression !== 'original' && !featureState.editorInstalled);
  }
  const hasAiSource = !!(element('aiExtensionUrl').value.trim() || featureState.aiExtensionSource?.url);
  element('downloadAiExtension').disabled = busy || featureState.aiInstalling || !hasAiSource;
  element('installLocalAiExtension').disabled = busy || featureState.aiInstalling;
  element('cancelAiExtension').hidden = !featureState.aiInstalling;
}

function renderRevision() {
  const revision = featureState.revision;
  const details = element('revisionDetails');
  details.hidden = !revision || revision.original === revision.text;
  const diff = element('revisionDiff');
  diff.replaceChildren();
  if (revision) {
    if (revision.mode === 'translate-en') {
      const label = document.createElement('div'); label.className = 'translation-source-label'; label.textContent = '中文原文';
      const source = document.createElement('div'); source.textContent = revision.original;
      diff.append(label, source);
    } else {
      for (const part of revision.diff || [{ value: revision.original }]) {
        const node = document.createElement(part.added ? 'ins' : part.removed ? 'del' : 'span');
        node.textContent = part.value;
        diff.append(node);
      }
    }
  }
  element('reviewNotice').textContent = revision?.notice || revision?.warnings?.join('；') || '';
  updateFeatureControls();
}

function scheduleDraftSave() {
  if (!featureState.booted) return;
  clearTimeout(featureState.draftTimer);
  featureState.draftTimer = setTimeout(() => {
    void flushDraftSave().catch((error) => {
      element('reviewNotice').textContent = '草稿未能保存：' + error.message;
    });
  }, 200);
}

async function flushDraftSave() {
  clearTimeout(featureState.draftTimer);
  featureState.draftTimer = null;
  if (!featureState.booted) return;
  await api.saveDraft({ text: transcript.value, revision: featureState.revision });
}

async function requestTextProcessing(text, mode, liveSession = '') {
  const id = `edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const request = { id };
  featureState.request = request;
  transcript.readOnly = true;
  setStatus(currentSettings.language === 'zh-to-en' ? '正在本地翻译为英文' : mode === 'original' ? '正在校对文字' : '正在本地整理文字', 'transcribing');
  try {
    const result = await api.processText({ id, text, mode, liveSession });
    if (featureState.request !== request || request.cancelled || result.cancelled) return null;
    return result;
  } finally {
    if (featureState.request === request) featureState.request = null;
    updateFeatureControls();
  }
}

async function completeTranscript(newText, provider, token, isDirect) {
  if (token !== recordingToken) return;
  const base = recordingBaseText;
  const targetHwnd = directPasteTargetHwnd;
  if (!newText) {
    await api.cancelLiveInput().catch(() => {});
    setTranscriptText(base, { immediate: true });
    transcript.readOnly = false;
    setStatus('没有识别到新文字，已保留原文');
    return;
  }
  const live = featureState.live;
  // Once raw text has reached another app, never append an AI-rewritten copy.
  const result = await requestTextProcessing(newText, live?.attempted ? 'original' : effectiveExpressionMode(), live?.session);
  if (!result || token !== recordingToken || featureState.cancelRequested) return;
  const prefix = base + (needsJoinSpace(base, result.text) ? ' ' : '');
  const combined = prefix + result.text;
  featureState.revision = { ...result, base: prefix, combined };
  setTranscriptText(combined, { immediate: true });
  transcript.readOnly = false;
  renderRevision();
  try { await api.saveTranscript(result.text, provider, result); }
  catch (error) { element('reviewNotice').textContent = '记录保存失败，当前文字仍保留'; }
  if (live?.attempted) {
    const delivered = await api.finishLiveInput(live.session, result.text);
    const blocked = delivered.attempted ? delivered.blocked : true;
    featureState.pendingInsertion = { base: combined, targetHwnd, blocked };
    featureState.live = delivered;
    if (blocked && !delivered.written) {
      const fallback = await pasteRecognizedText(result.text, {
        saveHistory: false,
        targetHwnd,
        refreshHistory: false,
        successStatus: '已用兼容模式输入到当前聊天框'
      });
      if (fallback.ok) {
        featureState.pendingInsertion = { base: combined, targetHwnd, blocked: false };
        setStatus('实时写入不兼容，已改用最终输入');
        api.hudStatus('processing');
      } else {
        setStatus('实时输入已暂停，全文已保留，请复制后核对', 'error');
        api.hudStatus('blocked');
        element('reviewNotice').textContent = '目标输入框不支持实时写入，最终输入也可能被拦截';
      }
    } else {
      setStatus(blocked ? '实时输入已暂停，全文已保留，请复制后核对' : '已实时输入到当前聊天框', blocked ? 'error' : 'ready');
      api.hudStatus(blocked ? 'blocked' : 'processing');
      if (blocked) element('reviewNotice').textContent = '没有回删外部文字；请核对已输入部分';
    }
  } else if (isDirect) featureState.pendingInsertion = { base: prefix, targetHwnd };
  if (!live?.attempted && isDirect && currentSettings.directPasteAfterShortcut !== false && !result.needsReview) {
    const inserted = await pasteRecognizedText(result.text, { saveHistory: false, targetHwnd, successStatus: '已输入到当前聊天框' });
    if (inserted.ok) featureState.pendingInsertion = { base: combined, targetHwnd };
  } else if (!live?.attempted) {
    setStatus(result.mode === 'translate-en' ? result.notice ? '翻译未完成，原文已保留' : '翻译完成，请确认后输入' : result.notice ? '整理未完成，原文已保留' : result.needsReview ? '整理完成，请确认后输入' : '转写完成');
    if (result.needsReview) element('reviewNotice').textContent ||= '结果待确认';
    if (isDirect && result.needsReview) {
      await api.focusPreview();
      transcript.focus();
      transcript.setSelectionRange(transcript.value.length, transcript.value.length);
    }
  }
  await refreshHistory();
  await flushDraftSave();
}

async function processCurrentText() {
  if (isRecordingBusy() || !transcript.value.trim()) return;
  if (needsEditor() && !featureState.editorInstalled) {
    setStatus('AI 整理扩展未安装，当前可先使用原文', 'error');
    return;
  }
  const before = transcript.value;
  const pending = featureState.pendingInsertion;
  const base = pending && before.startsWith(pending.base) ? pending.base : '';
  const addition = before.slice(base.length).trim();
  if (!addition) { setStatus('这段已经输入，未产生新文字'); return; }
  try {
    const result = await requestTextProcessing(addition, effectiveExpressionMode());
    if (!result || transcript.value !== before) return;
    featureState.revision = { ...result, base, combined: base + result.text };
    setTranscriptText(base + result.text, { immediate: true });
    renderRevision();
    setStatus(result.mode === 'translate-en' ? result.notice ? '翻译未完成，原文已保留' : '翻译完成，请确认后输入' : result.notice ? '整理未完成，原文已保留' : '整理完成，请确认后输入');
    await api.saveTranscript(result.text, 'local-editor', result);
    await refreshHistory();
    await flushDraftSave();
  } catch (error) { setStatus('整理失败，原文已保留：' + error.message, 'error'); }
  finally { transcript.readOnly = false; updateFeatureControls(); }
}

async function cancelCurrentTask() {
  if (featureState.pasteBusy) return;
  featureState.cancelRequested = true;
  featureState.canceling = true;
  recordingToken += 1;
  await api.cancelLiveInput().catch(() => {});
  api.hudStatus('cancelled');
  const request = featureState.request;
  if (request) {
    request.cancelled = true;
    await api.cancelProcessing(request.id).catch(() => {});
  }
  if (recordingStartInFlight) {
    setStatus('正在取消启动');
    return;
  }
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  stopEverything();
  const streaming = activeStreaming;
  if (streaming) {
    await streaming.queue.catch(() => {});
    await api.cancelStreaming(streaming.id).catch(() => {});
  }
  activeStreaming = null;
  // A finishing request must settle before another session can use its resources.
  while (finalizingRecordingToken !== null || featureState.request) await new Promise((resolve) => setTimeout(resolve, 30));
  await api.recordingActivity(false);
  featureState.pendingInsertion = featureState.live?.attempted ? { base: transcript.value, blocked: true } : null;
  featureState.canceling = false;
  transcript.readOnly = false;
  setStatus('已取消，草稿已保留');
  updateFeatureControls();
  await flushDraftSave();
}

function restoreOriginal() {
  if (isRecordingBusy()) return;
  const revision = featureState.revision;
  if (!revision) return;
  if (transcript.value !== revision.combined) {
    setStatus('正文已手动修改，可在对照中查看原文');
    element('revisionDetails').open = true;
    return;
  }
  const value = revision.base + revision.original;
  if (featureState.pendingInsertion?.base === revision.combined) {
    // A prior external insertion is never silently undone or sent twice.
    featureState.pendingInsertion = { ...featureState.pendingInsertion, base: value };
  }
  setTranscriptText(value, { immediate: true });
  featureState.revision = null;
  renderRevision();
  setStatus('已恢复本次原文');
  scheduleDraftSave();
}

function renderHistory() {
  const query = element('historySearch').value.trim().toLocaleLowerCase();
  const history = featureState.history.filter((item) => !query || `${item.text}\n${item.original || ''}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  historyList.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = query ? '没有匹配记录' : '还没有语音记录';
    historyList.append(empty);
  }
  for (const item of history) {
    const row = document.createElement('article');
    row.className = 'history-item';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${formatDate(item.createdAt)} · ${item.expressionMode === 'translate-en' ? '中文 → 英文' : item.expressionMode === 'daily' ? '日常' : item.expressionMode === 'organized' ? '条理' : '原文'}`;
    const text = document.createElement('p');
    text.className = 'history-text';
    text.textContent = item.text;
    const actions = document.createElement('div');
    actions.className = 'history-actions';
    const pin = iconButton('pin', item.pinned ? '取消置顶' : '置顶', async () => { await api.historyAction(item.id, 'pin'); await refreshHistory(); });
    pin.classList.toggle('is-pinned', !!item.pinned);
    actions.append(pin, iconButton('copy', '复制记录', () => api.copyText(item.text)), iconButton('arrow-up-right', '调用记录', () => {
      if (isRecordingBusy()) return;
      if (transcript.value.trim() && !window.confirm('用这条记录替换当前草稿？')) return;
      featureState.pendingInsertion = null;
      featureState.revision = null;
      setTranscriptText(item.text, { immediate: true });
      renderRevision();
      setMode('expanded');
      setStatus('已调用历史记录');
    }), iconButton('trash-2', '删除记录', async () => {
      if (!window.confirm('删除这条语音记录？')) return;
      await api.historyAction(item.id, 'delete');
      await refreshHistory();
    }));
    row.append(meta, text);
    if (item.original && item.original !== item.text) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '原文';
      const original = document.createElement('p');
      original.textContent = item.original;
      details.className = 'history-original';
      details.append(summary, original);
      row.append(details);
    }
    row.append(actions);
    historyList.append(row);
  }
  refreshIcons();
}

async function refreshFeatureStatus() {
  const status = await api.featureStatus();
  featureState.editorInstalled = !!status.installed;
  renderAiExtensionSource(status);
  element('editorStatus').textContent = status.installed
    ? status.model + (status.running ? ' · 已加载' : ' · 按需加载')
    : 'AI 整理扩展未安装；轻量版可先用原文，安装扩展后启用日常/条理/中译英';
  element('resourceStatus').textContent = `${status.asrRunning ? '识别已加载' : '识别待唤醒'} · ${status.installed ? (status.running ? 'AI 已加载' : 'AI 按需加载') : 'AI 扩展可选'}`;
  updateFeatureControls();
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${value} B`;
}

function setAiExtensionStatus(text, type = 'ready') {
  const status = element('aiExtensionStatus');
  status.textContent = text || '';
  status.classList.toggle('error-text', type === 'error');
}

function renderAiExtensionSource(status) {
  const source = status.aiExtensionSource || featureState.aiExtensionSource || {};
  featureState.aiExtensionSource = source;
  const installed = !!status.installed;
  element('aiExtensionName').textContent = source.name || 'AI 整理扩展';
  element('aiExtensionSummary').textContent = source.summary || '安装后启用本地日常整理、条理整理、中文转英文。';
  element('aiExtensionVersion').textContent = source.version ? `版本 ${source.version}` : '版本随主包更新';
  element('aiExtensionSize').textContent = source.size ? `约 ${formatBytes(source.size)}` : '大小待获取';
  element('aiExtensionEngine').textContent = source.engine || '本地 CPU';
  element('aiExtensionBadge').textContent = installed ? '已安装' : '可选下载';
  element('downloadAiExtension').textContent = installed ? '重新下载扩展' : '下载 AI 扩展';
  const tags = element('aiExtensionFeatures');
  tags.replaceChildren();
  for (const feature of source.features || ['日常整理', '条理整理', '中文转英文']) {
    const tag = document.createElement('span');
    tag.textContent = feature;
    tags.append(tag);
  }
  if (!element('aiExtensionUrl').value.trim() && source.url) element('aiExtensionUrl').value = source.url;
}

async function runAiExtensionInstall(operation) {
  if (isRecordingBusy() || featureState.aiInstalling) return;
  featureState.aiInstalling = true;
  updateFeatureControls();
  setAiExtensionStatus('正在准备 AI 扩展...');
  try {
    const result = await operation();
    if (result?.cancelled) {
      setAiExtensionStatus('已取消选择');
      return;
    }
    setAiExtensionStatus('AI 扩展已安装，重启软件后可稳定使用');
    setStatus('AI 整理扩展已安装');
    await refreshFeatureStatus();
  } catch (error) {
    setAiExtensionStatus(`安装失败：${error.message || '未知错误'}`, 'error');
  } finally {
    featureState.aiInstalling = false;
    updateFeatureControls();
  }
}

async function initFeatures() {
  for (const key of featureKeys) element(key).addEventListener('change', syncSettingsPreview);
  for (const button of document.querySelectorAll('[data-expression]')) button.addEventListener('click', async () => {
    if (isRecordingBusy()) return;
    try { fillSettingsForm(await api.saveSettings({ expressionMode: button.dataset.expression })); }
    catch (error) { setStatus(error.message, 'error'); }
  });
  for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-selected', String(other === tab));
    for (const view of document.querySelectorAll('[data-settings-view]')) view.hidden = view.dataset.settingsView !== tab.dataset.view;
    document.querySelector('.settings-body').scrollTop = 0;
  });
  element('processTextButton').addEventListener('click', processCurrentText);
  element('cancelTaskButton').addEventListener('click', () => void cancelCurrentTask());
  element('restoreOriginalButton').addEventListener('click', (event) => { event.preventDefault(); restoreOriginal(); });
  element('historySearch').addEventListener('input', renderHistory);
  element('releaseModels').addEventListener('click', async () => {
    const result = await api.releaseModels();
    setSettingsStatus(result.ok ? '空闲模型已释放' : '正在处理任务，稍后再释放');
    await refreshFeatureStatus();
  });
  element('downloadAiExtension').addEventListener('click', () => {
    const manualUrl = element('aiExtensionUrl').value.trim();
    void runAiExtensionInstall(() => api.downloadAiExtension(manualUrl || featureState.aiExtensionSource?.url || ''));
  });
  element('installLocalAiExtension').addEventListener('click', () => {
    void runAiExtensionInstall(() => api.installLocalAiExtension());
  });
  element('cancelAiExtension').addEventListener('click', () => {
    void api.cancelAiExtension();
    setAiExtensionStatus('正在取消...');
  });
  api.onAiExtensionProgress((progress) => {
    if (progress.phase === 'download') {
      const total = Number(progress.total) || 0;
      const received = Number(progress.received) || 0;
      setAiExtensionStatus(total ? `正在下载 AI 扩展：${formatBytes(received)} / ${formatBytes(total)}` : `正在下载 AI 扩展：${formatBytes(received)}`);
    } else if (progress.phase === 'extract') {
      setAiExtensionStatus('正在解压 AI 扩展...');
    } else if (progress.phase === 'install') {
      setAiExtensionStatus('正在安装 AI 扩展...');
    } else if (progress.phase === 'done') {
      setAiExtensionStatus('AI 扩展已安装');
    }
  });
  transcript.addEventListener('input', () => { scheduleDraftSave(); updateFeatureControls(); });
  api.onSettingsUpdated((settings) => fillSettingsForm(settings));
  const draft = await api.getDraft();
  if (draft.text) {
    setTranscriptText(draft.text, { immediate: true });
    featureState.revision = draft.revision && typeof draft.revision.original === 'string' ? draft.revision : null;
    renderRevision();
    setStatus('已恢复未清除的草稿');
  }
  featureState.booted = true;
  await initPacks();
  await refreshFeatureStatus();
  setInterval(() => {
    if (appShell.classList.contains('settings')) void refreshFeatureStatus().catch(() => {});
  }, 15000);
  refreshIcons();
  updateFeatureControls();
}
