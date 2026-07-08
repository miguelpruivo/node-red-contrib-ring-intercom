'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { storageDir, makeLogger } = require('../lib/red-helpers');

test('storageDir creates and returns <userDir>/node-red-contrib-ring-intercom', () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ring-'));
  const dir = storageDir({ settings: { userDir } });
  assert.strictEqual(dir, path.join(userDir, 'node-red-contrib-ring-intercom'));
  assert.ok(fs.existsSync(dir));
});

test('storageDir falls back to process.cwd() when RED has no userDir', () => {
  const dir = storageDir(null);
  assert.strictEqual(dir, path.join(process.cwd(), 'node-red-contrib-ring-intercom'));
});

test('makeLogger adapts a node-like object to debug/info/warn/error', () => {
  const calls = [];
  const node = {
    debug: (m) => calls.push(['debug', m]),
    log: (m) => calls.push(['info', m]),
    warn: (m) => calls.push(['warn', m]),
    error: (m) => calls.push(['error', m]),
  };
  const logger = makeLogger(node);
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.deepStrictEqual(calls, [
    ['debug', 'd'],
    ['info', 'i'],
    ['warn', 'w'],
    ['error', 'e'],
  ]);
});
