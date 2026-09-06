const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const required = [
  'package.json',
  'requirements-local.txt',
  'requirements-streaming.txt',
  'src/main.js',
  'src/live-input.js',
  'src/recording-hud.js',
  'src/hud-renderer.js',
  'src/hud-preload.js',
  'src/hud.html',
  'src/hud.css',
  'scripts/live_input.cs',
  'scripts/live_input.ps1',
  'src/text-tools.js',
  'src/local-store.js',
  'src/local-editor.js',
  'src/clipboard-guard.js',
  'src/features-renderer.js',
  'src/dictionary-packs.js',
  'src/dictionary-pack-worker.js',
  'src/packs-renderer.js',
  'resources/dictionary-catalog.json',
  'resources/daily-dictionary-recipes.js',
  'src/preload.js',
  'src/index.html',
  'src/renderer.js',
  'src/streaming-asr.js',
  'src/pcm-capture.js',
  'src/styles.css',
  'scripts/local_transcribe.py',
  'scripts/local_transcribe_worker.py',
  'scripts/sensevoice_transcribe.py',
  'scripts/sensevoice_transcribe_worker.py',
  'scripts/send_paste.ps1',
  'scripts/text_normalize.py',
  'scripts/streaming_asr_worker.py'
];

const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));

if (missing.length) {
  console.error(`Missing files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  process.exit(1);
}

for (const file of required.filter((item) => item.endsWith('.js'))) {
  new Function(fs.readFileSync(path.join(root, file), 'utf8'));
}

console.log('Project shape looks good.');
