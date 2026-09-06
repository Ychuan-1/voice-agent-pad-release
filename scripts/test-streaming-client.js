const assert = require('node:assert/strict');
const path = require('node:path');
const { StreamingAsrClient } = require('../src/streaming-asr');

async function main() {
  const root = path.resolve(__dirname, '..');
  const client = new StreamingAsrClient({ root, python: path.join(root, '.venv', 'Scripts', 'python.exe') });
  try {
    await client.ensureReady();
    await client.request('start', { session: 'first', language: 'zh' });
    await assert.rejects(client.request('audio', { session: 'wrong', pcm: '', sampleRate: 16000 }));
    await client.request('audio', { session: 'first', pcm: Buffer.alloc(16000 * 4 / 20).toString('base64'), sampleRate: 16000 });
    const waiting = client.request('finish', { session: 'first' });
    client.stop(new Error('Test interruption'));
    await assert.rejects(waiting);
    await client.ensureReady();
    await client.request('start', { session: 'restarted', language: 'zh' });
    const result = await client.request('finish', { session: 'restarted' });
    assert.equal(result.text, '');
    console.log('PASS: session isolation, pending rejection, restart after interruption, silence');
  } finally {
    client.stop();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
