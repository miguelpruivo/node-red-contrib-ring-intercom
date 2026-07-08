'use strict';

module.exports = function (RED) {
  const { RingCamera } = require('ring-client-api');
  const { isUnlockCommand, buildLockStateMessage, buildDingMessage, LOCK_STATE } = require('../lib/ring-messages');
  const { findNewDings } = require('../lib/ring-events');

  const RESECURE_DELAY_MS = 5000;
  const DING_POLL_INTERVAL_MS = 15000;

  function RingIntercomNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const account = RED.nodes.getNode(config.account);

    if (!account) {
      node.error('No ring-account configured');
      return;
    }

    function emitUnlockedThenResecure() {
      node.send(buildLockStateMessage(LOCK_STATE.UNSECURED));
      setTimeout(() => {
        node.send(buildLockStateMessage(LOCK_STATE.SECURED));
      }, RESECURE_DELAY_MS);
    }

    let unsubscribeUnlocked = null;
    let dingPollTimer = null;
    let lastSeenDingEventId = null;

    function startDingPolling(intercom) {
      dingPollTimer = setInterval(async () => {
        try {
          // RingCamera.getEvents() is a generic REST call keyed off
          // this.id/this.data.location_id/this.restClient, all present on a
          // real RingIntercom instance -- no patching needed, unlike the
          // earlier video-streaming spike.
          const { events } = await RingCamera.prototype.getEvents.call(intercom, {});
          const { newDings, latestEventId } = findNewDings(events, lastSeenDingEventId);
          lastSeenDingEventId = latestEventId;
          for (const ding of newDings) {
            node.log(`DING received for ${intercom.name} (event ${ding.event_id}, ${ding.created_at})`);
            node.send(buildDingMessage());
          }
        } catch (err) {
          node.warn(`Failed to poll Ring events: ${err.message}`);
        }
      }, DING_POLL_INTERVAL_MS);
    }

    node.intercomReady = account
      .getIntercom(config.deviceId)
      .then((intercom) => {
        if (!intercom) {
          node.error(`Ring intercom ${config.deviceId} not found on this account`);
          return null;
        }

        // Ding detection polls Ring's event-history REST endpoint instead of
        // using push notifications (onDing/subscribeToDingEvents()): push
        // never fired across multiple real button presses in live testing
        // (same subsystem that logs PHONE_REGISTRATION_ERROR), while polling
        // getEvents() reliably showed the ding immediately after it happened.
        startDingPolling(intercom);
        node.log(
          `Polling Ring events for ${intercom.name} (id: ${intercom.id}) every ${DING_POLL_INTERVAL_MS / 1000}s`,
        );

        // Best-effort: catches unlocks triggered from elsewhere (e.g. the Ring
        // app). Not relied on for our own unlock() calls below -- onUnlocked is
        // push-notification-driven and can be silently delayed/dropped (the
        // same push subsystem that logs PHONE_REGISTRATION_ERROR), so it's not
        // a dependable signal for a command we just issued ourselves.
        const unlockedSub = intercom.onUnlocked.subscribe(() => {
          node.log(`onUnlocked fired for ${intercom.name}`);
          emitUnlockedThenResecure();
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
          emitUnlockedThenResecure();
          done();
        } catch (err) {
          done(err);
        }
        return;
      }
      done();
    });

    node.on('close', (done) => {
      if (dingPollTimer) {
        clearInterval(dingPollTimer);
      }
      if (unsubscribeUnlocked) {
        unsubscribeUnlocked();
      }
      done();
    });
  }

  RED.nodes.registerType('ring-intercom', RingIntercomNode);
};
