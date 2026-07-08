'use strict';

module.exports = function (RED) {
  const { RingApi } = require('ring-client-api');
  const { storageDir, makeLogger } = require('../lib/red-helpers');
  const { loadToken, saveToken } = require('../lib/ring-token-store');

  function RingAccountNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const dir = storageDir(RED);
    const logger = makeLogger(node);

    const persistedToken = loadToken(dir, node.id);
    const configuredToken = node.credentials && node.credentials.refreshToken;
    const refreshToken = persistedToken || configuredToken;

    if (!refreshToken) {
      node.error('No Ring refresh token configured. Set one in the node config.');
      return;
    }

    node.ringApi = new RingApi({ refreshToken });

    node.ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
      saveToken(dir, node.id, newRefreshToken);
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
      done();
    });
  }

  RED.nodes.registerType('ring-account', RingAccountNode, {
    credentials: { refreshToken: { type: 'password' } },
  });
};
