'use strict';

const fs = require('fs');
const path = require('path');

function storageDir(RED) {
  const base = (RED && RED.settings && RED.settings.userDir) || process.cwd();
  const dir = path.join(base, 'node-red-contrib-ring-intercom');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLogger(node) {
  return {
    debug: (msg) => node.debug(msg),
    info: (msg) => node.log(msg),
    warn: (msg) => node.warn(msg),
    error: (msg) => node.error(msg),
  };
}

module.exports = { storageDir, makeLogger };
