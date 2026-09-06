const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { buildTerms, hash, downloadBytes } = require('../src/dictionary-packs');
const recipes = require('../resources/dictionary-recipes');
const root = path.resolve(__dirname, '..');
const repository = 'streetsidesoftware/cspell-dicts';
const revision = '033bb8b22f544b81f16e27c696aeadd0da431509';

function api(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { family: 4, headers: { 'User-Agent': 'VoiceAgentPad-CatalogBuilder' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('GitHub HTTP ' + response.statusCode)); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(30000, () => request.destroy(new Error('GitHub metadata timeout')));
    request.on('error', reject);
  });
}

async function main() {
  const commits = new Map();
  const directory = path.join(root, 'tmp', 'dictionary-source-fixtures');
  await fs.mkdir(directory, { recursive: true });
  const fetched = new Map();
  const previous = JSON.parse(await fs.readFile(path.join(root, 'resources', 'dictionary-catalog.json'), 'utf8'));
  const packs = [];
  for (const recipe of recipes) {
    const repo = recipe.upstream?.repository || repository;
    const ref = recipe.upstream?.revision || revision;
    const commitKey = repo + '/' + ref;
    if (!commits.has(commitKey)) commits.set(commitKey, await api(`https://api.github.com/repos/${repo}/commits/${ref}`));
    const commit = commits.get(commitKey);
    const licenses = recipe.upstream?.licenseFiles || [...new Set(recipe.files.map((file) => file.split('/').slice(0, 2).join('/') + '/LICENSE'))];
    const sources = [];
    const texts = [];
    for (const file of [...recipe.files, ...licenses]) {
      const kind = licenses.includes(file) ? 'license' : 'words';
      const urls = [`https://raw.githubusercontent.com/${repo}/${ref}/${file}`, `https://cdn.jsdelivr.net/gh/${repo}@${ref}/${file}`];
      let bytes = fetched.get(urls[0]);
      if (!bytes) {
        const known = previous.packs.flatMap((pack) => pack.sources).find((source) => source.urls[0] === urls[0]);
        if (known) {
          try {
            const fixture = await fs.readFile(path.join(directory, known.sha256 + '.txt'));
            if (fixture.length === known.bytes && hash(fixture) === known.sha256) bytes = fixture;
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
      if (!bytes) {
        for (const url of urls) {
          try { bytes = await downloadBytes(url, AbortSignal.timeout(130000)); break; }
          catch (error) { console.warn(file, error.message); }
        }
        if (!bytes) throw new Error('Cannot fetch ' + file);
        fetched.set(urls[0], bytes);
      }
      const licensePattern = recipe.upstream ? /GNU GENERAL PUBLIC LICENSE\s+Version 3/ : /MIT License|The MIT License/;
      if (kind === 'license' && !licensePattern.test(bytes.toString('utf8'))) throw new Error('Review this source license: ' + file);
      if (kind === 'words') texts.push(bytes.toString('utf8'));
      const sha256 = hash(bytes);
      await fs.writeFile(path.join(directory, sha256 + '.txt'), bytes);
      sources.push({ path: file, kind, urls, bytes: bytes.length, sha256 });
    }
    const terms = buildTerms(recipe, texts);
    packs.push({ ...recipe, version: '2026.09.05-1', reviewedAt: '2026-09-05', upstreamDate: commit.commit.committer.date,
      sourceUrl: `https://github.com/${repo}/tree/${ref}/${recipe.upstream?.sourceDirectory || 'dictionaries'}`, revision: ref,
      license: recipe.upstream?.license || 'MIT (selected CSpell dictionaries)', sources, bytes: sources.reduce((sum, file) => sum + file.bytes, 0),
      termCount: terms.length, termsSha256: hash(Buffer.from(JSON.stringify(terms))) });
    console.log(recipe.id, terms.length, 'terms');
  }
  await fs.writeFile(path.join(root, 'resources', 'dictionary-catalog.json'), JSON.stringify({ schemaVersion: 1, packs }, null, 2) + '\n');
  console.log('Catalog generated. Sources retained only as test fixtures under tmp.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
