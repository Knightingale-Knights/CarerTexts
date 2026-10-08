const config = require('./config');
const { get } = require('./bubble');
const { shiftWindow } = require('./time');

const F = config.fields;

// Normalise a raw Bubble shift into the few values this system needs.
function summarise(raw) {
  if (!raw) return null;
  const addr = get(raw, F.address);
  const attendStart = get(raw, F.attendStart);
  const attendEnd = get(raw, F.attendEnd);
  const dateISO = get(raw, F.date);
  const startTime = Number(get(raw, F.startTime));
  const endTime = Number(get(raw, F.endTime));
  const win = dateISO
    ? shiftWindow({ dateISO, startTime, endTime }, config.tz)
    : null;
  return {
    id: raw._id,
    carerId: get(raw, F.carer) || null,
    cancelled: get(raw, F.cancelled) === true,
    attendStart: attendStart || null,
    attendEnd: attendEnd || null,
    hasProgressNote: Boolean(get(raw, F.progressNote)),
    address: addr
      ? {
          text: typeof addr === 'string' ? addr : addr.address || '',
          lat: typeof addr === 'object' ? addr.lat : undefined,
          lng: typeof addr === 'object' ? addr.lng : undefined,
        }
      : null,
    window: win,
  };
}

module.exports = { summarise };
