const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LocalStore, pruneHistory } = require('../src/local-store');
const { normalizeFeatures, formatText, formatNumbers, prepareDailyText, applyDictionary, inspectRewrite, inspectTranslation } = require('../src/text-tools');
const { withTemporaryClipboard } = require('../src/clipboard-guard');

test('complete simplified Chinese and optional formatting', () => {
  assert.equal(formatText('臺灣軟體與語音辨識', normalizeFeatures({ formatNumbers: false, formatPunctuation: false })), '台湾软体与语音辨识');
  assert.equal(formatText('你今晚有空吗', normalizeFeatures({})), '你今晚有空吗？');
  assert.equal(formatText('先别帮我订票', normalizeFeatures({})), '先别帮我订票。');
});

test('numbers: dates, times, amounts, percentages; ambiguous numbers unchanged', () => {
  assert.equal(formatNumbers('二〇二六年九月五日七点半，一百二十元，百分之二十五'), '2026年9月5日7:30，120元，25%');
  for (const text of ['十五六个', '一两天', '一百二元', '大概三四个月', '一会儿', '三百多元']) assert.equal(formatNumbers(text), text);
  assert.equal(formatNumbers('十二个苹果'), '12个苹果');
});

test('dictionary does not cascade, handles regex metacharacters and ASCII boundaries', () => {
  const rows = [{ from: 'foo', to: 'bar' }, { from: 'bar', to: 'baz' }, { from: 'c++', to: 'C++' }, { from: '奥比西安', to: 'Obsidian' }];
  assert.equal(applyDictionary('foo bar food C++ 奥比西安', rows), 'bar baz food C++ Obsidian');
  assert.equal(applyDictionary('foo', [{ from: 'foo', to: 'bar', enabled: false }]), 'foo');
  assert.equal(normalizeFeatures({ dictionary: rows }).dictionary, undefined);
  assert.equal(formatText('奥比西安', { dictionary: rows }), '奥比西安');
  assert.equal(formatText('奥比西安', {}, rows), 'Obsidian');
});

test('translation warnings check numbers and intent across languages without Chinese length heuristics', () => {
  assert.deepEqual(inspectTranslation('我可能去不了，先别帮我订票。', "I might not be able to go. Please don't book a ticket for me yet."), []);
  assert.deepEqual(inspectTranslation('预算1000元', 'The budget is 1,000 yuan.'), []);
  assert(inspectTranslation('不要订票，预算120元', 'Book the ticket. The budget is 200 yuan.').length >= 2);
  assert(inspectTranslation('我可能晚到', 'I will arrive late.').length);
});

test('rewrite warnings protect numeric and negative intent', () => {
  assert(inspectRewrite('不要买，预算100元', '买，预算200元').length >= 2);
  assert(inspectRewrite('我可能去不了', '我去不了').length);
  assert.deepEqual(inspectRewrite('你今晚有空吗', '你今晚有空吗？'), []);
  assert.deepEqual(inspectRewrite('比较价格速度', '1. 比较价格\n2. 比较速度'), []);
  assert.equal(prepareDailyText('那个你晚上有空吗我8点不对8:30下班'), '你晚上有空吗我8:30下班');
  assert.equal(prepareDailyText('那个电脑先别买，可能不合适'), '那个电脑先别买，可能不合适');
});

test('atomic serialized store prevents lost history and preserves drafts on restart', async () => {
  const directory = await fs.mkdtemp(path.join(__dirname, '..', 'tmp', 'features-store-'));
  const store = new LocalStore(directory);
  await Promise.all(Array.from({ length: 30 }, (_, id) => store.update('history.json', [], (items) => [...items, { id }])));
  assert.equal((await store.read('history.json', [])).length, 30);
  await store.write('draft.json', { text: '保留我的草稿', revision: null });
  assert.equal((await new LocalStore(directory).read('draft.json', {})).text, '保留我的草稿');
  await store.write('draft.json', { text: '', revision: null });
  assert.equal((await new LocalStore(directory).read('draft.json', {})).text, '');
  await fs.writeFile(path.join(directory, 'broken.json'), '{');
  await assert.rejects(store.write('broken.json', {}), /原文件已保留/);
  assert.equal(await fs.readFile(path.join(directory, 'broken.json'), 'utf8'), '{');
});

test('history retention preserves pins and is disabled by default', () => {
  const history = [{ id: 'old', createdAt: '2020-01-01' }, { id: 'pin', createdAt: '2020-01-01', pinned: true }, { id: 'new', createdAt: new Date().toISOString() }];
  assert.equal(pruneHistory(history, normalizeFeatures({})).length, 3);
  assert.deepEqual(pruneHistory(history, { historyRetentionDays: 7 }).map((item) => item.id), ['pin', 'new']);
});

function fakeClipboard(initial) {
  let data = { ...initial };
  return {
    availableFormats: () => Object.keys(data).map((key) => ({ text: 'text/plain', html: 'text/html', rtf: 'text/rtf', image: 'image/png', files: 'files' })[key]),
    readText: () => data.text || '', readHTML: () => data.html || '', readRTF: () => data.rtf || '', readImage: () => data.image,
    write: (next) => { data = { ...next }; }, clear: () => { data = {}; },
    value: () => data
  };
}

test('temporary clipboard restores rich content on success and error', async () => {
  const original = { text: '旧内容', html: '<b>旧内容</b>', rtf: 'rtf-content' };
  const clipboard = fakeClipboard(original);
  await withTemporaryClipboard(clipboard, '新内容', async () => { assert.equal(clipboard.readText(), '新内容'); }, async () => {});
  assert.deepEqual(clipboard.value(), original);
  await assert.rejects(withTemporaryClipboard(clipboard, '新内容', async () => { throw new Error('failed'); }, async () => {}));
  assert.deepEqual(clipboard.value(), original);
});

test('clipboard changes by user are never overwritten; unknown formats are left untouched', async () => {
  const clipboard = fakeClipboard({ text: '原来' });
  await withTemporaryClipboard(clipboard, '语音', async () => clipboard.write({ text: '用户刚复制的' }), async () => {});
  assert.equal(clipboard.readText(), '用户刚复制的');
  const fileClipboard = fakeClipboard({ files: 'file-list' });
  const result = await withTemporaryClipboard(fileClipboard, '语音', () => assert.fail('must not paste'), async () => {});
  assert.equal(result.unsupportedClipboard, true);
  assert.deepEqual(fileClipboard.value(), { files: 'file-list' });
});
