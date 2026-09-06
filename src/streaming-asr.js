const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');

class StreamingAsrClient extends EventEmitter {
  constructor({ root, python }) {
    super();
    this.root = root;
    this.python = python;
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.nextId = 0;
  }

  ensureReady() {
    if (this.ready) return this.ready;
    const child = spawn(this.python, [
      '-B', '-u', path.join(this.root, 'scripts', 'streaming_asr_worker.py'),
      '--model-dir', path.join(this.root, 'models', 'paraformer-streaming-zh-en'),
      '--threads', '2'
    ], {
      cwd: this.root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1' }
    });
    this.child = child;
    let buffer = '';
    let stderr = '';
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.stop(new Error('本地流式模型加载超时，请重新启动识别。')), 45000);
      this.rejectReady = (error) => { clearTimeout(timeout); reject(error); };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
      child.stdout.on('data', (chunk) => {
        if (this.child !== child) return;
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.event === 'ready') {
            clearTimeout(timeout);
            this.rejectReady = null;
            resolve(message);
          } else if (message.event === 'startup-error') {
            this.stop(new Error(`本地流式模型加载失败：${message.error}`));
          } else if (message.event === 'partial') {
            this.emit('partial', message);
          } else {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            if (message.ok) pending.resolve(message);
            else pending.reject(new Error(message.error || '本地流式识别失败'));
          }
        }
      });
      const failed = (error) => {
        if (this.child === child) this.stop(error);
      };
      child.stdin.on('error', failed);
      child.on('error', failed);
      child.on('exit', (code) => failed(new Error(`本地流式引擎已退出 (${code})：${stderr.slice(-600)}`)));
    });
    return this.ready;
  }

  async request(op, payload = {}) {
    await this.ensureReady();
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.stop(new Error('本地流式识别未响应，已保留当前文字，请重新录音。')), 15000);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`, (error) => {
          if (error) this.stop(error);
        });
      } catch (error) {
        this.stop(error);
      }
    });
  }

  stop(error = new Error('本地流式识别已停止')) {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.rejectReady?.(error);
    this.rejectReady = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    child?.stdin.destroy();
    child?.kill();
    if (child) this.emit('failure', error);
  }
}

module.exports = { StreamingAsrClient };
