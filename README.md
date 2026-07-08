# node-red-contrib-ring-intercom

Node-RED nodes for a Ring Intercom: unlock control and ding events, shaped to
plug straight into [NRCHKB](https://github.com/NRCHKB/node-red-contrib-homekit-bridged)
nodes for HomeKit exposure. No video (see project docs for why).

## Nodes

- **ring-account** (config): holds a Ring refresh token and the shared API client.
  Generate a **dedicated** token once with `npx -p ring-client-api ring-auth-cli`
  (do not reuse the token from homebridge or any other install -- see
  Troubleshooting).
- **ring-intercom** (in+out): one per physical intercom.
  - Input: `{ payload: { LockTargetState: 0 } }` triggers unlock (same shape as
    NRCHKB's Lock Mechanism node output -- wire it directly).
  - Output: `{ payload: { LockCurrentState } }` (`msg.event: 'lock'`) and
    `{ payload: { ProgrammableSwitchEvent: 0 } }` (`msg.event: 'ding'`).

## How dings are delivered

Dings arrive **in realtime** via Ring's push notification channel (FCM), the
same mechanism the Ring app and homebridge-ring use: the account node's shared
`RingApi` registers one push receiver, and `ring-intercom` subscribes to the
device's `onDing` stream.

A 15-second event-history poll runs behind push purely as a **watchdog**: any
ding that push already delivered is recognised (by event timestamp) and
suppressed; a ding that push *missed* is still emitted -- at most 15s late,
never lost -- together with a loud warning that push is unhealthy.

## Troubleshooting realtime push

If dings only ever arrive via the fallback (yellow node status, "push missed a
ding" warnings), work through these in order:

1. **Use a dedicated refresh token.** A token copied from another install
   (e.g. homebridge-ring) is a base64 "wrapped" token embedding that install's
   hardware id and FCM push credentials; two installs sharing it invalidate
   each other's sessions and steal each other's push registration. This package
   strips the wrapper defensively, but the underlying OAuth token is still
   shared -- generate a fresh one with `npx -p ring-client-api ring-auth-cli`.
2. **Avoid duplicate push receivers.** The account node keeps one `RingApi`
   alive across redeploys precisely so only one FCM socket exists per account.
   Restart Node-RED fully after upgrading this package so no receiver from an
   old version lingers (`ring-client-api` never closes its push socket, so a
   full deploy on the old version leaks one per deploy).
3. **Enable "Verbose Ring logging"** on the ring-account node and redeploy.
   Push-subsystem failures then show in the Node-RED log prefixed `[ring]`:
   - `PHONE_REGISTRATION_ERROR` -- FCM registration is failing. It is retried
     5 times, then the library gives up until the next restart. If it persists,
     delete `<userDir>/node-red-contrib-ring-intercom/ring-<node-id>.token` and
     re-paste your token so a fresh push identity is registered.
   - `Connection to the push notification server has failed` -- outbound
     TCP/5228 to `mtalk.google.com` is blocked (firewall/IDS/DNS adblock).
     Allow it; push cannot work without it.
4. **Check the device subscription.** `ring-intercom` re-asserts the
   server-side ding subscription on every deploy; a warning
   `Failed to subscribe to ding events` means Ring rejected it -- check the
   account has full access to the intercom (shared users can lack event
   access).

## Testing

- `npm test` -- unit + node-load tests, no network.
- `npm run smoke:ring` -- env-gated, read-only live check (`RING_REFRESH_TOKEN`
  or a gitignored `test/.token` file). Never calls unlock.
