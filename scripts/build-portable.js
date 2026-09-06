const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = '0.2.0-beta.6';
const args = new Set(process.argv.slice(2));
const flavor = args.has('--ai-extension') ? 'ai-extension' : args.has('--lite') ? 'lite' : 'full';
const includeAiExtension = flavor === 'full' || flavor === 'ai-extension' || args.has('--with-ai');
const destination = path.join(root, 'dist', `VoiceAgentPad-${version}-${flavor}-win-x64`);
const appRoot = path.join(destination, 'resources', 'app');
const hash = async (file) => {
  const value = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) value.update(chunk);
  return value.digest('hex');
};
async function copy(source, target, filter = () => true) {
  await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false, filter });
}
const noCache = (file) => !file.split(path.sep).some((p) => ['__pycache__', '.git'].includes(p)) && !/\.py[co]$/.test(file);
async function files(directory) {
  const all = [];
  for (const item of await fsp.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Unexpected symlink: ${file}`);
    if (item.isDirectory()) all.push(...await files(file)); else all.push(file);
  }
  return all.sort();
}

async function main() {
  if (fs.existsSync(destination)) throw new Error('Release directory exists; never overwrite a published build.');
  const licenses = path.join(root, 'tmp', 'release-licenses');
  if (flavor === 'ai-extension') {
    await buildAiExtension(licenses);
    return;
  }
  const requiredLicenses = includeAiExtension
    ? ['Qwen3-LICENSE.txt', 'llama.cpp-LICENSE.txt', 'onnxruntime-LICENSE.txt', 'onnxruntime-ThirdPartyNotices.txt']
    : ['onnxruntime-LICENSE.txt', 'onnxruntime-ThirdPartyNotices.txt'];
  for (const file of requiredLicenses) {
    if ((await fsp.stat(path.join(licenses, file))).size < 500) throw new Error(`Missing license: ${file}`);
  }
  await fsp.mkdir(appRoot, { recursive: true });
  console.log('Copying Electron and allowlisted app files...');
  const electron = path.join(root, 'node_modules', 'electron', 'dist');
  for (const name of await fsp.readdir(electron)) {
    if (name === 'resources') continue;
    await copy(path.join(electron, name), path.join(destination, name === 'electron.exe' ? 'VoiceAgentPad.exe' : name));
  }
  for (const name of ['src', 'resources']) await copy(path.join(root, name), path.join(appRoot, name), noCache);
  const runtimeScripts = ['hotkey_hold_hook.ps1', 'live_input.cs', 'live_input.ps1', 'send_paste.ps1', 'streaming_asr_worker.py', 'text_normalize.py'];
  for (const name of runtimeScripts) await copy(path.join(root, 'scripts', name), path.join(appRoot, 'scripts', name));
  const pkg = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
  const shipped = { name: pkg.name, productName: 'Voice Agent Pad', version, main: pkg.main, private: true, license: 'UNLICENSED', dependencies: pkg.dependencies };
  await fsp.writeFile(path.join(appRoot, 'package.json'), JSON.stringify(shipped, null, 2));
  const copied = new Set();
  async function dependency(name) {
    if (copied.has(name)) return;
    copied.add(name);
    const source = path.join(root, 'node_modules', name);
    await copy(source, path.join(appRoot, 'node_modules', name));
    const metadata = JSON.parse(await fsp.readFile(path.join(source, 'package.json'), 'utf8'));
    for (const child of Object.keys(metadata.dependencies || {})) await dependency(child);
  }
  for (const name of Object.keys(pkg.dependencies)) await dependency(name);

  console.log('Building isolated Python runtime without old engines...');
  const venv = path.join(root, '.venv');
  const pyHome = execFileSync(path.join(venv, 'Scripts', 'python.exe'), ['-c', 'import sys; print(sys.base_prefix)'], { encoding: 'utf8' }).trim();
  const py = path.join(appRoot, 'runtime', 'python');
  for (const name of ['python.exe', 'pythonw.exe', 'python3.dll', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt']) {
    await copy(path.join(pyHome, name), path.join(py, name));
  }
  await copy(path.join(pyHome, 'DLLs'), path.join(py, 'DLLs'), noCache);
  await copy(path.join(pyHome, 'Lib'), path.join(py, 'Lib'), (file) => {
    const relative = path.relative(path.join(pyHome, 'Lib'), file);
    return noCache(file) && !relative.split(path.sep).some((part) => ['site-packages', 'test', 'tests', 'idlelib', 'tkinter', 'turtledemo', 'ensurepip'].includes(part));
  });
  const site = path.join(venv, 'Lib', 'site-packages');
  const allowed = ['numpy', 'numpy.libs', 'numpy-1.26.4.dist-info', 'sherpa_onnx', 'sherpa_onnx-1.13.7.dist-info', 'sherpa_onnx_core-1.13.7.dist-info', 'opencc', 'opencc_python_reimplemented-0.1.7.dist-info'];
  for (const name of allowed) await copy(path.join(site, name), path.join(py, 'Lib', 'site-packages', name), noCache);
  await copy(path.join(__dirname, 'release', 'python312._pth'), path.join(py, 'python312._pth'));
  console.log(execFileSync(path.join(py, 'python.exe'), ['-B', '-c', 'import sys,numpy,sherpa_onnx,opencc; assert sys.flags.isolated; print("Portable Python imports OK", sys.version.split()[0])'], { encoding: 'utf8', env: { ...process.env, PYTHONHOME: '', PYTHONPATH: '' } }).trim());

  console.log('Copying and verifying public models...');
  await fsp.mkdir(path.join(appRoot, 'models'), { recursive: true });
  await copy(path.join(root, 'models', 'paraformer-streaming-zh-en'), path.join(appRoot, 'models', 'paraformer-streaming-zh-en'), noCache);
  if (includeAiExtension) {
    await copy(path.join(root, 'models', 'text-editor'), path.join(appRoot, 'models', 'text-editor'), noCache);
    await copy(path.join(root, 'runtime', 'llama-b10816'), path.join(appRoot, 'runtime', 'llama-b10816'), (file) => !file.endsWith('.zip'));
  }
  const modelHashes = {
    'models/paraformer-streaming-zh-en/encoder.int8.onnx': '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a',
    'models/paraformer-streaming-zh-en/decoder.int8.onnx': 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f',
    ...(includeAiExtension ? { 'models/text-editor/Qwen3-1.7B-Q8_0.gguf': '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a' } : {})
  };
  for (const [name, expected] of Object.entries(modelHashes)) if (await hash(path.join(appRoot, name)) !== expected) throw new Error(`Model checksum mismatch: ${name}`);
  await fsp.mkdir(path.join(destination, 'licenses'), { recursive: true });
  for (const file of requiredLicenses) await copy(path.join(licenses, file), path.join(destination, 'licenses', file));
  await copy(path.join(site, 'sherpa_onnx-1.13.7.dist-info', 'licenses', 'LICENSE'), path.join(destination, 'licenses', 'Paraformer-and-sherpa-Apache-2.0.txt'));
  for (const name of await fsp.readdir(path.join(__dirname, 'release'))) {
    if (name === 'python312._pth') continue;
    await copy(path.join(__dirname, 'release', name), path.join(destination, name.endsWith('.ps1') ? path.join('tools', name) : name));
  }
  await fsp.writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), [
    'Voice Agent Pad: third-party components and model provenance',
    'Electron ' + (await fsp.readFile(path.join(electron, 'version'), 'utf8')).trim() + ': LICENSE and LICENSES.chromium.html at package root; https://github.com/electron/electron',
    'CPython ' + execFileSync(path.join(py, 'python.exe'), ['-c', 'import sys; print(sys.version.split()[0])'], { encoding: 'utf8' }).trim() + ': resources/app/runtime/python/LICENSE.txt; https://www.python.org/ ; application-local copy with curated standard library, original binaries unchanged.',
    'NumPy 1.26.4 (including bundled OpenBLAS): runtime/python/Lib/site-packages/numpy-1.26.4.dist-info/LICENSE.txt',
    'sherpa-onnx / sherpa-onnx-core 1.13.7: Apache-2.0; https://github.com/k2-fsa/sherpa-onnx ; package metadata and licenses preserved.',
    'ONNX Runtime (shipped within sherpa-onnx-core): MIT; https://github.com/microsoft/onnxruntime ; licenses/onnxruntime-*',
    'Paraformer INT8: Apache-2.0; https://huggingface.co/csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en ; revision 8e40c43232a1c5c66c82111efc5820d3accca11b ; model card and download manifest included.',
    ...(includeAiExtension ? [
      'Qwen3-1.7B-Q8_0 GGUF: Apache-2.0; https://huggingface.co/Qwen/Qwen3-1.7B-GGUF ; licenses/Qwen3-LICENSE.txt; unmodified weight checksum in manifest.',
      'llama.cpp b10816: MIT; https://github.com/ggml-org/llama.cpp/releases/tag/b10816 ; licenses/llama.cpp-LICENSE.txt; LLVM OpenMP license in runtime/llama-b10816.'
    ] : [
      'AI整理扩展未随轻量包内置；安装扩展包后会添加 Qwen3 GGUF 模型和 llama.cpp 运行时。'
    ]),
    'opencc-python-reimplemented 0.1.7: Apache-2.0; license retained in Python distribution metadata.',
    ...[...copied].map((name) => { const p = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'))); return `${name} ${p.version}: ${p.license}; original license files in resources/app/node_modules/${name}.`; }),
    'Optional dictionary source packs are NOT bundled. Their source and license metadata are shown by the catalog when downloaded.'
  ].join('\r\n'));
  await finalize();
}

async function buildAiExtension(licenses) {
  const requiredLicenses = ['Qwen3-LICENSE.txt', 'llama.cpp-LICENSE.txt'];
  for (const file of requiredLicenses) {
    if ((await fsp.stat(path.join(licenses, file))).size < 500) throw new Error(`Missing license: ${file}`);
  }
  await copy(path.join(root, 'models', 'text-editor'), path.join(appRoot, 'models', 'text-editor'), noCache);
  await copy(path.join(root, 'runtime', 'llama-b10816'), path.join(appRoot, 'runtime', 'llama-b10816'), (file) => !file.endsWith('.zip'));
  await fsp.mkdir(path.join(destination, 'licenses'), { recursive: true });
  for (const file of requiredLicenses) await copy(path.join(licenses, file), path.join(destination, 'licenses', file));
  await fsp.writeFile(path.join(destination, 'README-AI-EXTENSION.txt'), [
    'Voice Agent Pad AI 整理扩展包',
    '',
    '用途：为轻量版补充本地日常整理、条理整理、中文转英文。',
    '安装：把本包里的 resources 文件夹合并到轻量版 VoiceAgentPad.exe 所在目录。',
    '生效：重新启动 Voice Agent Pad 后，设置 -> 文字 会显示 Qwen3 1.7B 本地 CPU。',
    '',
    '本扩展不需要云端 API，但会占用本机存储、内存和 CPU。'
  ].join('\r\n'));
  const expected = '061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a';
  if (await hash(path.join(appRoot, 'models', 'text-editor', 'Qwen3-1.7B-Q8_0.gguf')) !== expected) throw new Error('AI model checksum mismatch');
  await finalize();
}

async function finalize() {
  const inventory = [];
  for (const file of await files(destination)) {
    const relative = path.relative(destination, file).replaceAll('\\', '/');
    if (relative === 'manifest.json') continue;
    if (/(^|\/)(settings\.json|history\.json|draft\.json|dictionary-packs\.json|\.env|\.venv|tmp|Cache|\.git)(\/|$)/i.test(relative)) throw new Error(`Private/developer data in release: ${relative}`);
    if (/\.(js|json|ps1|cs|py|html|css|txt|md)$/i.test(file) && !relative.includes('node_modules/') && !relative.includes('runtime/') && !relative.startsWith('licenses/')) {
      const body = await fsp.readFile(file, 'utf8');
      if (/13118|GPT 工作区|sk-[A-Za-z0-9_-]{24,}|hf_[A-Za-z0-9]{20,}/.test(body)) throw new Error(`Private path/token candidate in release: ${relative}`);
    }
    inventory.push({ path: relative, bytes: (await fsp.stat(file)).size, sha256: await hash(file) });
  }
  const manifest = { product: 'Voice Agent Pad', version, flavor, aiExtensionIncluded: includeAiExtension, platform: 'win32-x64', created: new Date().toISOString(), files: inventory };
  await fsp.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const result = { destination, version, files: inventory.length, bytes: inventory.reduce((sum, file) => sum + file.bytes, 0) };
  await fsp.writeFile(path.join(root, 'dist', 'build-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
(process.argv.includes('--finalize') ? finalize() : main()).catch((error) => { console.error(error); process.exitCode = 1; });
