'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

function makeRED() {
  const registered = {};

  const RED = {
    settings: { userDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ring-')) },
    nodes: {
      createNode(node, config) {
        node.id = config.id || 'n' + Math.random().toString(16).slice(2);
        node.name = config.name;
        node.credentials = config.credentials || {};
        if (!node.status) node.status = () => {};
        if (!node.send) node.send = () => {};
        if (!node.log) node.log = () => {};
        if (!node.warn) node.warn = () => {};
        if (!node.error) node.error = () => {};
        if (!node.debug) node.debug = () => {};
        if (!node.on) node.on = () => {};
      },
      registerType(name, ctor, opts) {
        registered[name] = { ctor, opts };
      },
      getNode() {
        return null;
      },
    },
  };

  return { RED, registered };
}

const NODE_FILES = [
  ['../nodes/ring-account.js', 'ring-account'],
  ['../nodes/ring-intercom.js', 'ring-intercom'],
];

test('all node modules register their type', () => {
  const { RED, registered } = makeRED();
  for (const [file] of NODE_FILES) {
    const mod = require(file);
    assert.strictEqual(typeof mod, 'function', `${file} exports a function`);
    mod(RED);
  }
  for (const [, type] of NODE_FILES) {
    assert.ok(registered[type], `${type} registered`);
  }
});

test('ring-account exposes a refreshToken credential type', () => {
  const { RED, registered } = makeRED();
  require('../nodes/ring-account.js')(RED);
  assert.strictEqual(registered['ring-account'].opts.credentials.refreshToken.type, 'password');
});

test('ring-intercom errors cleanly when no ring-account is configured', () => {
  const { RED, registered } = makeRED();
  require('../nodes/ring-intercom.js')(RED);
  const errors = [];
  const ctor = registered['ring-intercom'].ctor;
  const node = Object.create(ctor.prototype);
  RED.nodes.createNode(node, { id: 'i1' });
  node.error = (m) => errors.push(m);
  ctor.call(node, { id: 'i1', account: 'missing-account', deviceId: '123' });
  assert.deepStrictEqual(errors, ['No ring-account configured']);
});
