'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findNewDings } = require('../lib/ring-events');

const events = [
  { event_id: '3', event_type: 'ding', created_at: '2026-07-07T15:00:00Z' },
  { event_id: '2', event_type: 'ding', created_at: '2026-07-07T14:00:00Z' },
  { event_id: 'motion-1', event_type: 'motion', created_at: '2026-07-07T13:30:00Z' },
  { event_id: '1', event_type: 'ding', created_at: '2026-07-07T13:00:00Z' },
];

test('first poll establishes a baseline without reporting any dings', () => {
  const result = findNewDings(events, null);
  assert.deepStrictEqual(result.newDings, []);
  assert.strictEqual(result.latestEventId, '3');
});

test('reports dings newer than the last seen one, oldest first', () => {
  const result = findNewDings(events, '1');
  assert.deepStrictEqual(
    result.newDings.map((e) => e.event_id),
    ['2', '3'],
  );
  assert.strictEqual(result.latestEventId, '3');
});

test('reports nothing new when lastSeenEventId is already the newest', () => {
  const result = findNewDings(events, '3');
  assert.deepStrictEqual(result.newDings, []);
  assert.strictEqual(result.latestEventId, '3');
});

test('ignores non-ding events entirely', () => {
  const result = findNewDings(events, '2');
  assert.deepStrictEqual(
    result.newDings.map((e) => e.event_id),
    ['3'],
  );
});

test('falls back to reporting only the newest when lastSeenEventId scrolled out of the page', () => {
  const result = findNewDings(events, 'no-longer-in-the-page');
  assert.deepStrictEqual(
    result.newDings.map((e) => e.event_id),
    ['3'],
  );
  assert.strictEqual(result.latestEventId, '3');
});

test('handles an empty events list', () => {
  const result = findNewDings([], null);
  assert.deepStrictEqual(result.newDings, []);
  assert.strictEqual(result.latestEventId, null);
});
