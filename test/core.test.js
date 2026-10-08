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

test('sms: phone normalisation and messages', () => {
  assert.equal(sms.normalizePhone('0412 345 678'), '+61412345678');
  assert.equal(sms.normalizePhone('+61412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('61412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('412345678'), '+61412345678');
  assert.equal(sms.normalizePhone('abc'), null);
  assert.equal(sms.normalizePhone(''), null);

  const win = time.shiftWindow({ dateISO: '2026-10-07T13:00:00.000Z', startTime: 700, endTime: 1530 }, TZ);
  const shift = { window: win, address: { text: '12 Smith St, Fitzroy VIC 3065' } };
  const m = sms.buildMessage('checkin', { firstName: 'Kelly', shift, link: 'https://x/c/abc' });
  assert.match(m, /^Hi Kelly, your shift at 12 Smith St, Fitzroy VIC 3065 starts at 7:00 am\./);
  assert.match(m, /https:\/\/x\/c\/abc$/);
  assert.match(sms.buildMessage('notes_2', { firstName: 'Kelly', shift, link: '' }), /progress note/);
});

test('check-in flow: distance gate, write fields, idempotence', async () => {
  const { perform } = require('../lib/checkin');
  const token = sign('test-secret', 'S1', 'in', Math.floor(Date.now() / 1000) + 3600);
  const outToken = sign('test-secret', 'S1', 'out', Math.floor(Date.now() / 1000) + 3600);

  let stored = {
    _id: 'S1',
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
  assert.deepEqual(Object.keys(patches[0]), ['attend start_date']);

  const again = await perform(token, near);
  assert.equal(again.already, true);
  assert.equal(patches.length, 1);

  const out = await perform(outToken, near);
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(patches[1]).sort(), ['attend end_date', 'attended_boolean']);
  assert.equal(patches[1]['attended_boolean'], true);

  stored = { ...stored, 'cancelled_boolean': true };
  await assert.rejects(() => perform(outToken, near), (e) => e.code === 'cancelled');
});
