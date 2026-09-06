const packView = { data: { packs: [], busy: false }, timer: null, version: 0, signature: '', pending: new Set() };

function packSize(bytes) { return bytes >= 1000000 ? `${(bytes / 1000000).toFixed(2)} MB` : `${(bytes / 1000).toFixed(1)} KB`; }
function packNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function packAction(pack, action, enabled) {
  if (packView.pending.has(pack.id) && action !== 'cancel') return;
  if (action === 'remove' && !window.confirm(`删除“${pack.name}”？其他词包和语音记录不受影响。`)) return;
  packView.pending.add(pack.id);
  const status = element('packStatus');
  status.textContent = action === 'install' ? `正在连接词包源：${pack.name}` : '正在处理';
  try {
    if (action === 'install') {
      const result = await api.installPack(pack.id);
      status.textContent = result.cancelled ? '下载已取消，原词包未变' : `${pack.name}已下载${pack.enabled ? '' : '，未启用'}`;
    } else if (action === 'cancel') {
      const result = await api.cancelPack(pack.id);
      status.textContent = result.cancelled ? '正在取消下载' : '词包正在保存';
    } else {
      await api.changePack(pack.id, action, enabled);
      status.textContent = action === 'remove' ? '词包已删除' : `${pack.name}已${enabled ? '启用' : '停用'}并保存`;
    }
  } catch (error) { status.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  finally { packView.pending.delete(pack.id); await refreshPacks(); }
}

async function fillPackPreview(pack, body) {
  body.replaceChildren(packNode('p', 'pack-meta', '正在读取词条'));
  try {
    const preview = await api.previewPack(pack.id);
    const search = packNode('input', 'pack-word-search');
    search.type = 'search'; search.placeholder = '搜索词条'; search.setAttribute('aria-label', `搜索${pack.name}词条`);
    const count = packNode('div', 'pack-meta');
    const words = packNode('div', 'pack-words');
    const render = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = preview.terms.filter((row) => [row.term, ...row.aliases].some((value) => value.toLowerCase().includes(query)));
      count.textContent = `${preview.complete ? '完整词表' : '重点词预览'} · ${filtered.length} 条${filtered.length > 100 ? ' · 显示前 100 条' : ''}`;
      words.replaceChildren();
      for (const row of filtered.slice(0, 100)) {
        const line = packNode('div', 'pack-word');
        line.append(packNode('span', '', row.term), packNode('span', 'pack-alias', row.aliases.length ? `${row.aliases.join(' / ')} → ${row.term}` : '用词参考'));
        words.append(line);
      }
    };
    search.addEventListener('input', render);
    const provenance = packNode('div', 'pack-provenance', `精选整理 ${pack.reviewedAt} · 上游快照 ${pack.upstreamDate.slice(0, 10)} · ${pack.license}`);
    const source = iconButton('external-link', `查看${pack.name}来源`, () => void api.openPackSource(pack.id).catch((error) => { element('packStatus').textContent = error.message; }));
    provenance.append(source);
    body.replaceChildren(search, count, words, provenance);
    render();
    refreshIcons();
  } catch (error) { body.replaceChildren(packNode('p', 'pack-error', error.message)); }
}

function renderPacks(force = false) {
  const query = element('packSearch').value.trim().toLowerCase();
  const filter = element('packFilter').value;
  const category = element('packCategory').value;
  const data = packView.data;
  const signature = JSON.stringify([query, filter, category, data.busy, data.packs.map(({ progress, ...pack }) => pack)]);
  if (!force && packView.signature === signature) {
    for (const pack of data.packs) {
      const row = element('packList').querySelector(`[data-pack="${pack.id}"]`);
      if (row && pack.downloading) {
        row.querySelector('progress').value = pack.progress;
        row.querySelector('.pack-state').textContent = `下载中 ${pack.progress}%`;
      }
    }
    return;
  }
  packView.signature = signature;
  const opened = new Set([...element('packList').querySelectorAll('details[open]')].map((node) => node.closest('[data-pack]').dataset.pack));
  const list = element('packList');
  list.replaceChildren();
  const matches = data.packs.filter((pack) => (filter === 'all' || (filter === 'installed' ? pack.installed : pack.enabled))
    && (category === 'all' || (category === 'daily' ? pack.category === '日常' : pack.category !== '日常'))
    && (!query || [pack.name, pack.summary, pack.category, ...pack.samples].join(' ').toLowerCase().includes(query)));
  if (!matches.length) list.append(packNode('p', 'pack-meta', '没有匹配词包'));
  for (const pack of matches) {
    const row = packNode('article', 'pack-row'); row.dataset.pack = pack.id;
    const heading = packNode('div', 'pack-heading');
    const title = packNode('h3', '');
    const glyph = document.createElement('i'); glyph.dataset.lucide = pack.icon;
    title.append(glyph, document.createTextNode(pack.name));
    const actions = packNode('div', 'pack-actions');
    if (pack.downloading) actions.append(iconButton('square', `取消下载${pack.name}`, () => void packAction(pack, 'cancel')));
    else {
      if (pack.installed && !pack.damaged && !pack.needsUpdate) {
        const toggleLabel = packNode('label', 'pack-toggle');
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = pack.enabled;
        toggle.setAttribute('aria-label', `启用${pack.name}`); toggle.setAttribute('role', 'switch');
        toggle.addEventListener('change', () => void packAction(pack, 'enable', toggle.checked));
        toggleLabel.append(toggle); actions.append(toggleLabel);
      }
      const download = iconButton(pack.installed ? 'refresh-cw' : 'download', `${pack.installed ? pack.needsUpdate ? '更新' : '重新下载' : '下载'}${pack.name}`, () => void packAction(pack, 'install'));
      download.disabled = data.busy;
      actions.append(download);
      if (pack.installed) actions.append(iconButton('trash-2', `删除${pack.name}`, () => void packAction(pack, 'remove')));
    }
    heading.append(title, actions);
    const status = pack.downloading ? `下载中 ${pack.progress}%` : pack.damaged ? '文件损坏' : pack.needsUpdate ? '版本待更新' : pack.enabled ? '已启用' : pack.installed ? '已下载 · 未启用' : '未下载';
    const meta = packNode('div', 'pack-meta');
    meta.append(packNode('span', 'pack-state', status), packNode('span', '', `${pack.termCount} 词 · ${pack.sourceCache ? '共享源' : '下载'} ${packSize(pack.bytes)}${pack.installed ? ' · 已存 ' + packSize(pack.installedBytes) : ''}`));
    row.append(heading, packNode('p', 'pack-summary', pack.summary), meta);
    if (pack.downloading) { const progress = document.createElement('progress'); progress.max = 100; progress.value = pack.progress; progress.setAttribute('aria-label', `${pack.name}下载进度`); row.append(progress); }
    if (pack.error) row.append(packNode('p', 'pack-error', pack.error));
    const details = document.createElement('details'); details.className = 'pack-preview';
    details.append(packNode('summary', '', `${pack.installed ? '查看词表' : '查看重点词'} · 精选 ${pack.curatedCount} 词`));
    const body = packNode('div', 'pack-preview-body'); details.append(body);
    let loaded = false;
    details.addEventListener('toggle', () => { if (details.open && !loaded) { loaded = true; void fillPackPreview(pack, body); } });
    if (opened.has(pack.id)) details.open = true;
    row.append(details); list.append(row);
  }
  refreshIcons();
}

async function refreshPacks() {
  const version = ++packView.version;
  try {
    const data = await api.listPacks();
    if (version !== packView.version) return;
    packView.data = data; renderPacks();
  } catch (error) { element('packStatus').textContent = '读取词包失败：' + error.message; }
}

async function initPacks() {
  element('packSearch').addEventListener('input', () => renderPacks());
  element('packFilter').addEventListener('change', () => renderPacks());
  element('packCategory').addEventListener('change', () => renderPacks());
  document.querySelector('[data-view="packs"]').addEventListener('click', () => void refreshPacks());
  api.onPacksChanged(() => {
    clearTimeout(packView.timer);
    packView.timer = setTimeout(() => void refreshPacks(), 80);
  });
  await refreshPacks();
}
