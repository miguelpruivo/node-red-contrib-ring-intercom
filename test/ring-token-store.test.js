'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  tokenFilePath,
  loadToken,
  saveToken,
  extractBareRefreshToken,
  resolveRefreshToken,
} = require('../lib/ring-token-store');

function wrapToken(config) {
  return Buffer.from(JSON.stringify(config), 'ascii').toString('base64');
}

test('tokenFilePath builds ring-<accountId>.token under the storage dir', () => {
  assert.strictEqual(tokenFilePath('/tmp/x', 'acc1'), path.join('/tmp/x', 'ring-acc1.token'));
});

test('loadToken returns null when the file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  assert.strictEqual(loadToken(dir, 'missing'), null);
});

test('saveToken then loadToken round-trips seed and token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  saveToken(dir, 'acc1', { seed: 'pasted-token', token: 'rotated-token\n' });
  assert.deepStrictEqual(loadToken(dir, 'acc1'), { seed: 'pasted-token', token: 'rotated-token' });
});

test('loadToken reads a legacy plain-string file as a seedless token', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  fs.writeFileSync(tokenFilePath(dir, 'acc1'), 'legacy-token-value\n', 'utf8');
  assert.deepStrictEqual(loadToken(dir, 'acc1'), { seed: undefined, token: 'legacy-token-value' });
});

test('extractBareRefreshToken unwraps a wrapped token to its bare rt', () => {
  const wrapped = wrapToken({ rt: 'bare-rt', hid: 'other-install-hid', pnc: { fcm: { token: 'x' } } });
  assert.strictEqual(extractBareRefreshToken(wrapped), 'bare-rt');
});

test('extractBareRefreshToken passes a bare token through unchanged', () => {
  assert.strictEqual(extractBareRefreshToken('plain-oauth-refresh-token'), 'plain-oauth-refresh-token');
});

test('resolveRefreshToken starts a new chain from the configured token when nothing is persisted', () => {
  const wrapped = wrapToken({ rt: 'bare-rt', hid: 'foreign-hid' });
  assert.deepStrictEqual(resolveRefreshToken({ persisted: null, configured: wrapped }), {
    token: 'bare-rt',
    seed: wrapped,
    isNewChain: true,
  });
});

test('resolveRefreshToken continues the persisted chain when the configured seed matches', () => {
  const resolved = resolveRefreshToken({
    persisted: { seed: 'pasted', token: 'rotated' },
    configured: 'pasted',
  });
  assert.deepStrictEqual(resolved, { token: 'rotated', seed: 'pasted', isNewChain: false });
});

test('resolveRefreshToken prefers a newly pasted credential over a stale persisted chain', () => {
  const resolved = resolveRefreshToken({
    persisted: { seed: 'old-pasted', token: 'old-rotated' },
    configured: 'new-pasted',
  });
  assert.deepStrictEqual(resolved, { token: 'new-pasted', seed: 'new-pasted', isNewChain: true });
});

test('resolveRefreshToken adopts a legacy seedless persisted token into the configured chain', () => {
  const resolved = resolveRefreshToken({
    persisted: { seed: undefined, token: 'legacy-rotated' },
    configured: 'originally-pasted',
  });
  assert.deepStrictEqual(resolved, {
    token: 'legacy-rotated',
    seed: 'originally-pasted',
    isNewChain: false,
  });
});

test('resolveRefreshToken returns null when nothing is configured or persisted', () => {
  assert.strictEqual(resolveRefreshToken({ persisted: null, configured: undefined }), null);
});
