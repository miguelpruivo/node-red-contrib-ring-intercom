# Ring Intercom → Node-RED / NRCHKB design

Date: 2026-07-06

## Problem

The user has a Ring Intercom (video-capable — receives audio/video, unlocks a shared
building door). The existing `dgreif/ring` Homebridge plugin controls lock/unlock but
does not expose video for this device. The user runs Node-RED with NRCHKB
(`node-red-contrib-homekit-bridged`) to expose devices to Apple HomeKit, and wants a
native Node-RED integration for the intercom — including video, if that's actually
possible.

NRCHKB's camera node does not take video via flow messages: it takes a static ffmpeg
source string configured once on the node (e.g.
`-i rtsp://admin:password@IP:554/cam/realmonitor?channel=1&subtype=0`, the user's known-
working example format). Ring has no such static RTSP endpoint — its live view is a
cloud-negotiated WebRTC session (`ring-client-api`'s `createSipSession`/`streamVideo`),
which is why `dgreif/ring` can unlock the door but can't just hand NRCHKB a URL.

## Sequencing (user-confirmed: video feasibility first)

Video is the part the user cares about most and is also the only genuinely uncertain
part technically, so it is validated **before** any Node-RED code is written — including
before Phase 1 (lock/unlock), even though Phase 1 itself is low-risk.

1. **Spike (this comes first):** a standalone Node.js script (not a Node-RED node, not
   part of the eventual package's shipped code) that authenticates via `ring-client-api`
   and attempts to open a live-view WebRTC session against the user's actual Intercom
   device object — the same call path `ring-client-api` uses for Ring doorbell/camera
   devices. Confirms whether Ring's backend permits this for an Intercom, independent of
   whether `dgreif/ring`'s Homebridge plugin happens to wire it up.
   - Prior art establishing this is *possible in principle*: `cmos486/ring-intercom-video`
     (a Home Assistant custom component) streams Intercom video by reusing Ring's
     existing WebRTC camera-streaming methods against the intercom's device class — via a
     different library (`python-ring-doorbell`), so it doesn't prove `ring-client-api`
     supports it, only that Ring's cloud side does.
   - Read-only: the spike must not need to actually unlock the door to prove video works
     (starting a live-view session is separate from triggering unlock).
   - Exit criteria: either we get a decodable video/RTP stream from the session, or we
     conclusively hit a hard block (e.g. Ring's API rejects the session type for this
     device class) and record why.

2. **If the spike succeeds** — build the video relay: `ring-client-api` negotiates the
   WebRTC session, hands it to **go2rtc** (a single static-binary WebRTC↔RTSP bridge,
   already the standard tool `ring-mqtt` uses to bridge regular Ring cameras to RTSP) to
   republish as a fixed local `rtsp://127.0.0.1:8554/ring-intercom`. The user pastes that
   URL once into NRCHKB's camera node config — same field, same format as their Dahua
   example. This becomes part of the package (likely a `ring-camera` node or an
   account-managed background relay process — exact shape decided at plan time based on
   what the spike learns about session lifetime/keep-alive behavior).

3. **If the spike fails** — documented as a hard limitation on Ring's side. Video is
   dropped from scope. Phase 1 below still ships and stands alone as fully useful.

4. **Phase 1 — control + events.** New standalone package
   `node-red-contrib-ring-intercom`, structured like the user's existing
   `node-red-contrib-lg` (thin `nodes/*.js` + `.html` wrapping logic in `lib/`,
   `node:test` unit tests, env-gated **read-only** live smoke script — the smoke test
   must never trigger a real unlock or it'll unlock the user's actual building door).

   - **`ring-account`** (config node): holds a Ring refresh token, generated once by the
     user via `ring-client-api`'s official auth CLI (same flow as their existing
     Homebridge setup). Persists/refreshes it to
     `<userDir>/node-red-contrib-ring-intercom/ring-<id>.token`. Creates one shared
     `RingApi` instance; discovers locations/devices for the editor's device picker.
   - **`ring-intercom`** (in+out node): one per physical intercom device.
     - Input: `{ payload: { LockTargetState: 0 } }` — literally NRCHKB's own Lock
       Mechanism output shape (HAP enum: 0=unsecured, 1=secured), confirmed against the
       NRCHKB wiki. Wire `NRCHKB Lock` node output straight into this node's input; no
       translation layer needed. `LockTargetState: 0` triggers Ring's unlock call.
     - Output: `{ payload: { LockCurrentState: 0 } }` immediately, then
       `{ payload: { LockCurrentState: 1 } }` after Ring's unlock pulse ends — wire back
       into the NRCHKB Lock node's input to reflect state in the Home app. Also emits
       `{ payload: { ProgrammableSwitchEvent: 0 }, event: 'ding' }` on a doorbell ring
       (wire to an NRCHKB Doorbell node) and `{ payload: { MotionDetected: true/false } }`
       if/when the device reports motion capability.
     - `msg.event` tags every output (`ding` / `motion` / `lock`), following the
       `lg-tv`/`lg-ac` convention of one output port with a discriminator field.

## Out of scope

- Ring alarm, lighting, or other non-Intercom device types (already covered by
  `dgreif/ring`'s Homebridge plugin, which the user keeps using for those).
- Two-way audio.
- Historical/recorded video (motion clip playback) — live view only.

## Testing

- `node:test` unit tests for `lib/` (device-list parsing, unlock-command building,
  HAP state-mapping), no network — mirrors `node-red-contrib-lg`'s pattern.
- A "node-load" test loading each node module against a minimal Node-RED mock.
- One env-gated, **explicitly read-only** live smoke script: auth + device list +
  status/battery read. It must never call the unlock method — doing so during an
  automated test run would unlock the user's real building door.

## Reference implementations

- `dgreif/ring` (`ring-client-api` package) — Ring auth, device model, existing
  WebRTC/SIP live-view implementation for cameras/doorbells.
- `cmos486/ring-intercom-video` — proof that Ring's backend allows WebRTC live view
  against an Intercom-class device, via a different client library.
- `tsightler/ring-mqtt` — reference for using `go2rtc` as the WebRTC→RTSP bridge for
  Ring cameras.
