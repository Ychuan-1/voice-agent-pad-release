const labels = { recording: '正在输入', processing: '正在处理', translating: '正在翻译', review: '结果待确认', blocked: '实时输入已暂停', done: '输入完成', cancelled: '录音已取消' };
window.voiceHud.onState((state) => {
  document.getElementById('indicator').dataset.status = state.status;
  document.getElementById('label').textContent = labels[state.status] || '正在输入';
  const seconds = Math.max(0, Math.floor(Number(state.seconds) || 0));
  document.getElementById('duration').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const level = Math.max(0, Math.min(1, Number(state.level) || 0));
  document.querySelectorAll('#wave span').forEach((bar, index) => { bar.style.transform = `scaleY(${0.15 + Math.min(0.85, level * [0.9, 1.3, 1.8, 1.2, 0.8][index])})`; });
});
