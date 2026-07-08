'use strict';

module.exports = function (RED) {
  const { RingApi } = require('ring-client-api');
  const { useLogger } = require('ring-client-api/util');
  const { storageDir, makeLogger } = require('../lib/red-helpers');
  const { loadToken, saveToken, resolveRefreshToken } = require('../lib/ring-token-store');

  // How long a closed account's RingApi is kept alive waiting for a redeploy
  // to reclaim it. ring-client-api never destroys its FCM PushReceiver (not
  // even in RingApi.disconnect()), so building a fresh RingApi on every deploy
  // leaks a zombie push socket that keeps competing with the new one for the
  // same push identity -- Google then delivers each ding to whichever socket
  // happens to hold the connection, which is how push "never fires" while the
  // process is redeployed repeatedly. Reusing one RingApi per account node
  // means only one push receiver ever exists in the process.
  const DISPOSE_GRACE_MS = 60000;
  const sharedApis = new Map();

  // ring-client-api logs (including push-subsystem failures such as a
  // PushReceiver that cannot register/connect) go to a `debug`-package
  // namespace that is invisible in Node-RED. Route them into the runtime log
  // so push problems are actually diagnosable.
  useLogger({
    logInfo(message) {
      RED.log?.debug?.(`[ring] ${message}`);
    },
    logError(message) {
      RED.log?.warn?.(`[ring] ${message}`);
    },
  });

  function disposeEntry(nodeId, entry) {
    if (entry.tokenSub) {
      entry.tokenSub.unsubscribe();
      entry.tokenSub = null;
    }
    try {
      entry.api.disconnect();
    } catch (err) {
      RED.log?.warn?.(`[ring] Failed to disconnect Ring API cleanly: ${err.message}`);
    }
    if (sharedApis.get(nodeId) === entry) {
      sharedApis.delete(nodeId);
    }
  }

  function acquireRingApi(nodeId, resolved, verbose) {
    const existing = sharedApis.get(nodeId);
    if (existing) {
      if (existing.disposeTimer) {
        clearTimeout(existing.disposeTimer);
        existing.disposeTimer = null;
      }
      if (existing.seed === resolved.seed) {
        return existing;
      }
      // Credentials changed: this entry's session is for the old token.
      disposeEntry(nodeId, existing);
    }

    const api = new RingApi({
      refreshToken: resolved.token,
      // Deterministic per-node hardware id so this install never shares a
      // Ring session (and its push registration) with another ring-client-api
      // consumer on the same machine, e.g. homebridge-ring.
      systemId: `node-red-contrib-ring-intercom:${nodeId}`,
      controlCenterDisplayName: 'node-red-ring-intercom',
      debug: verbose,
    });
    const entry = { api, seed: resolved.seed, tokenSub: null, disposeTimer: null };
    sharedApis.set(nodeId, entry);
    return entry;
  }

  function RingAccountNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const dir = storageDir(RED);
    const logger = makeLogger(node);

    const persisted = loadToken(dir, node.id);
    const configured = node.credentials && node.credentials.refreshToken;
    const resolved = resolveRefreshToken({ persisted, configured });

    if (!resolved) {
      node.error('No Ring refresh token configured. Set one in the node config.');
      return;
    }
    if (resolved.isNewChain && resolved.token !== configured) {
      logger.info(
        "Configured token was a wrapped token carrying another install's push identity; using its bare refresh token so this node registers its own push credentials.",
      );
    }

    const entry = acquireRingApi(node.id, resolved, Boolean(config.verbose));
    node.ringApi = entry.api;

    entry.tokenSub = node.ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
      saveToken(dir, node.id, { seed: resolved.seed, token: newRefreshToken });
      logger.debug('Ring refresh token rotated and saved to disk');
    });

    node.getIntercom = async function (deviceId) {
      const locations = await node.ringApi.getLocations();
      for (const location of locations) {
        const found = location.intercoms.find((i) => String(i.id) === String(deviceId));
        if (found) {
          return found;
        }
      }
      return null;
    };

    node.ringApi
      .getLocations()
      .then((locations) => {
        const found = locations.flatMap((l) => l.intercoms.map((i) => `${i.name} (id: ${i.id})`));
        logger.info(`Ring intercoms found: ${found.join(', ') || 'none'}`);
      })
      .catch((err) => logger.error(`Failed to list Ring locations: ${err.message}`));

    node.on('close', (done) => {
      if (entry.tokenSub) {
        entry.tokenSub.unsubscribe();
        entry.tokenSub = null;
      }
      // Keep the RingApi (and its single push receiver) alive briefly so a
      // redeploy reclaims it instead of spawning a competing push socket.
      entry.disposeTimer = setTimeout(() => disposeEntry(node.id, entry), DISPOSE_GRACE_MS);
      if (entry.disposeTimer.unref) {
        entry.disposeTimer.unref();
      }
      done();
    });
  }

  RED.nodes.registerType('ring-account', RingAccountNode, {
    credentials: { refreshToken: { type: 'password' } },
  });
};
