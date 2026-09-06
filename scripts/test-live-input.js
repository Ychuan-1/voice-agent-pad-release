const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveInputSession, triggerKey, cleanLiveText } = require('../src/live-input');

function fixture(responses = []) {
  const calls = [];
  const native = { request: async (op, data) => {
    calls.push({ op, ...data });
    return op === 'arm' ? { ok: true, hwnd: 12 } : op === 'append' ? responses.shift() || { ok: true, written: data.text } : { ok: true };
  }, stop() {} };
  return { live: new LiveInputSession(native), calls };
}

test('stable prefixes append once, finish adds only the tail, no delete or paste operations', async () => {
  const { live, calls } = fixture();
  await live.start('a', 12, 'F8');
  live.update('old', '不应输入');
  live.update('a', '测试');
  await live.flush(live.state);
  assert.equal(live.snapshot().written, '');
  live.update('a', '测试实时输入');
  await live.flush(live.state);
  assert.equal(live.snapshot().written, '测试');
  const done = await live.finish('a', '测试实时输入。');
  assert.equal(done.written, '测试实时输入。');
  assert.equal(done.blocked, false);
  assert.equal(calls.filter((c) => c.op === 'append').map((c) => c.text).join(''), '测试实时输入。');
  assert(calls.every((c) => ['arm', 'append', 'end'].includes(c.op)));
  assert.equal((await live.finish('a', '测试实时输入。')).attempted, false);
});

test('revised committed words halt without backspacing or appending a duplicate', async () => {
  const { live, calls } = fixture();
  await live.start('a', 12, 'Ctrl+D');
  live.update('a', '明天'); live.update('a', '明天去'); await live.flush(live.state);
  live.update('a', '后天去');
  const done = await live.finish('a', '后天去。');
  assert(done.blocked); assert.equal(done.reason, 'recognition-revised'); assert.equal(done.written, '明天');
  assert.equal(calls.filter((c) => c.op === 'append').length, 1);
});

test('focus and cursor guards stop; a held modifier waits; cancellation drains pending writes', async () => {
  const { live } = fixture([{ ok: false, retry: true, reason: 'modifier-held' }, { ok: false, reason: 'field-changed' }]);
  await live.start('a', 12, 'F8');
  live.update('a', '你好'); live.update('a', '你好世界');
  await live.flush(live.state); assert(live.snapshot().active);
  await live.flush(live.state); assert(live.snapshot().blocked);
  await live.end(); assert.equal(live.snapshot().attempted, false);
  assert.equal(triggerKey('CommandOrControl+D'), 68);
  assert.equal(triggerKey('F8'), 119);
  assert.equal(cleanLiveText('第一行\n第二行\t'), '第一行 第二行 ');
});
