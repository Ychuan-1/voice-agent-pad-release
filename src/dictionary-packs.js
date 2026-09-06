const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { createGunzip } = require('node:zlib');
const { createHash } = require('node:crypto');
const { LocalStore } = require('./local-store');
const { simplify } = require('./text-tools');

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const termsHash = (terms) => hash(Buffer.from(JSON.stringify(terms ?? null)));
const cleanTerm = (value) => typeof value === 'string' && value.length >= 2 && value.length <= 80 && /^[\p{L}\p{N}][\p{L}\p{N} .+#:/_-]*$/u.test(value);
const MAX_SOURCE_BYTES = 24 * 1024 * 1024;

function parseWords(text) {
  return [...new Set(text.split(/\r?\n/).map((line) => line.replace(/\s+#.*$/, '').trim()).filter(cleanTerm))];
}

function parseRime(text, recipe) {
  const boundary = /^\.\.\.\s*$/m.exec(text);
  if (!boundary) throw new Error('中文词库缺少数据分隔符');
  const filter = recipe.filter ? new RegExp(recipe.filter, 'u') : null;
  const words = new Map();
  for (const line of text.slice(boundary.index + boundary[0].length).split(/\r?\n/)) {
    const [term, code, weight] = line.split('\t');
    if (!term || term.length > recipe.maxLength || !/^[\p{Script=Han}]{2,}$/u.test(term)) continue;
    if (!code || !/^[a-z ]+$/.test(code) || !/^\d+(?:\s+#.*)?$/.test(weight || '')) continue;
    if (filter && !filter.test(term)) continue;
    const frequency = Number.parseInt(weight, 10);
    words.set(term, Math.max(frequency, words.get(term) || 0));
  }
  return [...words].sort((a, b) => b[1] - a[1]).slice(0, recipe.limit).map(([term]) => simplify(term));
}

function buildTerms(recipe, texts) {
  if (recipe.format && recipe.format !== 'rime-tsv') throw new Error('不支持的词包格式');
  if (recipe.format === 'rime-tsv' && (!Number.isInteger(recipe.limit) || recipe.limit < 1 || recipe.limit > 18000
    || !Number.isInteger(recipe.maxLength) || recipe.maxLength < 2 || recipe.maxLength > 16)) throw new Error('中文词包筛选参数无效');
  const terms = new Map();
  const filter = recipe.filter ? new RegExp(recipe.filter, 'i') : null;
  for (const text of texts) for (const term of recipe.format === 'rime-tsv' ? parseRime(text, recipe) : parseWords(text)) {
    if (!filter || filter.test(term)) terms.set(term.toLowerCase(), { term, aliases: [] });
  }
  for (const row of recipe.additions || []) {
    if (!cleanTerm(row.term) || !Array.isArray(row.aliases) || row.aliases.some((alias) => !cleanTerm(alias))) throw new Error('词包包含无效词条');
    terms.set(row.term.toLowerCase(), { term: row.term, aliases: [...new Set(row.aliases)] });
  }
  if (!terms.size || terms.size > 20000) throw new Error('词包词条数量异常');
  return [...terms.values()];
}

function compileInWorker(pack, texts, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'dictionary-pack-worker.js'), { workerData: { pack, texts } });
    let settled = false;
    const finish = (error, terms) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(terms);
    };
    const abort = () => finish(signal.reason || new Error('词包安装已取消'));
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (result) => finish(result.error ? new Error(result.error) : null, result.terms));
    worker.once('error', (error) => finish(error));
    worker.once('exit', () => { if (!settled) finish(new Error('词包解析进程提前退出')); });
    if (signal.aborted) abort();
  });
}

function downloadBytes(url, signal, progress, maximum = MAX_SOURCE_BYTES) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(target.hostname) || target.username || target.password || target.port) {
      reject(new Error('不受信任的词包来源')); return;
    }
    let response;
    const request = https.get(target, { family: 4, signal, headers: { 'User-Agent': 'VoiceAgentPad-Dictionary/1', 'Accept-Encoding': 'gzip' } }, (incoming) => {
      response = incoming;
      if (incoming.statusCode !== 200) { incoming.resume(); reject(new Error('词包源返回 HTTP ' + incoming.statusCode)); return; }
      incoming.on('error', reject);
      const encoding = incoming.headers['content-encoding'];
      if (Number(incoming.headers['content-length']) > maximum + (encoding === 'gzip' ? 65536 : 0)) { incoming.destroy(new Error('下载文件超出大小限制')); return; }
      if (encoding && encoding !== 'gzip' && encoding !== 'identity') { incoming.resume(); reject(new Error('不支持的词包压缩格式')); return; }
      const body = encoding === 'gzip' ? incoming.pipe(createGunzip()) : incoming;
      if (body !== incoming) {
        body.on('error', (error) => { incoming.destroy(); reject(error); });
        incoming.on('error', (error) => body.destroy(error));
        incoming.on('aborted', () => body.destroy(new Error('词包下载中断')));
      }
      const chunks = [];
      let received = 0;
      body.on('data', (chunk) => {
        received += chunk.length;
        if (received > maximum) { body.destroy(new Error('下载文件超出大小限制')); incoming.destroy(); return; }
        chunks.push(chunk); progress?.(received);
      });
      body.on('end', () => resolve(Buffer.concat(chunks)));
    });
    const timer = setTimeout(() => { request.destroy(new Error('词包源连接超时')); response?.destroy(); }, maximum > 2 * 1024 * 1024 ? 120000 : 18000);
    request.setTimeout(15000, () => request.destroy(new Error('词包源长时间无响应')));
    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
  });
}

async function fetchSource(source, signal, progress, downloader = downloadBytes) {
  let lastError;
  const urls = source.bytes > 2 * 1024 * 1024 ? [...source.urls].reverse() : source.urls;
  for (const url of urls) {
    signal?.throwIfAborted();
    try {
      const bytes = await downloader(url, signal, progress, Math.min(MAX_SOURCE_BYTES, source.bytes + 1));
      signal?.throwIfAborted();
      if (bytes.length !== source.bytes || hash(bytes) !== source.sha256) throw new Error('词包校验失败，文件未安装');
      return bytes;
    } catch (error) { lastError = error; }
  }
  signal?.throwIfAborted();
  throw lastError || new Error('词包下载失败');
}

class DictionaryPacks {
  constructor(directory, catalog, { downloader = downloadBytes, onChange = () => {} } = {}) {
    this.store = new LocalStore(directory);
    this.catalog = catalog;
    this.downloader = downloader;
    this.onChange = onChange;
    this.job = null;
    this.errors = new Map();
    this.cached = null;
    this.index = null;
  }

  find(id) {
    const pack = this.catalog.packs.find((item) => item.id === id);
    if (!pack) throw new Error('找不到这个词包');
    return pack;
  }

  async state() {
    const data = await this.store.read('dictionary-packs.json', { installed: {} });
    if (!data || typeof data.installed !== 'object' || Array.isArray(data.installed) || !data.installed) throw new Error('词包记录损坏，请先保留文件再恢复');
    return data;
  }

  async list() {
    const data = await this.state();
    return { busy: !!this.job, packs: this.catalog.packs.map((pack) => {
      const saved = data.installed[pack.id];
      const valid = saved && termsHash(saved.terms) === pack.termsSha256 && saved.version === pack.version;
      return {
        id: pack.id, name: pack.name, category: pack.category, icon: pack.icon, summary: pack.summary,
        version: pack.version, reviewedAt: pack.reviewedAt, upstreamDate: pack.upstreamDate,
        termCount: pack.termCount, curatedCount: pack.additions.length, bytes: pack.bytes, samples: pack.additions.map((row) => row.term),
        sourceCache: !!pack.sourceCache,
        sourceUrl: pack.sourceUrl, references: pack.references, license: pack.license,
        installed: !!saved, enabled: !!valid && saved.enabled === true, needsUpdate: !!saved && saved.version !== pack.version,
        damaged: !!saved && saved.version === pack.version && !valid,
        installedBytes: saved ? Buffer.byteLength(JSON.stringify(saved), 'utf8') : 0,
        downloading: this.job?.id === pack.id, progress: this.job?.id === pack.id ? this.job.progress : 0,
        error: this.errors.get(pack.id) || ''
      };
    }) };
  }

  async preview(id) {
    const pack = this.find(id);
    const item = (await this.state()).installed[id];
    if (item && item.version === pack.version && termsHash(item.terms) === pack.termsSha256) return { complete: true, terms: item.terms };
    return { complete: false, terms: pack.additions };
  }

  cachePath(source) {
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('无效词包校验码');
    return path.join(this.store.directory, 'dictionary-sources', source.sha256 + '.txt');
  }

  async sourceBytes(pack, source, signal, progress) {
    if (!pack.sourceCache) return fetchSource(source, signal, progress, this.downloader);
    const file = this.cachePath(source);
    try {
      if ((await fs.stat(file)).size === source.bytes) {
        const cached = await fs.readFile(file);
        signal.throwIfAborted();
        if (hash(cached) === source.sha256) { progress(cached.length); return cached; }
      }
    } catch (error) { if (error.name === 'AbortError') throw error; }
    const bytes = await fetchSource(source, signal, progress, this.downloader);
    signal.throwIfAborted();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, bytes); signal.throwIfAborted(); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    return bytes;
  }

  async pruneSources() {
    const data = await this.state();
    const retained = new Set(this.catalog.packs.filter((pack) => data.installed[pack.id]).flatMap((pack) => pack.sources.map((source) => source.sha256)));
    for (const source of this.catalog.packs.filter((pack) => pack.sourceCache).flatMap((pack) => pack.sources)) {
      if (!retained.has(source.sha256)) await fs.rm(this.cachePath(source), { force: true });
    }
  }

  async install(id) {
    const pack = this.find(id);
    if (this.job) throw new Error('另一个词包正在下载，请等待或取消');
    const controller = new AbortController();
    const job = { id, controller, progress: 0, committing: false };
    this.job = job; this.errors.delete(id); this.onChange();
    try {
      const texts = [];
      const licenses = [];
      let completed = 0;
      for (const source of pack.sources) {
        const bytes = await this.sourceBytes(pack, source, controller.signal, (received) => {
          job.progress = Math.min(99, Math.floor((completed + Math.min(received, source.bytes)) / pack.bytes * 100));
          this.onChange();
        });
        completed += bytes.length;
        if (source.kind === 'license') licenses.push({ path: source.path, text: bytes.toString('utf8') });
        else {
          const text = bytes.toString('utf8'); texts.push(text);
          if (pack.format === 'rime-tsv') licenses.push({ path: source.path + '#source-credits', text: text.split(/^\.\.\.\s*$/m)[0] });
        }
      }
      const terms = pack.format === 'rime-tsv' ? await compileInWorker(pack, texts, controller.signal) : buildTerms(pack, texts);
      if (hash(Buffer.from(JSON.stringify(terms))) !== pack.termsSha256) throw new Error('词包适配结果校验失败');
      controller.signal.throwIfAborted();
      job.committing = true;
      await this.store.update('dictionary-packs.json', { installed: {} }, (data) => {
        if (!data?.installed || typeof data.installed !== 'object' || Array.isArray(data.installed)) throw new Error('词包记录损坏，已保留原文件');
        const previous = data.installed[id];
        const saved = { version: pack.version, enabled: previous?.enabled === true, terms, licenses, installedAt: new Date().toISOString() };
        return { installed: { ...data.installed, [id]: saved } };
      });
      this.cached = null;
      this.index = null;
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) return { cancelled: true };
      this.errors.set(id, error.message || '词包下载失败');
      throw error;
    } finally { await this.pruneSources().catch(() => {}); this.job = null; this.onChange(); }
  }

  cancel(id) {
    if (this.job?.id !== id || this.job.committing) return { cancelled: false };
    this.job.controller.abort();
    return { cancelled: true };
  }

  async change(id, action, enabled) {
    const pack = this.find(id);
    if (this.job?.id === id) throw new Error('请先等待下载完成或取消');
    await this.store.update('dictionary-packs.json', { installed: {} }, (data) => {
      if (!data?.installed || typeof data.installed !== 'object' || Array.isArray(data.installed)) throw new Error('词包记录损坏');
      const installed = { ...data.installed };
      if (action === 'remove') delete installed[id];
      else if (action === 'enable') {
        const item = installed[id];
        if (!item || item.version !== pack.version || termsHash(item.terms) !== pack.termsSha256) throw new Error('请先下载或修复词包');
        installed[id] = { ...item, enabled: enabled === true };
      } else throw new Error('不支持的词包操作');
      return { installed };
    });
    this.cached = null; this.index = null; this.errors.delete(id); this.onChange();
    if (action === 'remove' && !this.job) await this.pruneSources();
    return { ok: true };
  }

  async active() {
    if (this.cached) return this.cached;
    const data = await this.state();
    const rows = [];
    for (const pack of this.catalog.packs) {
      const item = data.installed[pack.id];
      if (!item?.enabled || item.version !== pack.version) continue;
      if (termsHash(item.terms) !== pack.termsSha256) throw new Error('已启用词包损坏，请重新下载：' + pack.name);
      rows.push(...item.terms);
    }
    this.cached = rows;
    return rows;
  }

  async context(text) {
    const rows = await this.active();
    // Cache a two-character prefix index. Per-utterance work follows the input,
    // rather than creating a regex for every installed everyday word.
    if (this.index?.rows !== rows) {
      const prefixes = new Map();
      const aliases = [];
      for (const row of rows) {
        for (const word of [row.term, ...(row.aliases || [])]) {
          const key = simplify(word).toLowerCase();
          const prefix = key.slice(0, 2);
          if (!prefixes.has(prefix)) prefixes.set(prefix, { lengths: new Set(), words: new Map() });
          const bucket = prefixes.get(prefix);
          bucket.lengths.add(key.length);
          if (!bucket.words.has(key)) bucket.words.set(key, []);
          bucket.words.get(key).push(row);
        }
        for (const alias of row.aliases || []) aliases.push({ from: simplify(alias), to: row.term });
      }
      this.index = { rows, prefixes, aliases };
    }
    const replacements = new Map();
    const conflicts = new Set();
    const lower = simplify(text).toLowerCase();
    const terms = new Set();
    for (const rule of this.index.aliases) {
        const key = rule.from.toLowerCase();
        if (replacements.has(key) && replacements.get(key).to !== rule.to) conflicts.add(key);
        else replacements.set(key, { ...rule, enabled: true });
    }
    const candidates = new Set();
    for (let i = 0; i < lower.length - 1; i++) {
      if (i > 0 && /[a-z0-9_]/.test(lower[i - 1])) continue;
      const bucket = this.index.prefixes.get(lower.slice(i, i + 2));
      if (!bucket) continue;
      for (const length of bucket.lengths) {
        if (i + length > lower.length || /[a-z0-9_]/.test(lower[i + length] || '')) continue;
        for (const row of bucket.words.get(lower.slice(i, i + length)) || []) candidates.add(row);
      }
    }
    for (const row of [...candidates].sort((a, b) => Number(b.aliases.length > 0) - Number(a.aliases.length > 0) || b.term.length - a.term.length)) {
      terms.add(row.term);
      if (terms.size === 24) break;
    }
    return { dictionary: [...replacements].filter(([key]) => !conflicts.has(key)).map(([, value]) => value), terms: [...terms] };
  }
}

module.exports = { DictionaryPacks, parseWords, parseRime, buildTerms, downloadBytes, fetchSource, hash };
