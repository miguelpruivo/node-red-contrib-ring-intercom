'use strict';

module.exports = function (RED) {
  const { isUnlockCommand, buildLockStateMessage, buildDingMessage, LOCK_STATE } = require('../lib/ring-messages');

  const RESECURE_DELAY_MS = 5000;

  function RingIntercomNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const account = RED.nodes.getNode(config.account);

    if (!account) {
      node.error('No ring-account configured');
      return;
    }

    let unsubscribeDing = null;
    let unsubscribeUnlocked = null;

    node.intercomReady = account
      .getIntercom(config.deviceId)
      .then((intercom) => {
        if (!intercom) {
          node.error(`Ring intercom ${config.deviceId} not found on this account`);
          return null;
        }

        intercom.subscribeToDingEvents();
        const dingSub = intercom.onDing.subscribe(() => {
          node.send(buildDingMessage());
        });
        unsubscribeDing = () => dingSub.unsubscribe();

        const unlockedSub = intercom.onUnlocked.subscribe(() => {
          node.send(buildLockStateMessage(LOCK_STATE.UNSECURED));
          setTimeout(() => {
            node.send(buildLockStateMessage(LOCK_STATE.SECURED));
          }, RESECURE_DELAY_MS);
        });
        unsubscribeUnlocked = () => unlockedSub.unsubscribe();

        return intercom;
      })
      .catch((err) => {
        node.error(`Failed to resolve Ring intercom: ${err.message}`);
        return null;
      });

    node.on('input', async (msg, send, done) => {
      const intercom = await node.intercomReady;
      if (!intercom) {
        done('Ring intercom not ready');
        return;
      }
      if (isUnlockCommand(msg)) {
        try {
          await intercom.unlock();
          done();
        } catch (err) {
          done(err);
        }
        return;
      }
      done();
    });

    node.on('close', (done) => {
      if (unsubscribeDing) {
        unsubscribeDing();
      }
      if (unsubscribeUnlocked) {
        unsubscribeUnlocked();
      }
      done();
    });
  }

  RED.nodes.registerType('ring-intercom', RingIntercomNode);
};
