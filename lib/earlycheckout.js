const config = require('./config');
const bubble = require('./bubble');
const { summarise } = require('./shift');
const { sign } = require('./token');
const { normalizePhone, firstWord } = require('./util');
const { zonedToUtc, partsIn, HOUR, MIN } = require('./time');

const F = config.fields;

const NOT_FOUND_MESSAGE =
  "Sorry, I can't see a shift you're currently on. If that doesn't look right, please call Paul or Vidhu.";

// Find the shift this phone number's carer is on right now and has not checked out of.
// Shifts they have checked in to are preferred, otherwise a shift that is in progress by the roster.
async function findOpenShift(rawPhone, nowMs = Date.now()) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;

  const p = partsIn(nowMs, config.tz);
  const from = new Date(zonedToUtc(p.y, p.m, p.d - 1, 0, 0, config.tz) - HOUR).toISOString();
  const to = new Date(zonedToUtc(p.y, p.m, p.d + 1, 0, 0, config.tz) + HOUR).toISOString();
  const raw = await bubble.listShiftsBetween(from, to);

  const open = raw
    .map(summarise)
    .filter(
      (s) =>
        s &&
        s.carerId &&
        !s.cancelled &&
        !s.attendEnd &&
        s.window &&
        nowMs >= s.window.start - 60 * MIN &&
        nowMs <= s.window.end + 3 * HOUR
    );

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

  const mine = open.filter((s) => matched.has(s.carerId));
  if (!mine.length) return null;
  mine.sort((a, b) => Number(Boolean(b.attendStart)) - Number(Boolean(a.attendStart)) || b.window.start - a.window.start);
  return { shift: mine[0], firstName: matched.get(mine[0].carerId) };
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

module.exports = { findOpenShift, buildReply, NOT_FOUND_MESSAGE };
