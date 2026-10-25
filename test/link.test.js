process.env.LINK_SECRET = 'test-secret';
process.env.BUBBLE_API_BASE = 'https://example.test/api/1.1';
process.env.BUBBLE_API_TOKEN = 'x';
process.env.PUBLIC_BASE_URL = 'https://carertexts.test';

const test = require('node:test');
const assert = require('node:assert/strict');

const bubble = require('../lib/bubble');
const { buildLink } = require('../lib/link');
const { verify } = require('../lib/token');

const base = {
  _id: 'S1',
  'carer_user': 'U1',
  'date_date': '2026-10-08T13:00:00.000Z',
  'start time_number': 800,
  'end time_number': 1600,
};

test('link: check in link before check in, check out link after', async () => {
  bubble.getShift = async () => base;
  const a = await buildLink('S1', 'U1');
  assert.equal(a.kind, 'in');
  assert.match(a.url, /^https:\/\/carertexts\.test\/c\//);
  const p = verify('test-secret', a.url.split('/c/')[1]);
  assert.deepEqual([p.shiftId, p.kind], ['S1', 'in']);

  bubble.getShift = async () => ({ ...base, 'attend start_date': '2026-10-08T21:02:00.000Z' });
  const b = await buildLink('S1', 'U1');
  assert.equal(b.kind, 'out');
});

test('link: only the shift\'s own carer, and not a cancelled shift', async () => {
  bubble.getShift = async () => base;
  await assert.rejects(() => buildLink('S1', 'U2'), { code: 'not_your_shift' });
  await assert.rejects(() => buildLink('', 'U1'), { code: 'bad_request' });
  bubble.getShift = async () => ({ ...base, 'cancelled_boolean': true });
  await assert.rejects(() => buildLink('S1', 'U1'), { code: 'cancelled' });
  bubble.getShift = async () => null;
  await assert.rejects(() => buildLink('S1', 'U1'), { code: 'no_shift' });
});

test('link: a button can ask for a check out link before checking in', async () => {
  const { buildLink } = require('../lib/link');
  const { verify } = require('../lib/token');
  const bubble = require('../lib/bubble');
  bubble.getShift = async () => ({
    _id: '1792173888825x582196950423360600', 'carer_user': 'U1', 'participant_user': 'P1',
    'date_date': '2026-10-24T13:00:00.000Z', 'start time_number': 700, 'end time_number': 1530,
  });
  const a = await buildLink('1792173888825x582196950423360600', 'U1', false, 'out');
  assert.equal(a.kind, 'out');
  assert.equal(verify('test-secret', a.url.split('/c/')[1]).kind, 'out');
  assert.equal((await buildLink('1792173888825x582196950423360600', 'U1', false, '')).kind, 'in');
});

test('link: also returns the scheduled start and end as ISO times', async () => {
  const { buildLink } = require('../lib/link');
  const bubble = require('../lib/bubble');
  bubble.getShift = async () => ({
    _id: '1792173888825x582196950423360600', 'carer_user': 'U1',
    'date_date': '2026-10-24T13:00:00.000Z', 'start time_number': 700, 'end time_number': 1530,
  });
  const r = await buildLink('1792173888825x582196950423360600', 'U1');
  assert.equal(r.startAt, '2026-10-24T20:00:00.000Z');
  assert.equal(r.endAt, '2026-10-25T04:30:00.000Z');
});
