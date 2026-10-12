const config = require('./config');
const bubble = require('./bubble');
const { summarise } = require('./shift');
const { sign } = require('./token');
const { normalizePhone, firstWord } = require('./util');
const { zonedToUtc, partsIn, HOUR, MIN } = require('./time');

const F = config.fields;

const NOT_FOUND_MESSAGE =
  "Sorry, I can't see a shift you're currently on. If that doesn't look right, please call Paul.";
const NOT_FOUND_CHECKIN_MESSAGE =
  "Sorry, I can't see a shift you're about to start. If that doesn't look right, please call Paul.";

// This phone number's carer's shifts (yesterday to tomorrow) that pass `keep`, with the carer's first name.
async function shiftsForPhone(rawPhone, nowMs, keep) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return [];

  const p = partsIn(nowMs, config.tz);
  const from = new Date(zonedToUtc(p.y, p.m, p.d - 1, 0, 0, config.tz) - HOUR).toISOString();
  const to = new Date(zonedToUtc(p.y, p.m, p.d + 1, 0, 0, config.tz) + HOUR).toISOString();
  const raw = await bubble.listShiftsBetween(from, to);

  const open = raw.map(summarise).filter((s) => s && s.carerId && !s.cancelled && s.window && keep(s));

  // Look up each distinct carer once, a few at a time.
  const carerIds = [...new Set(open.map((s) => s.carerId))];
  const matched = new Map(); // carerId -> first name
  for (let i = 0; i < carerIds.length; i += 5) {
    await Promise.all(
      carerIds.slice(i, i + 5).map(async (id) => {
        const user = await bubble.getUser(id);
        if (normalizePhone(bubble.get(user, F.userPhone)) === phone) {
          matched.set(id, firstWord(bubble.get(user, F.userFirstName)));
        }
      })
    );
  }

  return open.filter((s) => matched.has(s.carerId)).map((s) => ({ shift: s, firstName: matched.get(s.carerId) }));
}

// Find the shift this phone number's carer is on right now and has not checked out of.
// Shifts they have checked in to are preferred, otherwise a shift that is in progress by the roster.
async function findOpenShift(rawPhone, nowMs = Date.now()) {
  const mine = await shiftsForPhone(
    rawPhone,
    nowMs,
    (s) => !s.attendEnd && nowMs >= s.window.start - 60 * MIN && nowMs <= s.window.end + 3 * HOUR
  );
  if (!mine.length) return null;
  mine.sort(
    (a, b) =>
      Number(Boolean(b.shift.attendStart)) - Number(Boolean(a.shift.attendStart)) || b.shift.window.start - a.shift.window.start
  );
  return mine[0];
}

// Find the shift this phone number's carer is about to start (or has started) and has not checked in to.
// Starts within the next hour, or already running and not finished. Closest start wins.
async function findUpcomingShift(rawPhone, nowMs = Date.now()) {
  const mine = await shiftsForPhone(
    rawPhone,
    nowMs,
    (s) => !s.attendStart && nowMs >= s.window.start - 60 * MIN && nowMs <= s.window.end
  );
  if (!mine.length) return null;
  mine.sort((a, b) => Math.abs(a.shift.window.start - nowMs) - Math.abs(b.shift.window.start - nowMs));
  return mine[0];
}

// The text Klarra sends back. found=false means there was no shift to check out of.
async function buildReply(rawPhone, nowMs = Date.now()) {
  const hit = await findOpenShift(rawPhone, nowMs);
  if (!hit) return { found: false, message: NOT_FOUND_MESSAGE };
  const { shift, firstName } = hit;
  const expSec = Math.floor((shift.window.end + 24 * HOUR) / 1000);
  const token = sign(config.linkSecret, shift.id, 'out', expSec);
  const link = `${config.publicBaseUrl}/c/${token}`;
  const hi = firstName ? `Hi ${firstName}` : 'Hi';
  return {
    found: true,
    shiftId: shift.id,
    message: `${hi}, no worries. Here is your check out link: ${link}`,
  };
}

// Same idea for a carer who texts to get their check in link.
async function buildCheckinReply(rawPhone, nowMs = Date.now()) {
  const hit = await findUpcomingShift(rawPhone, nowMs);
  if (!hit) return { found: false, message: NOT_FOUND_CHECKIN_MESSAGE };
  const { shift, firstName } = hit;
  const expSec = Math.floor((shift.window.start + 6 * HOUR) / 1000);
  const token = sign(config.linkSecret, shift.id, 'in', expSec);
  const link = `${config.publicBaseUrl}/c/${token}`;
  const hi = firstName ? `Hi ${firstName}` : 'Hi';
  return {
    found: true,
    shiftId: shift.id,
    message: `${hi}, no worries. Here is your check in link: ${link}`,
  };
}

const ALREADY_IN_MESSAGE = "You're already checked in. When you're done, text me and I'll send your check out link.";

// One entry point for any carer text. intent: 'checkin' | 'checkout' | 'auto'.
// 'auto' picks by shift state: checked in and not out -> check out link; about to start -> check in link;
// finished recently and not checked out -> check out link. found=false means no shift matched the number.
async function buildSmartReply(rawPhone, intent, nowMs = Date.now()) {
  if (intent === 'checkout') return buildReply(rawPhone, nowMs);
  if (intent === 'checkin') {
    const r = await buildCheckinReply(rawPhone, nowMs);
    if (r.found) return r;
    const open = await findOpenShift(rawPhone, nowMs);
    if (open && open.shift.attendStart) return { found: true, shiftId: open.shift.id, message: ALREADY_IN_MESSAGE };
    return r;
  }
  const open = await findOpenShift(rawPhone, nowMs);
  if (open && open.shift.attendStart) return buildReply(rawPhone, nowMs);
  const up = await buildCheckinReply(rawPhone, nowMs);
  if (up.found) return up;
  if (open) return buildReply(rawPhone, nowMs);
  return { found: false, message: NOT_FOUND_MESSAGE };
}

module.exports = {
  buildSmartReply,
  ALREADY_IN_MESSAGE,
  findOpenShift,
  findUpcomingShift,
  buildReply,
  buildCheckinReply,
  NOT_FOUND_MESSAGE,
  NOT_FOUND_CHECKIN_MESSAGE,
};
