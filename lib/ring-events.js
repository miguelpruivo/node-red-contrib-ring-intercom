'use strict';

// Given the event history page returned by Ring's REST API (newest first,
// confirmed live) and the last ding event_id we already reported, returns any
// ding events that are new since then. Pure so it's testable without a live
// account.
function findNewDings(events, lastSeenEventId) {
  const dingEvents = events.filter((e) => e.event_type === 'ding');
  const latestEventId = dingEvents.length ? dingEvents[0].event_id : lastSeenEventId ?? null;

  if (!lastSeenEventId) {
    // First poll: establish a baseline, don't replay history as if it just happened.
    return { newDings: [], latestEventId };
  }

  const lastSeenIndex = dingEvents.findIndex((e) => e.event_id === lastSeenEventId);
  if (lastSeenIndex === -1) {
    // lastSeenEventId scrolled out of the returned page (long gap between
    // polls). Report only the newest instead of replaying a flood of
    // already-seen historical dings.
    return { newDings: dingEvents.length ? [dingEvents[0]] : [], latestEventId };
  }

  const newDings = dingEvents.slice(0, lastSeenIndex).reverse();
  return { newDings, latestEventId };
}

// Push delivers a ding the instant the button is pressed; the event-history
// watchdog poll then sees the same ding up to one poll interval later. A
// history ding whose created_at falls within this window of a push-delivered
// ding is the same physical press and must not be emitted twice.
const PUSH_DEDUP_WINDOW_MS = 30000;

// Returns the dings from the watchdog poll that push did NOT already deliver,
// i.e. the ones that must be emitted late (and reported as a push failure).
function filterDingsMissedByPush(dings, pushDingTimesMs, windowMs = PUSH_DEDUP_WINDOW_MS) {
  return dings.filter((ding) => {
    const eventTime = new Date(ding.created_at).getTime();
    return !pushDingTimesMs.some((pushTime) => Math.abs(pushTime - eventTime) <= windowMs);
  });
}

module.exports = { findNewDings, filterDingsMissedByPush, PUSH_DEDUP_WINDOW_MS };
