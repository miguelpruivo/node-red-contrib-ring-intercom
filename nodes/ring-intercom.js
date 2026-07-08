'use strict';

module.exports = function (RED) {
  const { RingCamera } = require('ring-client-api');
  const { isUnlockCommand, buildLockStateMessage, buildDingMessage, LOCK_STATE } = require('../lib/ring-messages');
  const { findNewDings, filterDingsMissedByPush } = require('../lib/ring-events');

  const RESECURE_DELAY_MS = 5000;
  // Watchdog only: dings are delivered realtime via push (onDing). This poll
  // of Ring's event-history REST endpoint exists solely to catch anything
  // push drops, so a ding is delayed at most one interval instead of lost.
  const WATCHDOG_POLL_INTERVAL_MS = 15000;
  const PUSH_DING_RETENTION_MS = 5 * 60 * 1000;

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

    let unsubscribeDing = null;
    let unsubscribeUnlocked = null;
    let watchdogTimer = null;
    let lastSeenDingEventId = null;
    let pushDingTimes = [];

    function startDingWatchdog(intercom) {
      watchdogTimer = setInterval(async () => {
        try {
          // RingCamera.getEvents() is a generic REST call keyed off
          // this.id/this.data.location_id/this.restClient, all present on a
          // real RingIntercom instance -- no patching needed.
          const { events } = await RingCamera.prototype.getEvents.call(intercom, {});
          const { newDings, latestEventId } = findNewDings(events, lastSeenDingEventId);
          lastSeenDingEventId = latestEventId;
          const missedDings = filterDingsMissedByPush(newDings, pushDingTimes);
          for (const ding of missedDings) {
            node.warn(
              `Realtime push missed a ding on ${intercom.name} (event ${ding.event_id}, ${ding.created_at}); ` +
                'delivered via fallback polling instead. Push is not healthy -- see the Troubleshooting section of the README.',
            );
            node.status({ fill: 'yellow', shape: 'dot', text: 'ding via fallback -- push unhealthy' });
            node.send(buildDingMessage());
          }
        } catch (err) {
          node.warn(`Ding watchdog poll failed: ${err.message}`);
        }
      }, WATCHDOG_POLL_INTERVAL_MS);
    }

    node.intercomReady = account
      .getIntercom(config.deviceId)
      .then((intercom) => {
        if (!intercom) {
          node.error(`Ring intercom ${config.deviceId} not found on this account`);
          return null;
        }

        // Realtime path: Ring pushes an IntercomDing notification over FCM to
        // the account's shared push receiver the moment the button is pressed.
        // (The RingIntercom constructor auto-subscribes only when the device
        // reports itself unsubscribed; this explicit call re-asserts the
        // server-side subscription on every deploy, and is idempotent.)
        intercom.subscribeToDingEvents().catch((err) => {
          node.warn(`Failed to subscribe to ding events: ${err.message}`);
        });
        const dingSub = intercom.onDing.subscribe(() => {
          const now = Date.now();
          pushDingTimes = [...pushDingTimes.filter((t) => now - t < PUSH_DING_RETENTION_MS), now];
          node.log(`DING received (realtime push) for ${intercom.name}`);
          node.status({ fill: 'blue', shape: 'dot', text: `ding ${new Date(now).toLocaleTimeString()}` });
          node.send(buildDingMessage());
        });
        unsubscribeDing = () => dingSub.unsubscribe();

        startDingWatchdog(intercom);
        node.status({ fill: 'green', shape: 'dot', text: 'listening (push + watchdog)' });
        node.log(
          `Listening for realtime ding push events on ${intercom.name} (id: ${intercom.id}), ` +
            `with a ${WATCHDOG_POLL_INTERVAL_MS / 1000}s event-history watchdog as fallback`,
        );

        // Best-effort: catches unlocks triggered from elsewhere (e.g. the Ring
        // app). Not relied on for our own unlock() calls below -- we emit lock
        // state ourselves on unlock() so feedback never depends on push.
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
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
      }
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
