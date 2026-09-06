const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const directory = path.resolve(__dirname, '../tmp/release-licenses');
const sources = {
  'Qwen3-LICENSE.txt': 'https://modelscope.cn/models/Qwen/Qwen3-1.7B-GGUF/resolve/master/LICENSE',
  'llama.cpp-LICENSE.txt': 'https://raw.githubusercontent.com/ggml-org/llama.cpp/b10816/LICENSE',
  'onnxruntime-LICENSE.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.27.1/LICENSE',
  'onnxruntime-ThirdPartyNotices.txt': 'https://raw.githubusercontent.com/microsoft/onnxruntime/v1.27.1/ThirdPartyNotices.txt'
};
(async () => {
  await fs.mkdir(directory, { recursive: true });
  for (const [name, url] of Object.entries(sources)) {
    const cached = await fs.readFile(path.join(directory, name), 'utf8').catch(() => '');
    if (cached.length > 500 && !/<html/i.test(cached)) { console.log('Cached', name); continue; }
    const alternate = url.replace('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.27.1/', 'https://api.github.com/repos/microsoft/onnxruntime/contents/') + '?ref=v1.27.1';
    let text;
    for (const candidate of url.includes('/microsoft/onnxruntime/') ? [alternate, url] : [url]) {
      try {
        text = execFileSync('curl.exe', ['-4', '--silent', '--show-error', '--fail', '--location', '--connect-timeout', '15', '--max-time', '45', '-H', 'User-Agent: VoiceAgentPad-release', candidate], { encoding: 'utf8', maxBuffer: 5000000 });
        if (candidate.includes('api.github.com')) text = Buffer.from(JSON.parse(text).content, 'base64').toString('utf8');
        break;
      } catch (error) { if (candidate === url) throw error; }
    }
    if (text.length < 500 || /<html/i.test(text)) throw new Error(`Invalid license: ${name}`);
    await fs.writeFile(path.join(directory, name), text);
    console.log(name, text.length);
  }
  await fs.writeFile(path.join(directory, 'sources.json'), JSON.stringify(sources, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
