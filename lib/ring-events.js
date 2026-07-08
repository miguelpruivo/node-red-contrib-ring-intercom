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

module.exports = { findNewDings };
