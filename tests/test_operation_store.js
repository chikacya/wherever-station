const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { operationStore } = require('../tools/operation-store');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wherever-operations-'));
try {
  const file = path.join(directory, 'operations.json');
  const initial = operationStore(file, () => 100);
  initial.set('pending', { expiresAt: 200, action: 'create', instanceId: 'owned' });
  const restarted = operationStore(file, () => 101);
  assert.equal(restarted.get('pending').instanceId, 'owned');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  restarted.delete('pending');
  assert.equal(operationStore(file, () => 102).get('pending'), undefined);
  initial.set('expired', { expiresAt: 110 });
  assert.equal(operationStore(file, () => 111).get('expired'), undefined);
  console.log('operation journal restart / cleanup / permissions passed');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
