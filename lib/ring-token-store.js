'use strict';

const fs = require('fs');
const path = require('path');

function tokenFilePath(storageDirPath, accountId) {
  return path.join(storageDirPath, `ring-${accountId}.token`);
}

// Ring "wrapped" refresh tokens are base64-encoded JSON blobs ({ rt, hid, pnc })
// that embed the hardware id and FCM push credentials of the install that
// created them. Reusing another install's hid/pnc (e.g. pasting a token that
// homebridge already rotated) makes both installs fight over the same push
// registration, and Ring/Google only deliver dings to one of them. Stripping
// the wrapper down to the bare OAuth refresh token lets this install mint its
// own hardware id and push identity.
function extractBareRefreshToken(token) {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('ascii'));
    if (parsed && typeof parsed.rt === 'string') {
      return parsed.rt;
    }
  } catch {
    // Not a wrapped token -- it's already a bare refresh token.
  }
  return token;
}

// Decides which refresh token to authenticate with.
//
// `persisted` is what saveToken wrote on a previous rotation: { seed, token }
// where `seed` is the credential the user originally pasted and `token` is the
// latest rotated value. `configured` is what's currently pasted in the node
// config. If the user pastes a *new* credential, it must win over the persisted
// chain (the old behavior of always preferring the persisted token made it
// impossible to ever change tokens). Legacy persisted files (plain string, no
// seed) are adopted into the current configured credential's chain.
function resolveRefreshToken({ persisted, configured }) {
  if (persisted && persisted.token) {
    const isLegacy = persisted.seed === undefined;
    if (isLegacy || !configured || persisted.seed === configured) {
      return {
        token: persisted.token,
        seed: isLegacy ? (configured ?? null) : persisted.seed,
        isNewChain: false,
      };
    }
  }
  if (configured) {
    return {
      token: extractBareRefreshToken(configured),
      seed: configured,
      isNewChain: true,
    };
  }
  return null;
}

function loadToken(storageDirPath, accountId) {
  const file = tokenFilePath(storageDirPath, accountId);
  if (!fs.existsSync(file)) {
    return null;
  }
  const contents = fs.readFileSync(file, 'utf8').trim();
  if (!contents) {
    return null;
  }
  try {
    const parsed = JSON.parse(contents);
    if (parsed && typeof parsed.token === 'string') {
      return { seed: parsed.seed ?? null, token: parsed.token };
    }
  } catch {
    // Legacy format: the file holds the raw token string with no seed.
  }
  return { seed: undefined, token: contents };
}

function saveToken(storageDirPath, accountId, { seed, token }) {
  fs.writeFileSync(
    tokenFilePath(storageDirPath, accountId),
    JSON.stringify({ seed: seed ?? null, token: token.trim() }),
    'utf8',
  );
}

module.exports = { tokenFilePath, loadToken, saveToken, extractBareRefreshToken, resolveRefreshToken };
