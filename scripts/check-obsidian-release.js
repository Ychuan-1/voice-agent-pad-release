const fs = require('node:fs');
const path = require('node:path');
const vault = 'D:\\Obsidian\\CodexVault';
const stage = 'D:\\GPT 工作区\\obsidian_updates\\2026-09-05-voice-product-release';
function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).filter((x) => !x.name.startsWith('.')).flatMap((x) => {
    const file = path.join(root, x.name);
    return x.isDirectory() ? walk(file) : file.endsWith('.md') ? [file] : [];
  });
}
const names = new Set(walk(vault).map((file) => path.basename(file, '.md')));
const missing = [];
let links = 0;
for (const source of walk(stage)) {
  const target = path.join(vault, path.relative(stage, source));
  if (fs.readFileSync(source, 'utf8') !== fs.readFileSync(target, 'utf8')) throw new Error(`Not published: ${source}`);
  // The two existing entry notes retain their historical links; inspect new notes.
  if (source.includes('04_项目') || source.includes('09_人工智能学习')) continue;
  for (const match of fs.readFileSync(source, 'utf8').matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)) {
    links++;
    if (!names.has(path.basename(match[1]))) missing.push({ note: path.basename(source), target: match[1] });
  }
}
console.log(JSON.stringify({ notes: walk(stage).length, links, missing }, null, 2));
if (missing.length) process.exitCode = 1;
