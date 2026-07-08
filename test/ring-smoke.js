'use strict';

// Read-only smoke check: auth + list locations/intercoms + battery/online
// status. Never calls unlock() or subscribeToDingEvents() -- this is meant to
// be safe to run repeatedly without side effects on the real device.
//
// Usage:
//   RING_REFRESH_TOKEN=<token> npm run smoke:ring
// or put the token in a gitignored test/.token file (one line).

const { RingApi } = require('ring-client-api');
const fs = require('fs');
const path = require('path');

const tokenFile = path.join(__dirname, '.token');
const refreshToken = fs.existsSync(tokenFile)
  ? fs.readFileSync(tokenFile, 'utf8').trim()
  : process.env.RING_REFRESH_TOKEN;

if (!refreshToken) {
  console.error('Put your refresh token in test/.token (gitignored) or set RING_REFRESH_TOKEN.');
  process.exit(1);
}

async function main() {
  const ringApi = new RingApi({ refreshToken });
  const locations = await ringApi.getLocations();

  for (const location of locations) {
    console.log(`Location: ${location.name}`);
    for (const intercom of location.intercoms) {
      console.log(
        `  Intercom: ${intercom.name} (id: ${intercom.id}, offline: ${intercom.isOffline}, battery: ${intercom.batteryLevel})`,
      );
    }
    if (location.intercoms.length === 0) {
      console.log('  (no intercoms on this location)');
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Smoke check failed:', err.message);
  process.exit(1);
});
