'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  LOCK_STATE,
  isUnlockCommand,
  buildLockStateMessage,
  buildDingMessage,
} = require('../lib/ring-messages');

test('LOCK_STATE matches the HAP LockTargetState/LockCurrentState enum', () => {
  assert.strictEqual(LOCK_STATE.UNSECURED, 0);
  assert.strictEqual(LOCK_STATE.SECURED, 1);
});

test('isUnlockCommand is true for an NRCHKB Lock Mechanism unlock message', () => {
  assert.strictEqual(isUnlockCommand({ payload: { LockTargetState: 0 } }), true);
});

test('isUnlockCommand is false for a secure/other/malformed message', () => {
  assert.strictEqual(isUnlockCommand({ payload: { LockTargetState: 1 } }), false);
  assert.strictEqual(isUnlockCommand({ payload: {} }), false);
  assert.strictEqual(isUnlockCommand({}), false);
  assert.strictEqual(isUnlockCommand(null), false);
});

test('buildLockStateMessage shapes an NRCHKB Lock Mechanism output message', () => {
  assert.deepStrictEqual(buildLockStateMessage(LOCK_STATE.UNSECURED), {
    payload: { LockCurrentState: 0 },
    event: 'lock',
  });
  assert.deepStrictEqual(buildLockStateMessage(LOCK_STATE.SECURED), {
    payload: { LockCurrentState: 1 },
    event: 'lock',
  });
});

test('buildDingMessage shapes an NRCHKB Doorbell output message', () => {
  assert.deepStrictEqual(buildDingMessage(), {
    payload: { ProgrammableSwitchEvent: 0 },
    event: 'ding',
  });
});
