const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class LocalStore {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
  }

  async read(name, fallback) {
    await this.queue;
    return this.readNow(name, fallback);
  }

  async readNow(name, fallback) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return fallback;
      // Do not overwrite a corrupt store with an empty history.
      throw new Error(`无法读取 ${name}，原文件已保留。`);
    }
  }

  update(name, fallback, transform) {
    const operation = this.queue.then(async () => {
      const next = await transform(await this.readNow(name, fallback));
      await fs.mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, name);
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', 'utf8');
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      return next;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  write(name, value) { return this.update(name, null, () => value); }
}

function pruneHistory(history, settings, now = Date.now()) {
  const days = Number(settings.historyRetentionDays || 0);
  const maximum = Math.max(20, Math.min(2000, Number(settings.maxHistoryItems) || 200));
  return history.filter((item) => item.pinned || !days || now - Date.parse(item.createdAt) < days * 86400000)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .filter((item, index, items) => item.pinned || items.slice(0, index).filter((row) => !row.pinned).length < maximum);
}

module.exports = { LocalStore, pruneHistory };
