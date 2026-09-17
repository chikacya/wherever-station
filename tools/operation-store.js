// Private pending-operation journal. Never stores shell commands or server keys.
const fs = require('fs');
const path = require('path');

function operationStore(filename, now = Date.now) {
  let entries = new Map();
  if (fs.existsSync(filename)) {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (saved.schema !== 1 || !Array.isArray(saved.entries)) throw new Error('Invalid operation journal');
    entries = new Map(saved.entries.filter(([, value]) => value.expiresAt > now()));
  }
  const persist = () => {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = filename + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ schema: 1, entries: [...entries] }), { mode: 0o600 });
    fs.renameSync(temporary, filename);
    fs.chmodSync(filename, 0o600);
  };
  return {
    get(id) { return entries.get(id); },
    set(id, value) {
      for (const [key, item] of entries) if (item.expiresAt <= now()) entries.delete(key);
      if (!entries.has(id) && entries.size >= 500) throw new Error('待处理操作过多，请先处理已有任务');
      entries.set(id, value); persist();
    },
    delete(id) { if (entries.delete(id)) persist(); },
    [Symbol.iterator]() { return entries[Symbol.iterator](); },
  };
}
module.exports = { operationStore };
