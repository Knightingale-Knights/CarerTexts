const config = require('./config');
const { get } = require('./bubble');
const { shiftWindow } = require('./time');

const F = config.fields;

// Normalise a raw Bubble shift into the few values this system needs.
// track: 'ndis' when the shift has a participant, 'aged' when it does not.
function summarise(raw) {
  if (!raw) return null;
  const addr = get(raw, F.address);
  const attendStart = get(raw, F.attendStart);
  const attendEnd = get(raw, F.attendEnd);
  const dateISO = get(raw, F.date);
  // Bubble may leave out a time of 0000 (midnight). If only one of the two is present, the other is midnight.
  const rawStart = get(raw, F.startTime);
  const rawEnd = get(raw, F.endTime);
  const blank = (v) => v === undefined || v === null || v === '';
  const bothBlank = blank(rawStart) && blank(rawEnd);
  const startTime = bothBlank ? NaN : blank(rawStart) ? 0 : Number(rawStart);
  const endTime = bothBlank ? NaN : blank(rawEnd) ? 0 : Number(rawEnd);
  const win = dateISO
    ? shiftWindow({ dateISO, startTime, endTime }, config.tz)
    : null;
  const participantId = get(raw, F.participant) || null;
  return {
    id: raw._id,
    carerId: get(raw, F.carer) || null,
    participantId,
    track: participantId ? 'ndis' : 'aged',
    locationId: get(raw, F.location) || null,
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
