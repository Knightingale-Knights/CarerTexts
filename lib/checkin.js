const config = require('./config');
const bubble = require('./bubble');
const { summarise } = require('./shift');
const { verify, isExpired } = require('./token');
const { haversineM, validCoords } = require('./geo');
const { formatTime, formatDay, isoNow } = require('./time');
const { firstWord } = require('./util');

class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Verify the link token and load the live shift from Bubble.
async function loadContext(token) {
  const payload = verify(config.linkSecret, token);
  if (!payload) throw new HttpError(400, 'bad_link', 'This link is not valid. Please use the link from your latest text.');
  if (isExpired(payload)) throw new HttpError(410, 'expired', 'This link has expired.');
  const raw = await bubble.getShift(payload.shiftId);
  const shift = summarise(raw);
  if (!shift) throw new HttpError(404, 'no_shift', 'We could not find this shift.');
  if (shift.cancelled) throw new HttpError(409, 'cancelled', 'This shift has been cancelled.');
  return { payload, shift };
}

// What the page shows instead of the address: the participant's first name (NDIS)
// or the location name (aged care).
async function placeInfo(shift) {
  const label = shift.participantId ? 'Participant' : 'Location';
  try {
    if (shift.participantId) {
      const u = await bubble.getUser(shift.participantId);
      return { label, name: firstWord(bubble.get(u, config.fields.userFirstName)) };
    }
    if (shift.locationId) {
      const l = await bubble.getLocation(shift.locationId);
      return { label, name: String(bubble.get(l, config.fields.locationName) || '').trim() };
    }
  } catch (e) {
    console.error('place lookup failed', e);
  }
  return { label, name: '' };
}

function publicView({ payload, shift }) {
  const w = shift.window;
  const done = payload.kind === 'in' ? Boolean(shift.attendStart) : Boolean(shift.attendEnd);
  return {
    kind: payload.kind,
    day: w ? formatDay(w.start, config.tz) : '',
    start: w ? formatTime(w.start, config.tz) : '',
    end: w ? formatTime(w.end, config.tz) : '',
    done,
    doneAt: done ? formatTime(Date.parse(payload.kind === 'in' ? shift.attendStart : shift.attendEnd), config.tz) : '',
    radiusM: config.radiusM,
  };
}

// Live distance for the page (no writes). perform() below stays the authority.
async function measure(token, body) {
  const { shift } = await loadContext(token);
  const lat = body && body.lat;
  const lng = body && body.lng;
  const accuracy = body && body.accuracy;
  if (!validCoords(lat, lng)) throw new HttpError(400, 'bad_location', 'We could not read your location. Please try again.');
  if (!shift.address || !validCoords(shift.address.lat, shift.address.lng)) {
    throw new HttpError(422, 'no_address', 'This shift has no mapped address yet. Please contact the office.');
  }
  const distance = Math.round(haversineM(lat, lng, shift.address.lat, shift.address.lng));
  const precise = typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy <= config.maxAccuracyM;
  return { ok: true, distance, inRange: distance <= config.radiusM, precise, radiusM: config.radiusM };
}

// Distance check, then write the attendance fields to Bubble.
async function perform(token, body) {
  const ctx = await loadContext(token);
  const { payload, shift } = ctx;
  const lat = body && body.lat;
  const lng = body && body.lng;
  const accuracy = body && body.accuracy;

  if (!validCoords(lat, lng)) throw new HttpError(400, 'bad_location', 'We could not read your location. Please try again.');
  if (!shift.address || !validCoords(shift.address.lat, shift.address.lng)) {
    throw new HttpError(422, 'no_address', 'This shift has no mapped address yet. Please contact the office.');
  }
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy > config.maxAccuracyM) {
    throw new HttpError(422, 'low_accuracy', 'Your phone could not get a precise location. Move outside or turn on precise location, then try again.');
  }

  const distance = Math.round(haversineM(lat, lng, shift.address.lat, shift.address.lng));
  if (distance > config.radiusM) {
    throw new HttpError(
      403,
      'too_far',
      `You are about ${distance} m from the shift address. You need to be within ${config.radiusM} m.`,
      { distance }
    );
  }

  const view = publicView(ctx);
  if (view.done) return { ok: true, already: true, time: view.doneAt, distance };

  const now = isoNow();
  const F = config.fields;
  const fields = payload.kind === 'in' ? { [F.attendStart]: now } : { [F.attendEnd]: now, [F.attended]: true };
  await bubble.patchShift(shift.id, fields);
  return { ok: true, already: false, time: formatTime(Date.parse(now), config.tz), distance };
}

module.exports = { HttpError, loadContext, publicView, placeInfo, measure, perform };
