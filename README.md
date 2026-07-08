# node-red-contrib-ring-intercom

Node-RED nodes for a Ring Intercom: unlock control and ding events, shaped to
plug straight into [NRCHKB](https://github.com/NRCHKB/node-red-contrib-homekit-bridged)
nodes for HomeKit exposure. No video (see project docs for why).

## Nodes

- **ring-account** (config): holds a Ring refresh token and the shared API client.
  Generate a token once with `npx -p ring-client-api ring-auth-cli`.
- **ring-intercom** (in+out): one per physical intercom.
  - Input: `{ payload: { LockTargetState: 0 } }` triggers unlock (same shape as
    NRCHKB's Lock Mechanism node output -- wire it directly).
  - Output: `{ payload: { LockCurrentState } }` (`msg.event: 'lock'`) and
    `{ payload: { ProgrammableSwitchEvent: 0 } }` (`msg.event: 'ding'`).

## Testing

- `npm test` -- unit + node-load tests, no network.
- `npm run smoke:ring` -- env-gated, read-only live check (`RING_REFRESH_TOKEN`
  or a gitignored `test/.token` file). Never calls unlock.
