const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DictionaryPacks, parseWords, parseRime, buildTerms, fetchSource, downloadBytes, hash } = require('../src/dictionary-packs');
const { applyDictionary } = require('../src/text-tools');
const catalog = require('../resources/dictionary-catalog.json');
const root = path.resolve(__dirname, '..');
const fixtureDirectory = path.join(root, 'tmp', 'dictionary-source-fixtures');

function fixtureDownload(url, signal, progress) {
  signal?.throwIfAborted();
  const source = catalog.packs.flatMap((pack) => pack.sources).find((source) => source.urls.includes(url));
  if (!source) throw new Error('Unknown fixture');
  return fs.readFile(path.join(fixtureDirectory, source.sha256 + '.txt')).then((bytes) => { progress?.(bytes.length); return bytes; });
}

async function manager() {
  const directory = await fs.mkdtemp(path.join(root, 'tmp', 'pack-test-'));
  return new DictionaryPacks(directory, catalog, { downloader: fixtureDownload });
}

test('all sixteen catalog packs have verified content, license, unique identifiers and curated terms', async () => {
  assert.equal(catalog.packs.length, 16);
  assert.equal(new Set(catalog.packs.map((pack) => pack.id)).size, 16);
  assert.equal(catalog.packs.filter((pack) => pack.category === '日常').length, 9);
  for (const pack of catalog.packs) {
    const texts = [];
    assert.match(pack.upstreamDate, pack.format === 'rime-tsv' ? /^2026-08-31/ : /^2026-09-04/);
    for (const source of pack.sources) {
      const bytes = await fixtureDownload(source.urls[0]);
      assert.equal(bytes.length, source.bytes);
      assert.equal(hash(bytes), source.sha256);
      if (source.kind === 'words') texts.push(bytes.toString('utf8'));
      else assert.match(bytes.toString('utf8'), pack.format === 'rime-tsv' ? /GNU GENERAL PUBLIC LICENSE/ : /MIT License/);
    }
    const terms = buildTerms(pack, texts);
    assert.equal(terms.length, pack.termCount);
    assert.equal(hash(Buffer.from(JSON.stringify(terms))), pack.termsSha256);
    assert(terms.length >= pack.additions.length);
  }
});

test('Rime parser reads only TSV data, ranks frequency, filters domains and simplifies Chinese', () => {
  const text = '# ignored\nname: unsafe\n...\n聊天\tliao tian\t20\n聊天\tliao tian\t30\n工作\tgong zuo\t50\n學習\txue xi\t40\n<script>\tcode\t100\n错误\twrong\tNaN\n单\tdan\t90\n';
  assert.deepEqual(parseRime(text, { limit: 2, maxLength: 8 }), ['工作', '学习']);
  assert.deepEqual(parseRime(text, { limit: 8, maxLength: 8, filter: '聊天' }), ['聊天']);
  assert.throws(() => parseRime('聊天\tliao tian\t20', { limit: 10, maxLength: 8 }), /分隔符/);
  assert.throws(() => buildTerms({ format: 'rime-tsv', limit: 999999, maxLength: 8 }, [text]), /参数/);
});

test('daily packs share verified downloads across restarts and discard corrupt cache', async () => {
  const packs = await manager();
  let calls = 0;
  packs.downloader = (...args) => { calls++; return fixtureDownload(...args); };
  await packs.install('daily-core');
  assert.equal(calls, 2);
  const restarted = new DictionaryPacks(packs.store.directory, catalog, { downloader: () => { throw new Error('offline'); } });
  await restarted.install('daily-food');
  assert((await restarted.preview('daily-food')).terms.some((row) => row.term === '少油少盐'));
  const source = catalog.packs.find((pack) => pack.id === 'daily-core').sources[0];
  const corrupted = await fs.readFile(packs.cachePath(source));
  corrupted[corrupted.length - 1] ^= 1;
  await fs.writeFile(packs.cachePath(source), corrupted);
  restarted.downloader = (...args) => { calls++; return fixtureDownload(...args); };
  await restarted.install('daily-chat');
  assert.equal(calls, 3);
  const saved = (await restarted.state()).installed['daily-chat'];
  assert(saved.licenses.some((row) => row.text.includes('词库组成')));
  await restarted.change('daily-core', 'remove');
  assert.equal((await fs.stat(packs.cachePath(source))).size, source.bytes);
  await restarted.change('daily-food', 'remove');
  await restarted.change('daily-chat', 'remove');
  await assert.rejects(fs.stat(packs.cachePath(source)), { code: 'ENOENT' });
});

test('cancelling a daily download removes an unreferenced verified source cache', async () => {
  const packs = await manager();
  let reachedLicense;
  const waiting = new Promise((resolve) => { reachedLicense = resolve; });
  packs.downloader = (url, signal, progress) => {
    if (!url.endsWith('/LICENSE')) return fixtureDownload(url, signal, progress);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      reachedLicense();
    });
  };
  const running = packs.install('daily-core');
  await waiting;
  const source = catalog.packs.find((pack) => pack.id === 'daily-core').sources[0];
  assert.equal((await fs.stat(packs.cachePath(source))).size, source.bytes);
  packs.cancel('daily-core');
  assert.deepEqual(await running, { cancelled: true });
  assert.deepEqual((await packs.state()).installed, {});
  await assert.rejects(fs.stat(packs.cachePath(source)), { code: 'ENOENT' });
});

test('daily words do not create homophone substitutions; indexed matching stays bounded', async () => {
  const packs = await manager();
  for (const id of ['daily-core', 'daily-chat', 'daily-food', 'daily-emotions', 'ai-models']) {
    await packs.install(id); await packs.change(id, 'enable', true);
  }
  const input = '我不是在怪你，外卖少油少盐，不要香菜，工作晚点再聊。请打开chat gpt。';
  const cold = performance.now();
  let context = await packs.context(input);
  const coldMs = performance.now() - cold;
  assert(context.terms.includes('我不是在怪你'));
  assert(context.terms.includes('少油少盐'));
  assert(context.terms.includes('ChatGPT'));
  assert(!context.dictionary.some((row) => /在见|再见|香菜|怪你/.test(row.from)));
  assert.equal(applyDictionary('在见，不是再见；不要香菜，先别下单。', context.dictionary), '在见，不是再见；不要香菜，先别下单。');
  context = await packs.context('xchat gptx');
  assert(!context.terms.includes('ChatGPT'));
  const start = performance.now();
  for (let i = 0; i < 100; i++) context = await packs.context(input);
  const warmMs = (performance.now() - start) / 100;
  console.log(JSON.stringify({ indexedTerms: (await packs.active()).length, coldMs, warmMs }));
  assert(warmMs < 100, 'Short-input vocabulary lookup should not scan the full dictionary');
  assert(context.terms.length <= 24);
  context = await packs.context('我不是在怪你', [{ from: '怪你', to: '其他', enabled: false }]);
  assert(context.terms.includes('我不是在怪你'));
});

test('word parser discards comments, directives, script markup and invalid syntax', () => {
  assert.deepEqual(parseWords('# ignored\n// ignored\n!unsafe\n+affix\nhello*\n<script>\nNode.js # comment\nC#\nMCP\nMCP\n'), ['Node.js', 'C#', 'MCP']);
  assert.throws(() => buildTerms({ additions: [{ term: '<script>', aliases: [] }] }, []), /无效/);
});

test('pack lifecycle preserves unrelated settings and ignores obsolete personal rules', async () => {
  const packs = await manager();
  const personal = [{ from: '奥比西安', to: '我的笔记', enabled: true }];
  await fs.writeFile(path.join(packs.store.directory, 'settings.json'), JSON.stringify({ dictionary: personal }));
  assert((await packs.list()).packs.every((pack) => !pack.installed));
  assert.equal((await packs.preview('productivity')).complete, false);
  await packs.install('productivity');
  assert.equal((await packs.list()).packs.find((pack) => pack.id === 'productivity').enabled, false);
  assert.equal((await packs.context('奥比西安')).dictionary.length, 0);
  await packs.change('productivity', 'enable', true);
  let context = await packs.context('打开奥比西安');
  assert.equal(applyDictionary('打开奥比西安', context.dictionary), '打开Obsidian');
  assert(context.terms.includes('Obsidian'));
  context = await packs.context('打开奥比西安', personal);
  assert.equal(applyDictionary('打开奥比西安', context.dictionary), '打开Obsidian');
  assert(context.terms.includes('Obsidian'));
  context = await packs.context('打开奥比西安', [{ from: '奥比', to: '自定义', enabled: true }]);
  assert.equal(applyDictionary('打开奥比西安', context.dictionary), '打开Obsidian');
  const restarted = new DictionaryPacks(packs.store.directory, catalog);
  assert((await restarted.context('奥比西安')).dictionary.some((row) => row.to === 'Obsidian'));
  assert.equal((await restarted.preview('productivity')).complete, true);
  await restarted.change('productivity', 'enable', false);
  assert.equal((await restarted.context('奥比西安')).dictionary.length, 0);
  await restarted.change('productivity', 'remove');
  assert.equal((await restarted.list()).packs.find((pack) => pack.id === 'productivity').installed, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(packs.store.directory, 'settings.json'))).dictionary, personal);
});

test('failed reinstall preserves old enabled pack; damaged data is not enabled', async () => {
  const packs = await manager();
  await packs.install('ai-models');
  await packs.change('ai-models', 'enable', true);
  const before = await packs.state();
  packs.downloader = async () => Buffer.from('bad');
  await assert.rejects(packs.install('ai-models'), /校验失败/);
  assert.deepEqual(await packs.state(), before);
  assert((await packs.list()).packs.find((pack) => pack.id === 'ai-models').enabled);
  const broken = await packs.state(); broken.installed['ai-models'].terms = [];
  await packs.store.write('dictionary-packs.json', broken);
  const restarted = new DictionaryPacks(packs.store.directory, catalog);
  assert((await restarted.list()).packs.find((pack) => pack.id === 'ai-models').damaged);
  await assert.rejects(restarted.change('ai-models', 'enable', true), /修复/);
  await assert.rejects(restarted.context('MCP'), /损坏/);
});

test('cancel and concurrent install protection leave no partial package', async () => {
  const packs = await manager();
  packs.downloader = (_url, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  const running = packs.install('image-video');
  await assert.rejects(packs.install('ai-models'), /正在下载/);
  assert.equal(packs.cancel('image-video').cancelled, true);
  assert.deepEqual(await running, { cancelled: true });
  assert.equal(packs.job, null);
  assert.deepEqual((await packs.state()).installed, {});
});

test('mirror fallback verifies bytes; no arbitrary URL or pack id is accepted', async () => {
  const source = catalog.packs[0].sources[0];
  let attempts = 0;
  const bytes = await fetchSource(source, new AbortController().signal, null, async (url) => {
    if (++attempts === 1) throw new Error('offline primary');
    return fixtureDownload(url);
  });
  assert.equal(attempts, 2);
  assert.equal(hash(bytes), source.sha256);
  await assert.rejects(downloadBytes('http://localhost/private'), /不受信任/);
  await assert.rejects(downloadBytes('https://example.com/pack'), /不受信任/);
  const packs = await manager();
  await assert.rejects(packs.install('../settings'), /找不到/);
});

test('corrupt store remains intact; streaming transcript is not fuzzy-replaced by a word list', async () => {
  const packs = await manager();
  await packs.install('image-video'); await packs.change('image-video', 'enable', true);
  const context = await packs.context('请打开comfy ui，这句话没有提到别的工具');
  assert.equal(applyDictionary('请打开comfy ui', context.dictionary), '请打开ComfyUI');
  assert.equal(applyDictionary('请打开confusing', context.dictionary), '请打开confusing');
  const file = path.join(packs.store.directory, 'dictionary-packs.json');
  await fs.writeFile(file, '{broken');
  await assert.rejects(packs.install('ai-models'), /无法读取/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('all packages can be independently installed, enabled and used without the network', async () => {
  const packs = await manager();
  for (const pack of catalog.packs) { await packs.install(pack.id); await packs.change(pack.id, 'enable', true); }
  const offline = new DictionaryPacks(packs.store.directory, catalog, { downloader: () => { throw new Error('network disabled'); } });
  const context = await offline.context('comfy ui fun asr type script code x docker compose');
  const result = applyDictionary('comfy ui fun asr type script code x docker compose', context.dictionary);
  assert.equal(result, 'ComfyUI FunASR TypeScript Codex docker compose');
  assert((await offline.list()).packs.every((pack) => pack.enabled));
});
