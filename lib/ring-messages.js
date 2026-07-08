'use strict';

const LOCK_STATE = { UNSECURED: 0, SECURED: 1 };

function isUnlockCommand(msg) {
  return Boolean(msg && msg.payload && msg.payload.LockTargetState === LOCK_STATE.UNSECURED);
}

function buildLockStateMessage(state) {
  return { payload: { LockCurrentState: state }, event: 'lock' };
}

function buildDingMessage() {
  return { payload: { ProgrammableSwitchEvent: 0 }, event: 'ding' };
}

module.exports = { LOCK_STATE, isUnlockCommand, buildLockStateMessage, buildDingMessage };
