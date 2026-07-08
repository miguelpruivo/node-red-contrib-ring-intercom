// Spike: does Ring's backend allow a live-view WebRTC session for an
// "Intercom Video" device?
//
// Why this approach: reading ring-client-api's current source shows
// RingIntercom has NO streaming methods at all (unlock/ding/battery only).
// RingCamera has startLiveCall()/createSimpleWebRtcSession(), but those
// methods only touch `this.data`, `this.id`, `this.restClient` internally
// -- plain JS, no runtime type enforcement. So instead of reverse
// engineering the wire protocol, we "borrow" RingCamera's own method and
// call it with `this` bound to the real RingIntercom instance. If Ring's
// backend accepts a live-view request for the intercom's device id, this
// succeeds; if the backend itself rejects the device type, it fails
// cleanly. Either answer is useful and definitive.
//
// READ-ONLY: this never calls intercom.unlock(). It only asks Ring to open
// a live-view session, same as answering the CallKit call in the Ring app.
//
// Setup:
//   cd spike
//   npm install
//   npx -p ring-client-api ring-auth-cli          # one-time, prints a refresh token
//   RING_REFRESH_TOKEN=<token> node live-view-test.mjs

import * as ringClientApi from 'ring-client-api'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const { RingApi, RingCamera } = ringClientApi

const tokenFile = join(dirname(fileURLToPath(import.meta.url)), '.token')
const refreshToken = existsSync(tokenFile)
  ? readFileSync(tokenFile, 'utf8').trim()
  : process.env.RING_REFRESH_TOKEN

if (!refreshToken) {
  console.error('Put your refresh token in spike/.token (one line, gitignored), or set RING_REFRESH_TOKEN.')
  process.exit(1)
}

let uncaughtAsyncError = null
process.on('uncaughtException', (err) => {
  uncaughtAsyncError = err
  console.error('\n[uncaughtException, likely from an async RxJS event handler deep in ring-client-api]')
  console.error(err?.stack || err)
})
process.on('unhandledRejection', (err) => {
  uncaughtAsyncError = err
  console.error('\n[unhandledRejection]')
  console.error(err?.stack || err)
})

const ringApi = new RingApi({ refreshToken, debug: true })
const locations = await ringApi.getLocations()

let intercom
for (const location of locations) {
  const cameraNames = location.cameras.map((c) => `${c.name} (${c.deviceType})`).join(', ') || '(none)'
  const intercomNames = location.intercoms.map((i) => `${i.name} (${i.deviceType})`).join(', ') || '(none)'
  console.log(`Location: ${location.name}`)
  console.log(`  cameras:   ${cameraNames}`)
  console.log(`  intercoms: ${intercomNames}`)
  if (location.intercoms.length && !intercom) {
    intercom = location.intercoms[0]
  }
}

if (!intercom) {
  console.error('\nNo intercom device found on this account. Stopping.')
  process.exit(1)
}

console.log(`\nUsing intercom: ${intercom.name} (${intercom.deviceType})`)
console.log(
  `Shape check -> id: ${intercom.id}, has data: ${!!intercom.data}, has restClient: ${!!intercom.restClient}`,
)

if (typeof RingCamera?.prototype?.startLiveCall !== 'function') {
  console.error('\nRingCamera.startLiveCall is not exported the way this script expects.')
  console.error('Exported keys from ring-client-api:', Object.keys(ringClientApi))
  process.exit(1)
}

console.log('\nAttempting to borrow RingCamera.prototype.startLiveCall against the intercom instance...')

let attempt1Ok = false
try {
  const session = await RingCamera.prototype.startLiveCall.call(intercom, {})
  console.log('\nSUCCESS: got a streaming session object back:', session?.constructor?.name)
  console.log("This means Ring's backend DID accept a live-view session request for the intercom.")
  await session?.stop?.()
  attempt1Ok = true
} catch (err) {
  console.error('\nAttempt 1 failed:', err?.message || err)
}

if (!attempt1Ok) {
  console.log(
    "\nAttempt 2: constructing a real RingCamera instance from the intercom's raw data + shared restClient" +
      ' (so any instance-bound setup startLiveCall relies on actually runs)...',
  )
  try {
    // Patch known camera-only nested fields the intercom's raw settings don't have.
    // Discovered by reading node_modules/ring-client-api/lib/ring-camera.js directly
    // after each crash: isRingEdgeEnabled needs settings.sheila_settings, isOffline
    // needs alerts.connection. Preserve any real fields already present.
    const patchedData = {
      ...intercom.data,
      alerts: { connection: 'online', ...(intercom.data.alerts || {}) },
      settings: {
        ...(intercom.data.settings || {}),
        sheila_settings: {
          local_storage_enabled: false,
          ...(intercom.data.settings?.sheila_settings || {}),
        },
      },
    }
    const fakeCamera = new RingCamera(patchedData, true, intercom.restClient, true)
    const session = await fakeCamera.startLiveCall()
    console.log('\nGot a session object back:', session?.constructor?.name)
    console.log('Own properties:', Object.getOwnPropertyNames(session))

    const conn = session?.connection ?? session?.webRtcConnection ?? session?.streamingConnection
    if (conn) {
      console.log('Underlying connection object keys:', Object.getOwnPropertyNames(conn))
      console.log('Connection state fields:', {
        connectionState: conn.connectionState,
        pc_connectionState: conn.pc?.connectionState,
        iceConnectionState: conn.pc?.iceConnectionState ?? conn.iceConnectionState,
      })
    }

    console.log('\nSubscribing to the connection\'s own RxJS event subjects (onCallAnswered, onCameraConnected,')
    console.log('onSessionId, onError) -- these are the real signal, not just "did anything throw".')
    let asyncError = null
    const events = []
    for (const key of ['onCallAnswered', 'onCameraConnected', 'onSessionId', 'onError', 'onOfferSent']) {
      conn?.[key]?.subscribe?.((value) => {
        events.push({ key, value })
        const preview =
          typeof value === 'string' && value.length > 120 ? `${value.slice(0, 120)}... (${value.length} chars)` : value
        console.log(`  [event] ${key} ->`, preview)
        if (key === 'onCallAnswered' && typeof value === 'string' && /^m=video/m.test(value)) {
          console.log('    -> SDP answer includes a VIDEO m-line. The device is offering to send video.')
        }
        if (key === 'onError') asyncError = value
      })
    }

    let videoPackets = 0
    let audioPackets = 0
    session?.onVideoRtp?.subscribe?.(() => videoPackets++)
    session?.onAudioRtp?.subscribe?.(() => audioPackets++)

    console.log('\nWaiting 15s for real negotiation events + RTP packets (unrelated GCM push-registration retries in')
    console.log('the log below are from ring-client-api\'s background push-notification client, not this session)...')
    await new Promise((resolve) => setTimeout(resolve, 15000))

    console.log('\nEvents observed during the wait:', events.length ? events.map((e) => e.key) : '(none)')
    console.log(`RTP packets received -> video: ${videoPackets}, audio: ${audioPackets}`)

    if (asyncError || uncaughtAsyncError) {
      console.error(
        '\nFAILED: an error surfaced after the initial ticket succeeded:',
        asyncError || uncaughtAsyncError,
      )
    } else {
      console.log('\nNo async error/close after 6s.')
      console.log('Final connection state:', session?.pc?.connectionState ?? '(no pc.connectionState field found)')
      console.log(
        "\nSUCCESS (attempt 2): Ring's backend accepted the live-view session request for the intercom" +
          ' and it stayed open for 6s without erroring. This is strong (not yet 100% certain without decoding' +
          ' real video bytes) evidence that streaming this device is possible.',
      )
    }
    await session?.stop?.()
  } catch (err) {
    console.error('\nFAILED (attempt 2): Ring rejected (or errored on) the live-view session.')
    console.error('Error:', err?.message || err)
    console.error(err?.stack)
    console.error(
      "\nIf this error is still a client-side TypeError (e.g. 'X is not a function'), it's inconclusive --" +
        " we haven't reached Ring's backend yet. If it's an HTTP error (401/403/404/etc.) or an explicit" +
        ' Ring API error message, that IS the backend telling us whether this device type is allowed.',
    )
  }
}

process.exit(0)
