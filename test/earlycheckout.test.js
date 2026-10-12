process.env.LINK_SECRET = 'test-secret';
process.env.BUBBLE_API_BASE = 'https://example.test/api/1.1';
process.env.BUBBLE_API_TOKEN = 'x';
process.env.PUBLIC_BASE_URL = 'https://carertexts.test';
process.env.KLARRA_SHARED_SECRET = 'klarra-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

const bubble = require('../lib/bubble');
const { buildReply, buildCheckinReply, NOT_FOUND_MESSAGE, NOT_FOUND_CHECKIN_MESSAGE } = require('../lib/earlycheckout');
const { verify } = require('../lib/token');

// 9:00am on 9 Oct 2026, Melbourne
const NOW = Date.parse('2026-10-08T22:00:00.000Z');
const DAY = '2026-10-08T13:00:00.000Z'; // midnight 9 Oct, Melbourne

const shift = (id, carer, extra = {}) => ({
  _id: id,
  'carer_user': carer,
  'date_date': DAY,
  'start time_number': 800,
  'end time_number': 1600,
  ...extra,
});

const users = {
  U1: { 'first name_text': 'Kelly Brown', 'phone number_text': '0412 345 678' },
  U2: { 'first name_text': 'Sam', 'phone number_text': '0499 111 222' },
};

test('early check-out: finds the carer\'s open shift and returns a check-out link', async () => {
  bubble.listShiftsBetween = async () => [
    shift('S-done', 'U1', { 'attend end_date': '2026-10-08T22:30:00.000Z' }),
    shift('S-cancelled', 'U1', { 'cancelled_boolean': true }),
    shift('S-other', 'U2'),
    shift('S-mine', 'U1', { 'attend start_date': '2026-10-08T21:02:00.000Z' }),
  ];
  bubble.getUser = async (id) => users[id];

  const r = await buildReply('+61412345678', NOW);
  assert.equal(r.found, true);
  assert.equal(r.shiftId, 'S-mine');
  assert.match(r.message, /^Hi Kelly, no worries\. Here is your check out link: https:\/\/carertexts\.test\/c\//);
  const token = r.message.split('/c/')[1];
  const payload = verify('test-secret', token);
  assert.equal(payload.shiftId, 'S-mine');
  assert.equal(payload.kind, 'out');
});

test('early check-out: unknown number or no open shift gets the not-found message', async () => {
  bubble.listShiftsBetween = async () => [shift('S1', 'U1')];
  bubble.getUser = async (id) => users[id];
  assert.deepEqual(await buildReply('+61400000000', NOW), { found: false, message: NOT_FOUND_MESSAGE });
  assert.deepEqual(await buildReply('not a number', NOW), { found: false, message: NOT_FOUND_MESSAGE });

  // a shift that has not started yet (and is not within an hour of starting) does not count
  bubble.listShiftsBetween = async () => [shift('S-later', 'U1', { 'start time_number': 1400, 'end time_number': 2200 })];
  assert.equal((await buildReply('+61412345678', NOW)).found, false);
});

test('check-in by text: returns a check-in link for the shift about to start', async () => {
  // now is 9:00am; U1 has an 8:00 shift (running, not checked in) and a 2pm shift (too early)
  bubble.listShiftsBetween = async () => [
    shift('S-done', 'U1', { 'attend start_date': '2026-10-08T21:02:00.000Z' }),
    shift('S-cancelled', 'U1', { 'cancelled_boolean': true }),
    shift('S-other', 'U2'),
    shift('S-later', 'U1', { 'start time_number': 1400, 'end time_number': 2200 }),
    shift('S-mine', 'U1'),
  ];
  bubble.getUser = async (id) => users[id];

  const r = await buildCheckinReply('+61412345678', NOW);
  assert.equal(r.found, true);
  assert.equal(r.shiftId, 'S-mine');
  assert.match(r.message, /^Hi Kelly, no worries\. Here is your check in link: https:\/\/carertexts\.test\/c\//);
  const payload = verify('test-secret', r.message.split('/c/')[1]);
  assert.deepEqual([payload.shiftId, payload.kind], ['S-mine', 'in']);
});

test('check-in by text: no upcoming shift, unknown number, or already checked in', async () => {
  bubble.getUser = async (id) => users[id];
  bubble.listShiftsBetween = async () => [shift('S1', 'U1', { 'attend start_date': '2026-10-08T21:02:00.000Z' })];
  assert.deepEqual(await buildCheckinReply('+61412345678', NOW), { found: false, message: NOT_FOUND_CHECKIN_MESSAGE });
  bubble.listShiftsBetween = async () => [shift('S1', 'U1')];
  assert.equal((await buildCheckinReply('+61400000000', NOW)).found, false);
  assert.equal((await buildCheckinReply('nope', NOW)).found, false);
});

test('smart reply: auto picks check out when checked in, check in when about to start, intent overrides', async () => {
  const { buildSmartReply, ALREADY_IN_MESSAGE } = require('../lib/earlycheckout');
  bubble.getUser = async (id) => users[id];

  bubble.listShiftsBetween = async () => [shift('S1', 'U1', { 'attend start_date': '2026-10-08T21:02:00.000Z' })];
  let r = await buildSmartReply('+61412345678', 'auto', NOW);
  assert.match(r.message, /check out link/);
  r = await buildSmartReply('+61412345678', 'checkin', NOW);
  assert.equal(r.message, ALREADY_IN_MESSAGE);

  bubble.listShiftsBetween = async () => [shift('S1', 'U1')];
  r = await buildSmartReply('+61412345678', 'auto', NOW);
  assert.match(r.message, /check in link/);
  r = await buildSmartReply('+61412345678', 'checkout', NOW);
  assert.match(r.message, /check out link/);

  r = await buildSmartReply('+61400000000', 'auto', NOW);
  assert.equal(r.found, false);
});
