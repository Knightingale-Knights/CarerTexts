process.env.LINK_SECRET = 'test-secret';
process.env.BUBBLE_API_BASE = 'https://example.test/api/1.1';
process.env.BUBBLE_API_TOKEN = 'x';
process.env.PUBLIC_BASE_URL = 'https://carertexts.test';
process.env.RADIUS_M = '500';
process.env.MAX_ACCURACY_M = '200';

const test = require('node:test');
const assert = require('node:assert/strict');

const { haversineM } = require('../lib/geo');
const { sign, verify, isExpired } = require('../lib/token');
const time = require('../lib/time');
const { jobsFor, dueJobs } = require('../worker/schedule');
const sms = require('../worker/sms');
const bubble = require('../lib/bubble');

const TZ = 'Australia/Melbourne';

test('haversine: ~111 km per degree of latitude, zero for same point', () => {
  assert.equal(Math.round(haversineM(-37.8, 144.9, -37.8, 144.9)), 0);
  const d = haversineM(-37.0, 144.9, -38.0, 144.9);
  assert.ok(d > 111000 && d < 111400, String(d));
});

test('token: round trip, tamper and wrong secret rejected, expiry', () => {
  const t = sign('s', '1700x123', 'in', 2000000000);
  assert.deepEqual(verify('s', t), { shiftId: '1700x123', kind: 'in', expSec: 2000000000 });
  assert.equal(verify('other', t), null);
  assert.equal(verify('s', t.slice(0, -2) + 'AA'), null);
  assert.equal(verify('s', 'garbage'), null);
  const expired = verify('s', sign('s', 'a', 'out', 100));
  assert.ok(isExpired(expired));
});

test('time: Melbourne daylight saving offsets', () => {
  // 7:00am on 8 Oct 2026 is AEDT (UTC+11)
  assert.equal(new Date(time.zonedToUtc(2026, 10, 8, 7, 0, TZ)).toISOString(), '2026-10-07T20:00:00.000Z');
  // 7:00am on 8 Jul 2026 is AEST (UTC+10)
  assert.equal(new Date(time.zonedToUtc(2026, 7, 8, 7, 0, TZ)).toISOString(), '2026-07-07T21:00:00.000Z');
});

test('time: parse HHMM', () => {
  assert.deepEqual(time.parseHHMM(700), { h: 7, mi: 0 });
  assert.deepEqual(time.parseHHMM(2200), { h: 22, mi: 0 });
  assert.deepEqual(time.parseHHMM(1530), { h: 15, mi: 30 });
  assert.deepEqual(time.parseHHMM(0), { h: 0, mi: 0 });
  assert.deepEqual(time.parseHHMM(2430), { h: 24, mi: 30 });
  const night = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 2200, endTime: 2430 }, TZ);
  assert.equal(time.formatHHMM(night.end, TZ), '0030');
  assert.equal((night.end - night.start) / 3600000, 2.5);
  assert.equal(time.parseHHMM(2460), null);
  assert.equal(time.parseHHMM(NaN), null);
});

test('time: day shift and overnight shift windows', () => {
  const dateISO = '2026-10-07T13:00:00.000Z'; // midnight 8 Oct Melbourne
  const day = time.shiftWindow({ dateISO, startTime: 700, endTime: 1530 }, TZ);
  assert.equal(new Date(day.start).toISOString(), '2026-10-07T20:00:00.000Z');
  assert.equal(new Date(day.end).toISOString(), '2026-10-08T04:30:00.000Z');
  assert.deepEqual([day.y, day.m, day.d], [2026, 10, 8]);

  const night = time.shiftWindow({ dateISO, startTime: 2200, endTime: 600 }, TZ);
  assert.equal(new Date(night.start).toISOString(), '2026-10-08T11:00:00.000Z');
  assert.equal(new Date(night.end).toISOString(), '2026-10-08T19:00:00.000Z'); // 6am 9 Oct
});

test('schedule: day shift gets all five texts at the right times', () => {
  const win = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 700, endTime: 1530 }, TZ);
  const jobs = Object.fromEntries(jobsFor(win, TZ).map((j) => [j.kind, new Date(j.at).toISOString()]));
  assert.equal(jobs.checkin, '2026-10-07T19:45:00.000Z'); // 6:45am
  assert.equal(jobs.checkout, '2026-10-08T04:30:00.000Z'); // 3:30pm
  assert.equal(jobs.notes_1, '2026-10-08T11:00:00.000Z'); // 10pm
  assert.equal(jobs.notes_2, '2026-10-08T23:00:00.000Z'); // 10am 9 Oct
  assert.equal(jobs.notes_3, '2026-10-09T09:00:00.000Z'); // 8pm 9 Oct
});

test('schedule: overnight shift skips the 10pm reminder that falls before the shift ends', () => {
  const win = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 2200, endTime: 600 }, TZ);
  const kinds = jobsFor(win, TZ).map((j) => j.kind);
  assert.ok(!kinds.includes('notes_1'));
  assert.ok(kinds.includes('notes_2') && kinds.includes('notes_3'));
});

test('schedule: only jobs inside their window are due', () => {
  const win = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 700, endTime: 1530 }, TZ);
  const at = (iso) => dueJobs(win, Date.parse(iso), TZ).map((j) => j.kind);
  assert.deepEqual(at('2026-10-07T19:44:00.000Z'), []);
  assert.deepEqual(at('2026-10-07T19:46:00.000Z'), ['checkin']);
  assert.deepEqual(at('2026-10-07T20:01:00.000Z'), []); // no check-in text once the shift has started
  assert.deepEqual(at('2026-10-07T21:00:00.000Z'), []); // well after the check-in window
  assert.deepEqual(at('2026-10-08T04:31:00.000Z'), ['checkout']);
  assert.deepEqual(at('2026-10-08T11:30:00.000Z'), ['notes_1']);
});

test('sms: phone normalisation', () => {
  assert.equal(sms.normalizePhone('0412 345 678'), '+61412345678');
  assert.equal(sms.normalizePhone('+61412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('61412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('abc'), null);
  assert.equal(sms.normalizePhone(''), null);
  assert.equal(sms.firstWord('John Doe'), 'John');
  assert.equal(sms.firstWord('  Mary-Jane  Smith '), 'Mary-Jane');
  assert.equal(sms.firstWord(undefined), '');
});

test('sms: NDIS and aged care texts, each one segment with a 63 character link', () => {
  const win = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 700, endTime: 1500 }, TZ);
  const shift = { window: win, address: { text: '12 Smith St, Fitzroy VIC 3065' } };
  const link = 'https://carertexts.vercel.app/c/imvba26ux.4f8jleqa9hso.10Yf027l';

  const ndis = { firstName: 'Paul-Simon Djite', track: 'ndis', participantFirst: 'Gurcharan', shift, link };
  assert.equal(sms.buildMessage('checkin', ndis), `Hi Paul-Simon, have a great time with Gurcharan! Check in when you arrive: ${link}`);
  assert.equal(sms.buildMessage('checkout', ndis), `Hi Paul-Simon, hope the shift with Gurcharan went well. Please check out here: ${link}`);
  assert.equal(
    sms.buildMessage('notes_1', ndis),
    "Hi Paul-Simon, a gentle reminder you haven't submitted a progress note for your 0700 - 1500 shift with Gurcharan today."
  );
  for (const k of ['notes_2', 'notes_3']) {
    assert.match(sms.buildMessage(k, ndis), /shift with Gurcharan yesterday\.$/);
  }

  const aged = { firstName: 'Vishavdeep', track: 'aged', locationName: 'Ron Conn', shift, link };
  assert.equal(sms.buildMessage('checkin', aged), `Hi Vishavdeep, have a great time at Ron Conn! Check in when you arrive: ${link}`);
  assert.equal(sms.buildMessage('notes_1', aged), null);
  // falls back to the address when the location name is unavailable
  assert.match(sms.buildMessage('checkin', { ...aged, locationName: '' }), /time at 12 Smith St, Fitzroy VIC 3065!/);
  for (const m of [
    sms.buildMessage('checkin', ndis),
    sms.buildMessage('checkout', ndis),
    sms.buildMessage('notes_2', ndis),
    sms.buildMessage('checkin', aged),
  ]) {
    assert.match(m, /^[\x0a\x20-\x7e]+$/);
    assert.ok(m.length <= 160, `${m.length}: ${m}`);
  }
});

test('check-in flow: distance gate, write fields, idempotence', async () => {
  const { perform } = require('../lib/checkin');
  const token = sign('test-secret', 'S1', 'in', Math.floor(Date.now() / 1000) + 3600);
  const outToken = sign('test-secret', 'S1', 'out', Math.floor(Date.now() / 1000) + 3600);

  let stored = {
    _id: 'S1',
    'address_geographic_address': { address: '1 Test St', lat: -37.8136, lng: 144.9631 },
    'carer_user': 'U1',
    'participant_user': 'P1',
    'date_date': '2026-10-07T13:00:00.000Z',
    'start time_number': 700,
    'end time_number': 1530,
  };
  const patches = [];
  bubble.getShift = async () => stored;
  bubble.patchShift = async (id, fields) => {
    patches.push(fields);
    stored = { ...stored, ...fields };
  };

  const near = { lat: -37.8140, lng: 144.9635, accuracy: 20 };
  const far = { lat: -37.8136 + 0.0055, lng: 144.9631, accuracy: 20 }; // ~610 m north
  const edgeIn = { lat: -37.8136 + 0.0044, lng: 144.9631, accuracy: 20 }; // ~490 m

  await assert.rejects(() => perform(token, far), (e) => e.code === 'too_far' && e.extra.distance > 500);
  await assert.rejects(() => perform(token, { ...near, accuracy: 900 }), (e) => e.code === 'low_accuracy');
  await assert.rejects(() => perform(token, { lat: 'x', lng: 1, accuracy: 5 }), (e) => e.code === 'bad_location');
  await assert.rejects(() => perform('nonsense', near), (e) => e.code === 'bad_link');
  assert.equal(patches.length, 0);

  const ok = await perform(token, edgeIn);
  assert.equal(ok.ok, true);
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]).sort(), ['attend start_date', 'check in time_date']);

  const again = await perform(token, near);
  assert.equal(again.already, true);
  assert.equal(patches.length, 1);

  const out = await perform(outToken, near);
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(patches[1]).sort(), ['attend end_date', 'attended_boolean', 'check out time_date']);
  assert.equal(patches[1]['attended_boolean'], true);

  stored = { ...stored, 'cancelled_boolean': true };
  await assert.rejects(() => perform(outToken, near), (e) => e.code === 'cancelled');
});

test('shift: a midnight start or end that Bubble leaves out still gets a window', () => {
  const { summarise } = require('../lib/shift');
  const base = { _id: 'S', 'date_date': '2026-10-18T13:00:00.000Z' };
  const a = summarise({ ...base, 'end time_number': 600 });
  assert.equal(time.formatHHMM(a.window.start, TZ), '0000');
  assert.equal(time.formatHHMM(a.window.end, TZ), '0600');
  const b = summarise({ ...base, 'start time_number': 1800 });
  assert.equal(time.formatHHMM(b.window.end, TZ), '0000');
  assert.equal((b.window.end - b.window.start) / 3600000, 6);
  assert.equal(summarise(base).window, null);
});

test('check-in on an aged care shift also records the check out at the scheduled end', async () => {
  const { perform } = require('../lib/checkin');
  const token = sign('test-secret', 'S2', 'in', Math.floor(Date.now() / 1000) + 3600);
  let stored = {
    _id: 'S2',
    'address_geographic_address': { address: '1 Test St', lat: -37.8136, lng: 144.9631 },
    'carer_user': 'U1',
    'date_date': '2026-10-07T13:00:00.000Z',
    'start time_number': 700,
    'end time_number': 1530,
  };
  const patches = [];
  bubble.getShift = async () => stored;
  bubble.patchShift = async (id, fields) => {
    patches.push(fields);
    stored = { ...stored, ...fields };
  };
  await perform(token, { lat: -37.8140, lng: 144.9635, accuracy: 20 });
  assert.deepEqual(Object.keys(patches[0]).sort(), ['attend end_date', 'attend start_date', 'attended_boolean', 'check in time_date', 'check out time_date']);
  assert.equal(patches[0]['check out time_date'], '2026-10-08T04:30:00.000Z');
  assert.equal(patches[0]['attend end_date'], '2026-10-08T04:30:00.000Z');
});

test('time: a start of 2400 is midnight at the start of the shift date', () => {
  const dateISO = '2026-10-19T13:00:00.000Z'; // midnight 20 Oct Melbourne
  const w = time.shiftWindow({ dateISO, startTime: 2400, endTime: 600 }, TZ);
  assert.equal(new Date(w.start).toISOString(), '2026-10-19T13:00:00.000Z');
  assert.equal(new Date(w.end).toISOString(), '2026-10-19T19:00:00.000Z');
  const w2 = time.shiftWindow({ dateISO, startTime: 2430, endTime: 2600 }, TZ);
  assert.equal(time.formatHHMM(w2.start, TZ), '0030');
  assert.equal(time.formatHHMM(w2.end, TZ), '0200');
});

test('short link token: round trip, short, tamper rejected, long fallback, expiry from the shift', async () => {
  const { signLink } = require('../lib/token');
  const id = '1792173888825x582196950423360600';
  const t = signLink('s', id, 'in', 2000000000);
  assert.ok(t.length <= 32, t);
  assert.deepEqual(verify('s', t), { shiftId: id, kind: 'in', expSec: null });
  assert.equal(verify('s', signLink('s', id, 'out', 1)).kind, 'out');
  assert.equal(verify('other', t), null);
  assert.equal(verify('s', t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(verify('s', 'i1.2.zzzzzzzz'), null);
  // ids that do not fit the pattern keep the long token with its own expiry
  const long = signLink('s', 'weird-id', 'in', 2000000000);
  assert.deepEqual(verify('s', long), { shiftId: 'weird-id', kind: 'in', expSec: 2000000000 });
  assert.equal(isExpired({ expSec: null }), false);

  const { loadContext } = require('../lib/checkin');
  bubble.getShift = async () => ({
    _id: id, 'carer_user': 'U1', 'date_date': '2020-01-01T13:00:00.000Z', 'start time_number': 700, 'end time_number': 1530,
  });
  const lt = signLink('test-secret', id, 'out', 1);
  await assert.rejects(() => loadContext(lt), (e) => e.code === 'expired');
  const today = new Date().toISOString();
  bubble.getShift = async () => ({
    _id: id, 'carer_user': 'U1', 'date_date': today, 'start time_number': 0, 'end time_number': 2359,
  });
  assert.ok((await loadContext(lt)).shift);
});

test('dev links: test flag survives the token and switches Bubble calls to version-test', async () => {
  const { signLink } = require('../lib/token');
  const id = '1792173888825x582196950423360600';
  const t = signLink('s', id, 'in', 2000000000, true);
  assert.deepEqual(verify('s', t), { shiftId: id, kind: 'in', expSec: null, test: true });
  assert.equal(verify('s', signLink('s', id, 'out', 1, true)).kind, 'out');
  assert.equal(verify('s', signLink('s', id, 'in', 1)).test, undefined);
  const live = signLink('s', id, 'in', 1);
  assert.equal(verify('s', 'j' + live.slice(1)), null); // flipping live to test breaks the signature
  let seen;
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    seen = String(url);
    return { status: 200, ok: true, text: async () => '{}' };
  };
  process.env.BUBBLE_API_BASE = 'https://example.test/api/1.1';
  const b = require('../lib/bubble');
  return (async () => {
    await b.request('GET', '/obj/shift/x');
    assert.equal(seen, 'https://example.test/api/1.1/obj/shift/x');
    b.setTestMode(true);
    await b.request('GET', '/obj/shift/x');
    assert.equal(seen, 'https://example.test/version-test/api/1.1/obj/shift/x');
    global.fetch = realFetch;
  })();
});
