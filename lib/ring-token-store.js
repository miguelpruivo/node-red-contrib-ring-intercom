'use strict';

const fs = require('fs');
const path = require('path');

function tokenFilePath(storageDirPath, accountId) {
  return path.join(storageDirPath, `ring-${accountId}.token`);
}

function loadToken(storageDirPath, accountId) {
  const file = tokenFilePath(storageDirPath, accountId);
  if (!fs.existsSync(file)) {
    return null;
  }
  const contents = fs.readFileSync(file, 'utf8').trim();
  return contents || null;
}

function saveToken(storageDirPath, accountId, token) {
  fs.writeFileSync(tokenFilePath(storageDirPath, accountId), token.trim(), 'utf8');
}

module.exports = { tokenFilePath, loadToken, saveToken };
