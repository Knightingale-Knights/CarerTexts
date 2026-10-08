const MIN = 60000;
const HOUR = 60 * MIN;

const fmtCache = new Map();

function dtf(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    );
  }
  return fmtCache.get(tz);
}

// Wall-clock parts of an instant in a timezone.
function partsIn(utcMs, tz) {
  const p = Object.fromEntries(dtf(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

function offsetMs(utcMs, tz) {
  const p = partsIn(utcMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Convert a wall-clock time in tz to a UTC instant (ms). Day overflow (d+1) is fine.
function zonedToUtc(y, m, d, h, mi, tz) {
  const naive = Date.UTC(y, m - 1, d, h, mi);
  let guess = naive;
  for (let i = 0; i < 3; i++) guess = naive - offsetMs(guess, tz);
  return guess;
}

// Parse 700 / 2200 / 1530 style numbers. Returns { h, mi } or null.
function parseHHMM(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const h = Math.floor(n / 100);
  const mi = Math.round(n % 100);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

// The shift's calendar day (in tz) from the stored `date` value (midnight local time).
function shiftDay(dateISO, tz) {
  const ms = Date.parse(dateISO);
  if (Number.isNaN(ms)) return null;
  // +6h so a value stored at local midnight (or a little before) lands on the intended day
  const p = partsIn(ms + 6 * HOUR, tz);
  return { y: p.y, m: p.m, d: p.d };
}

// Returns { start, end, y, m, d } in UTC ms, or null if the shift data is unusable.
// An end time at or before the start time means the shift runs overnight.
function shiftWindow({ dateISO, startTime, endTime }, tz) {
  const day = shiftDay(dateISO, tz);
  const s = parseHHMM(startTime);
  const e = parseHHMM(endTime);
  if (!day || !s || !e) return null;
  const start = zonedToUtc(day.y, day.m, day.d, s.h, s.mi, tz);
  let end = zonedToUtc(day.y, day.m, day.d, e.h, e.mi, tz);
  if (end <= start) end = zonedToUtc(day.y, day.m, day.d + 1, e.h, e.mi, tz);
  return { start, end, ...day };
}

function formatTime(utcMs, tz) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(utcMs))
    .replace(/\s?([ap])m/i, (_, x) => ` ${x.toLowerCase()}m`);
}

function formatDay(utcMs, tz) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short' }).format(
    new Date(utcMs)
  );
}

// Melbourne-local ISO-style string is not needed for Bubble: it accepts UTC ISO 8601.
const isoNow = (nowMs = Date.now()) => new Date(nowMs).toISOString();

module.exports = {
  MIN,
  HOUR,
  partsIn,
  zonedToUtc,
  parseHHMM,
  shiftDay,
  shiftWindow,
  formatTime,
  formatDay,
  isoNow,
};
