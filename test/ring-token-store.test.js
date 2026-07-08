'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenFilePath, loadToken, saveToken } = require('../lib/ring-token-store');

test('tokenFilePath builds ring-<accountId>.token under the storage dir', () => {
  assert.strictEqual(tokenFilePath('/tmp/x', 'acc1'), path.join('/tmp/x', 'ring-acc1.token'));
});

test('loadToken returns null when the file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  assert.strictEqual(loadToken(dir, 'missing'), null);
});

test('saveToken then loadToken round-trips the token, trimmed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  saveToken(dir, 'acc1', 'the-token-value\n');
  assert.strictEqual(loadToken(dir, 'acc1'), 'the-token-value');
});
