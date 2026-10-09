const config = require('./config');
const bubble = require('./bubble');
const { summarise } = require('./shift');
const { sign } = require('./token');
const { HttpError } = require('./checkin');
const { HOUR } = require('./time');

// A check in / check out link for the carer's own shift, for the button inside Bubble.
// Before check in the link is a check in link, after that it is a check out link.
async function buildLink(shiftId, carerId) {
  if (!shiftId || !carerId) throw new HttpError(400, 'bad_request', 'shiftId and carerId are required');
  const shift = summarise(await bubble.getShift(shiftId));
  if (!shift) throw new HttpError(404, 'no_shift', 'We could not find this shift.');
  if (shift.carerId !== carerId) throw new HttpError(403, 'not_your_shift', 'This is not your shift.');
  if (shift.cancelled) throw new HttpError(409, 'cancelled', 'This shift has been cancelled.');
  if (!shift.window) throw new HttpError(422, 'no_times', 'This shift has no start or end time.');

  const kind = shift.attendStart ? 'out' : 'in';
  const expMs = kind === 'in' ? shift.window.start + 6 * HOUR : shift.window.end + 24 * HOUR;
  const token = sign(config.linkSecret, shift.id, kind, Math.floor(expMs / 1000));
  return { ok: true, kind, url: `${config.publicBaseUrl}/c/${token}` };
}

module.exports = { buildLink };
