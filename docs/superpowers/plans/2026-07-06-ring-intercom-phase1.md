# Ring Intercom Phase 1 (ding + unlock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `node-red-contrib-ring-intercom`, a Node-RED package exposing a Ring
Intercom's ding event and unlock control, message-compatible with NRCHKB's Lock
Mechanism and Doorbell services, so it can be wired directly into HomeKit.

**Architecture:** Two node types mirroring the user's existing
`node-red-contrib-lg` package structure: `ring-account` (config node, holds the
`ring-client-api` `RingApi` instance + persisted/rotated refresh token) and
`ring-intercom` (in+out node, one per physical device). Protocol logic is pure
functions in `lib/`; node files are thin wrappers. No video — confirmed out of
scope for this phase (see `docs/superpowers/specs/2026-07-06-ring-intercom-nodered-design.md`).
`RingIntercom`'s real API (confirmed by reading the installed library's source
during the spike) is `onDing`, `onUnlocked`, `unlock()`, `subscribeToDingEvents()`
— no motion capability exists on this device class, so motion is dropped from
scope entirely (it was speculative in the original design doc).

**Tech Stack:** Node.js (CommonJS, `>=18`), `ring-client-api@^14.3.0`, `node:test`
for unit tests, Node-RED node API.

---

## File structure

```
node-red-contrib-ring-intercom/
  package.json
  lib/
    red-helpers.js        # storageDir(RED), makeLogger(node) -- copied pattern from node-red-contrib-lg
    ring-token-store.js    # loadToken/saveToken -- pure fs, no network
    ring-messages.js       # isUnlockCommand/buildLockStateMessage/buildDingMessage -- pure, HAP-shaped
  nodes/
    ring-account.js
    ring-account.html
    ring-intercom.js
    ring-intercom.html
  test/
    red-helpers.test.js
    ring-token-store.test.js
    ring-messages.test.js
    node-load.test.js
    ring-smoke.js           # env-gated, READ-ONLY live check, not run by `npm test`
  README.md
```

## Scope check

Single subsystem (Ring Intercom ding+unlock → Node-RED/NRCHKB), already narrowed
from the full design doc by dropping video (separate, unresolved effort — see
prior conversation) and motion (doesn't exist on this device). No further
decomposition needed.

---

### Task 1: Package scaffolding

**Files:**
- Create: `package.json`
- Create: `README.md`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "node-red-contrib-ring-intercom",
  "version": "0.1.0",
  "description": "Node-RED nodes for a Ring Intercom (unlock + ding events), message-compatible with NRCHKB.",
  "keywords": [
    "node-red",
    "ring",
    "intercom",
    "homekit",
    "nrchkb",
    "smart home"
  ],
  "license": "MIT",
  "author": "Miguel Ruivo",
  "engines": {
    "node": ">=18"
  },
  "files": [
    "nodes/",
    "lib/"
  ],
  "scripts": {
    "test": "node --test test/*.test.js",
    "smoke:ring": "node test/ring-smoke.js"
  },
  "node-red": {
    "version": ">=3.0.0",
    "nodes": {
      "ring-account": "nodes/ring-account.js",
      "ring-intercom": "nodes/ring-intercom.js"
    }
  },
  "dependencies": {
    "ring-client-api": "^14.3.0"
  }
}
```

- [ ] **Step 2: Write `README.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add package.json README.md
git commit -m "chore: scaffold node-red-contrib-ring-intercom package"
```

---

### Task 2: `lib/red-helpers.js` (storage dir + logger adapter)

**Files:**
- Create: `lib/red-helpers.js`
- Test: `test/red-helpers.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { storageDir, makeLogger } = require('../lib/red-helpers');

test('storageDir creates and returns <userDir>/node-red-contrib-ring-intercom', () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ring-'));
  const dir = storageDir({ settings: { userDir } });
  assert.strictEqual(dir, path.join(userDir, 'node-red-contrib-ring-intercom'));
  assert.ok(fs.existsSync(dir));
});

test('storageDir falls back to process.cwd() when RED has no userDir', () => {
  const dir = storageDir(null);
  assert.strictEqual(dir, path.join(process.cwd(), 'node-red-contrib-ring-intercom'));
});

test('makeLogger adapts a node-like object to debug/info/warn/error', () => {
  const calls = [];
  const node = {
    debug: (m) => calls.push(['debug', m]),
    log: (m) => calls.push(['info', m]),
    warn: (m) => calls.push(['warn', m]),
    error: (m) => calls.push(['error', m]),
  };
  const logger = makeLogger(node);
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.deepStrictEqual(calls, [
    ['debug', 'd'],
    ['info', 'i'],
    ['warn', 'w'],
    ['error', 'e'],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/red-helpers.test.js`
Expected: FAIL with `Cannot find module '../lib/red-helpers'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

function storageDir(RED) {
  const base = (RED && RED.settings && RED.settings.userDir) || process.cwd();
  const dir = path.join(base, 'node-red-contrib-ring-intercom');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makeLogger(node) {
  return {
    debug: (msg) => node.debug(msg),
    info: (msg) => node.log(msg),
    warn: (msg) => node.warn(msg),
    error: (msg) => node.error(msg),
  };
}

module.exports = { storageDir, makeLogger };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/red-helpers.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/red-helpers.js test/red-helpers.test.js
git commit -m "feat: add red-helpers (storageDir, makeLogger)"
```

---

### Task 3: `lib/ring-token-store.js` (persisted refresh token)

**Files:**
- Create: `lib/ring-token-store.js`
- Test: `test/ring-token-store.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokenFilePath, loadToken, saveToken } = require('../lib/ring-token-store');

test('tokenFilePath builds ring-<accountId>.token under the storage dir', () => {
  assert.strictEqual(tokenFilePath('/tmp/x', 'acc1'), path.join('/tmp/x', 'ring-acc1.token'));
});

test('loadToken returns null when the file does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  assert.strictEqual(loadToken(dir, 'missing'), null);
});

test('saveToken then loadToken round-trips the token, trimmed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'));
  saveToken(dir, 'acc1', 'the-token-value\n');
  assert.strictEqual(loadToken(dir, 'acc1'), 'the-token-value');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ring-token-store.test.js`
Expected: FAIL with `Cannot find module '../lib/ring-token-store'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

function tokenFilePath(storageDirPath, accountId) {
  return path.join(storageDirPath, `ring-${accountId}.token`);
}

function loadToken(storageDirPath, accountId) {
  const file = tokenFilePath(storageDirPath, accountId);
  if (!fs.existsSync(file)) {
    return null;
  }
  const contents = fs.readFileSync(file, 'utf8').trim();
  return contents || null;
}

function saveToken(storageDirPath, accountId, token) {
  fs.writeFileSync(tokenFilePath(storageDirPath, accountId), token.trim(), 'utf8');
}

module.exports = { tokenFilePath, loadToken, saveToken };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ring-token-store.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ring-token-store.js test/ring-token-store.test.js
git commit -m "feat: add ring-token-store for persisting rotated refresh tokens"
```

---

### Task 4: `lib/ring-messages.js` (HAP-shaped message builders)

**Files:**
- Create: `lib/ring-messages.js`
- Test: `test/ring-messages.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  LOCK_STATE,
  isUnlockCommand,
  buildLockStateMessage,
  buildDingMessage,
} = require('../lib/ring-messages');

test('LOCK_STATE matches the HAP LockTargetState/LockCurrentState enum', () => {
  assert.strictEqual(LOCK_STATE.UNSECURED, 0);
  assert.strictEqual(LOCK_STATE.SECURED, 1);
});

test('isUnlockCommand is true for an NRCHKB Lock Mechanism unlock message', () => {
  assert.strictEqual(isUnlockCommand({ payload: { LockTargetState: 0 } }), true);
});

test('isUnlockCommand is false for a secure/other/malformed message', () => {
  assert.strictEqual(isUnlockCommand({ payload: { LockTargetState: 1 } }), false);
  assert.strictEqual(isUnlockCommand({ payload: {} }), false);
  assert.strictEqual(isUnlockCommand({}), false);
  assert.strictEqual(isUnlockCommand(null), false);
});

test('buildLockStateMessage shapes an NRCHKB Lock Mechanism output message', () => {
  assert.deepStrictEqual(buildLockStateMessage(LOCK_STATE.UNSECURED), {
    payload: { LockCurrentState: 0 },
    event: 'lock',
  });
  assert.deepStrictEqual(buildLockStateMessage(LOCK_STATE.SECURED), {
    payload: { LockCurrentState: 1 },
    event: 'lock',
  });
});

test('buildDingMessage shapes an NRCHKB Doorbell output message', () => {
  assert.deepStrictEqual(buildDingMessage(), {
    payload: { ProgrammableSwitchEvent: 0 },
    event: 'ding',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/ring-messages.test.js`
Expected: FAIL with `Cannot find module '../lib/ring-messages'`

- [ ] **Step 3: Write minimal implementation**

```javascript
'use strict';

const LOCK_STATE = { UNSECURED: 0, SECURED: 1 };

function isUnlockCommand(msg) {
  return Boolean(msg && msg.payload && msg.payload.LockTargetState === LOCK_STATE.UNSECURED);
}

function buildLockStateMessage(state) {
  return { payload: { LockCurrentState: state }, event: 'lock' };
}

function buildDingMessage() {
  return { payload: { ProgrammableSwitchEvent: 0 }, event: 'ding' };
}

module.exports = { LOCK_STATE, isUnlockCommand, buildLockStateMessage, buildDingMessage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/ring-messages.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add lib/ring-messages.js test/ring-messages.test.js
git commit -m "feat: add ring-messages HAP-shaped builders for lock/ding events"
```

---

### Task 5: `nodes/ring-account.js` + `ring-account.html`

**Files:**
- Create: `nodes/ring-account.js`
- Create: `nodes/ring-account.html`

No new unit test here (constructing this node for real creates a live `RingApi`,
which starts network/push-notification activity immediately -- confirmed during
the spike. That must not happen during `npm test`. Task 7's node-load test only
checks the module registers its type, without instantiating it with real
credentials).

- [ ] **Step 1: Write `nodes/ring-account.js`**

```javascript
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
```

- [ ] **Step 2: Write `nodes/ring-account.html`**

```html
<script type="text/javascript">
  RED.nodes.registerType('ring-account', {
    category: 'config',
    defaults: {
      name: { value: '' },
    },
    credentials: {
      refreshToken: { type: 'password' },
    },
    label: function () {
      return this.name || 'ring-account';
    },
  });
</script>

<script type="text/html" data-template-name="ring-account">
  <div class="form-row">
    <label for="node-config-input-name"><i class="fa fa-tag"></i> Name</label>
    <input type="text" id="node-config-input-name" placeholder="Name">
  </div>
  <div class="form-row">
    <label for="node-config-input-refreshToken"><i class="fa fa-key"></i> Refresh Token</label>
    <input type="password" id="node-config-input-refreshToken" placeholder="Ring refresh token">
  </div>
</script>

<script type="text/html" data-help-name="ring-account">
  <p>Holds a Ring refresh token and creates a shared client for ring-intercom nodes.</p>
  <p>Generate a refresh token once via <code>npx -p ring-client-api ring-auth-cli</code>
     and paste it above. The token rotates automatically after that; the rotated
     value is persisted to disk, so you only need to paste it once.</p>
  <p>Check the Node-RED debug log after deploying -- this node logs the intercoms
     it finds on your account along with their device IDs.</p>
</script>
```

- [ ] **Step 3: Commit**

```bash
git add nodes/ring-account.js nodes/ring-account.html
git commit -m "feat: add ring-account config node"
```

---

### Task 6: `nodes/ring-intercom.js` + `ring-intercom.html`

**Files:**
- Create: `nodes/ring-intercom.js`
- Create: `nodes/ring-intercom.html`

Same reasoning as Task 5: no per-node unit test that instantiates this against
a real account node (would require a real `RingApi`/network). Its logic is
already unit-tested via `lib/ring-messages.js`; Task 7 covers registration only.

- [ ] **Step 1: Write `nodes/ring-intercom.js`**

```javascript
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
```

- [ ] **Step 2: Write `nodes/ring-intercom.html`**

```html
<script type="text/javascript">
  RED.nodes.registerType('ring-intercom', {
    category: 'home automation',
    color: '#3FADB5',
    defaults: {
      name: { value: '' },
      account: { value: '', type: 'ring-account', required: true },
      deviceId: { value: '', required: true },
    },
    inputs: 1,
    outputs: 1,
    icon: 'font-awesome/fa-bell',
    label: function () {
      return this.name || 'ring-intercom';
    },
  });
</script>

<script type="text/html" data-template-name="ring-intercom">
  <div class="form-row">
    <label for="node-input-name"><i class="fa fa-tag"></i> Name</label>
    <input type="text" id="node-input-name" placeholder="Name">
  </div>
  <div class="form-row">
    <label for="node-input-account"><i class="fa fa-user"></i> Account</label>
    <input type="text" id="node-input-account">
  </div>
  <div class="form-row">
    <label for="node-input-deviceId"><i class="fa fa-video-camera"></i> Device ID</label>
    <input type="text" id="node-input-deviceId" placeholder="Ring intercom device id">
  </div>
</script>

<script type="text/html" data-help-name="ring-intercom">
  <p>Wires one Ring Intercom device to Node-RED / NRCHKB.</p>
  <p><b>Input</b>: <code>{ payload: { LockTargetState: 0 } }</code> triggers
     unlock -- this is exactly NRCHKB's Lock Mechanism node's own output shape,
     so you can wire it directly.</p>
  <p><b>Output</b>: <code>{ payload: { LockCurrentState } }</code>
     (<code>msg.event: 'lock'</code>) on unlock (from this node or the Ring app),
     and <code>{ payload: { ProgrammableSwitchEvent: 0 } }</code>
     (<code>msg.event: 'ding'</code>) when the intercom is rung.</p>
  <p>Find the Device ID in the Node-RED debug log after deploying the
     ring-account node -- it logs every intercom it finds.</p>
</script>
```

- [ ] **Step 3: Commit**

```bash
git add nodes/ring-intercom.js nodes/ring-intercom.html
git commit -m "feat: add ring-intercom node (unlock input, ding/lock output)"
```

---

### Task 7: `test/node-load.test.js` (registration only, no network)

**Files:**
- Create: `test/node-load.test.js`

- [ ] **Step 1: Write the test**

```javascript
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

function makeRED() {
  const registered = {};

  const RED = {
    settings: { userDir: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-ring-')) },
    nodes: {
      createNode(node, config) {
        node.id = config.id || 'n' + Math.random().toString(16).slice(2);
        node.name = config.name;
        node.credentials = config.credentials || {};
        node.status = () => {};
        node.send = () => {};
        node.log = () => {};
        node.warn = () => {};
        node.error = () => {};
        node.debug = () => {};
        node.on = () => {};
      },
      registerType(name, ctor, opts) {
        registered[name] = { ctor, opts };
      },
      getNode() {
        return null;
      },
    },
  };

  return { RED, registered };
}

const NODE_FILES = [
  ['../nodes/ring-account.js', 'ring-account'],
  ['../nodes/ring-intercom.js', 'ring-intercom'],
];

test('all node modules register their type', () => {
  const { RED, registered } = makeRED();
  for (const [file] of NODE_FILES) {
    const mod = require(file);
    assert.strictEqual(typeof mod, 'function', `${file} exports a function`);
    mod(RED);
  }
  for (const [, type] of NODE_FILES) {
    assert.ok(registered[type], `${type} registered`);
  }
});

test('ring-account exposes a refreshToken credential type', () => {
  const { RED, registered } = makeRED();
  require('../nodes/ring-account.js')(RED);
  assert.strictEqual(registered['ring-account'].opts.credentials.refreshToken.type, 'password');
});

test('ring-intercom errors cleanly when no ring-account is configured', () => {
  const { RED, registered } = makeRED();
  require('../nodes/ring-intercom.js')(RED);
  const errors = [];
  const ctor = registered['ring-intercom'].ctor;
  const node = Object.create(ctor.prototype);
  RED.nodes.createNode(node, { id: 'i1' });
  node.error = (m) => errors.push(m);
  ctor.call(node, { id: 'i1', account: 'missing-account', deviceId: '123' });
  assert.deepStrictEqual(errors, ['No ring-account configured']);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test test/node-load.test.js`
Expected: PASS, 3 tests. (This is registration-only, so there's no separate
"run to see it fail" step -- the modules already exist from Tasks 5-6.)

- [ ] **Step 3: Commit**

```bash
git add test/node-load.test.js
git commit -m "test: add node-load registration test for both node types"
```

---

### Task 8: `test/ring-smoke.js` (env-gated, read-only live check)

**Files:**
- Create: `test/ring-smoke.js`

This is a manual, opt-in script -- never run by `npm test`. It must never call
`unlock()`.

- [ ] **Step 1: Write `test/ring-smoke.js`**

```javascript
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
```

- [ ] **Step 2: Add `test/.token` to `.gitignore`**

```bash
echo 'test/.token' >> .gitignore
```

- [ ] **Step 3: Commit**

```bash
git add test/ring-smoke.js .gitignore
git commit -m "test: add read-only live smoke check for Ring account/intercom listing"
```

---

### Task 9: Manual end-to-end verification (not automated)

**Files:** none (manual verification against the real Node-RED instance)

This task has no code -- it's the check that the whole thing actually works,
per the `verification-before-completion` principle. Do this once the physical
intercom is back online (it was charging/offline during planning).

- [ ] **Step 1: Run the smoke script to confirm the device is visible again**

```bash
RING_REFRESH_TOKEN=<fresh token> npm run smoke:ring
```

Expected: prints the "Front Entrance" intercom with `offline: false`.

- [ ] **Step 2: Link the package into a throwaway Node-RED instance**

```bash
DIR=/tmp/nr-ring-test-userdir
mkdir -p "$DIR/node_modules"
ln -s "$(pwd)" "$DIR/node_modules/node-red-contrib-ring-intercom"
npm install --prefix "$DIR" ring-client-api@^14.3.0
node-red --userDir "$DIR" --port 1881
```

- [ ] **Step 2: In the Node-RED editor (localhost:1881), add a `ring-account`**

Paste the refresh token, deploy, and check the debug/log panel for the line
`Ring intercoms found: Front Entrance (id: 732415143)` (or whatever ID the
smoke script printed).

- [ ] **Step 3: Add a `ring-intercom` node wired to a debug node**

Set its Device ID to the one just logged. Deploy. Press the physical intercom
buzzer once. Confirm the debug panel shows
`{ payload: { ProgrammableSwitchEvent: 0 }, event: 'ding' }`.

- [ ] **Step 4: Verify unlock**

Wire an inject node sending `{ payload: { LockTargetState: 0 } }` into the
`ring-intercom` node. Deploy, click inject once, confirm the physical door
unlocks and the debug panel shows `LockCurrentState: 0` then, ~5s later,
`LockCurrentState: 1`.

- [ ] **Step 5: Wire it to real NRCHKB nodes**

Replace the debug nodes with an NRCHKB Doorbell node (ding output) and an
NRCHKB Lock Mechanism node (bidirectional -- its output feeds `ring-intercom`'s
input, and `ring-intercom`'s lock-state output feeds back into it). Confirm the
Home app shows the doorbell notification and can unlock via the Lock tile.

No commit for this task -- it's verification, not code.

---

## Self-review

**Spec coverage:** ding event (Task 6, `onDing`) ✓, unlock (Task 6, `unlock()` +
`onUnlocked` feedback) ✓, NRCHKB-compatible message shapes (Task 4, verified
against the NRCHKB wiki during design) ✓, token persistence/rotation (Task 3 +
5) ✓, read-only smoke test that never unlocks (Task 8) ✓, real device
verification (Task 9). Motion and video are explicitly out of scope per the
design doc and the cost/effort discussion that followed it -- no task needed.

**Placeholder scan:** none found -- every step has complete, runnable code.

**Type consistency:** `LOCK_STATE.UNSECURED`/`SECURED` (Task 4) used
consistently in Task 6's `ring-intercom.js`. `buildDingMessage`/
`buildLockStateMessage`/`isUnlockCommand` names match between their Task 4
definition and Task 6 usage. `storageDir`/`makeLogger` (Task 2) match their
Task 5 usage. `loadToken`/`saveToken` (Task 3) match their Task 5 usage.
