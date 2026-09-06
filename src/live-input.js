const { spawn } = require('node:child_process');
const path = require('node:path');

const cleanLiveText = (text) => String(text || '').replace(/[\x00-\x1f\x7f]/g, ' ');
const commonPrefix = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); };
function triggerKey(accelerator) {
  const key = String(accelerator || '').split('+').at(-1).toUpperCase();
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return 111 + Number(key.slice(1));
  if (/^[A-Z0-9]$/.test(key)) return key.charCodeAt(0);
  return { SPACE: 32, ENTER: 13, RETURN: 13, TAB: 9, ESC: 27, ESCAPE: 27 }[key] || 0;
}

class NativeLiveInput {
  constructor(root) { this.root = root; this.child = null; this.ready = null; this.pending = new Map(); this.nextId = 0; }
  ensureReady() {
    if (this.ready) return this.ready;
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(this.root, 'scripts', 'live_input.ps1')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.ready = new Promise((resolve, reject) => {
      this.rejectReady = reject;
      const timeout = setTimeout(() => this.stop(new Error('实时输入服务启动超时')), 15000);
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        if (this.child !== child) return;
        buffer += data;
        if (buffer.length > 1000000) return this.stop(new Error('实时输入服务消息过大'));
        let i;
        while ((i = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
          let message; try { message = JSON.parse(line); } catch { continue; }
          if (message.event === 'ready') { clearTimeout(timeout); this.rejectReady = null; resolve(); }
          else if (message.event === 'error') { clearTimeout(timeout); this.stop(new Error(message.error)); }
          else {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            clearTimeout(pending.timeout); this.pending.delete(message.id);
            message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
          }
        }
      });
      child.stderr.on('data', () => {});
      const failed = () => { clearTimeout(timeout); if (this.child === child) this.stop(new Error('实时输入服务已退出')); };
      child.on('exit', failed); child.on('error', failed); child.stdin.on('error', failed);
    });
    return this.ready;
  }
  async request(op, data = {}) {
    await this.ensureReady();
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.stop(new Error('实时输入服务未响应，已停止写入')), 4000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ id, op, ...data }) + '\n', (error) => { if (error) this.stop(error); });
    });
  }
  stop(error = new Error('实时输入已停止')) {
    const child = this.child; this.child = null; this.ready = null;
    this.rejectReady?.(error); this.rejectReady = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); }
    this.pending.clear(); child?.stdin.destroy(); child?.kill();
  }
}

class LiveInputSession {
  constructor(native, onChange = () => {}) { this.native = native; this.onChange = onChange; this.state = null; this.queue = Promise.resolve(); }
  snapshot() { const s = this.state; return s ? { session: s.id, targetHwnd: s.hwnd, foregroundHwnd: s.foreground, attempted: true, active: s.active, written: s.written, blocked: s.blocked, reason: s.reason } : { attempted: false, written: '' }; }
  async start(id, hwnd, hotkey, excludedProcess = 0, compatible = true) {
    if (this.state) await this.end();
    const s = { id, active: false, written: '', previous: '', stable: '', blocked: false, reason: '' };
    this.state = s;
    try {
      const result = await this.native.request('arm', { hwnd, hotkey: triggerKey(hotkey), excludedProcess, compatible: !!compatible });
      s.hwnd = result.hwnd || hwnd;
      s.foreground = result.foregroundHwnd;
      s.active = result.ok; s.blocked = !result.ok; s.reason = result.reason;
    } catch (error) { s.blocked = true; s.reason = error.message; }
    if (this.state === s) {
      this.timer = setInterval(() => void this.flush(s), 250);
      this.onChange(this.snapshot());
    }
    return this.snapshot();
  }
  update(id, text) {
    const s = this.state;
    if (!s || s.id !== id || !s.active) return;
    const next = cleanLiveText(text);
    s.stable = commonPrefix(s.previous, next);
    s.previous = next;
    if (!next.startsWith(s.written)) { s.active = false; s.blocked = true; s.reason = 'recognition-revised'; this.onChange(this.snapshot()); }
  }
  flush(s) {
    if (s.flushing) return this.queue;
    s.flushing = true;
    const run = this.queue.then(async () => {
      if (this.state !== s || !s.active) return;
      if (!s.stable.startsWith(s.written)) return;
      const addition = s.stable.slice(s.written.length, s.written.length + 64);
      if (!addition) return;
      try {
        const result = await this.native.request('append', { text: addition });
        if (this.state !== s) return;
        s.written += result.written || '';
        if (!result.ok && !result.retry) { s.active = false; s.blocked = true; s.reason = result.reason || 'input-blocked'; }
      } catch (error) { s.active = false; s.blocked = true; s.reason = error.message; }
      this.onChange(this.snapshot());
    }).finally(() => { s.flushing = false; });
    this.queue = run.catch(() => {});
    return this.queue;
  }
  async finish(id, text) {
    const s = this.state;
    if (!s || s.id !== id) return { attempted: false, written: '' };
    clearInterval(this.timer);
    await this.queue;
    const final = cleanLiveText(text);
    if (!final.startsWith(s.written)) { s.active = false; s.blocked = true; s.reason = 'recognition-revised'; }
    s.stable = final;
    const deadline = Date.now() + 2500;
    while (s.active && s.written !== final && Date.now() < deadline) {
      const before = s.written;
      await this.flush(s);
      if (before === s.written) await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (s.active && s.written !== final) { s.blocked = true; s.reason = 'input-incomplete'; }
    s.active = false;
    const result = this.snapshot();
    await this.end();
    return result;
  }
  async end() {
    clearInterval(this.timer);
    if (this.state) this.state.active = false;
    await this.queue;
    if (this.state) await this.native.request('end').catch(() => {});
    this.state = null;
  }
  stop() { clearInterval(this.timer); if (this.state) this.state.active = false; this.state = null; this.native.stop(); }
}

module.exports = { NativeLiveInput, LiveInputSession, cleanLiveText, commonPrefix, triggerKey };
