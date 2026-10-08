const config = require('../lib/config');
const bubble = require('../lib/bubble');
const { summarise } = require('../lib/shift');
const { sign } = require('../lib/token');
const { zonedToUtc, partsIn, HOUR } = require('../lib/time');
const { dueJobs, linkExpirySec } = require('./schedule');
const sms = require('./sms');
const store = require('./store');

const F = config.fields;
const MAX_FAILURES = 3;

let shifts = []; // summarised shifts for the current window
const failures = new Map();
const userCache = new Map(); // id -> { at, user }
const locationCache = new Map(); // id -> { at, name }
let ticking = false;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// Shifts dated from the start of yesterday to the end of tomorrow (Melbourne), enough to cover
// the next-day progress note reminders.
async function refresh() {
  try {
    const p = partsIn(Date.now(), config.tz);
    const from = new Date(zonedToUtc(p.y, p.m, p.d - 1, 0, 0, config.tz) - HOUR).toISOString();
    const to = new Date(zonedToUtc(p.y, p.m, p.d + 2, 0, 0, config.tz) + HOUR).toISOString();
    const raw = await bubble.listShiftsBetween(from, to);
    shifts = raw
      .map(summarise)
      .filter((s) => s && s.carerId && !s.cancelled && s.window);
    const ndis = shifts.filter((s) => s.track === 'ndis').length;
    log(`refreshed: ${shifts.length} shifts in window (${ndis} NDIS, ${shifts.length - ndis} aged care)`);
  } catch (e) {
    console.error('refresh failed', e.message);
  }
}

async function getUserCached(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < 30 * 60000) return hit.user;
  const user = await bubble.getUser(id);
  userCache.set(id, { at: Date.now(), user });
  return user;
}

// Aged care location name, or '' if it cannot be read (the text then falls back to the address).
async function getLocationName(id) {
  if (!id) return '';
  const hit = locationCache.get(id);
  if (hit && Date.now() - hit.at < 6 * 60 * 60000) return hit.name;
  let name = '';
  try {
    const loc = await bubble.getLocation(id);
    name = String(bubble.get(loc, F.locationName) || '').trim();
  } catch (e) {
    console.error('location lookup failed', e.message);
  }
  locationCache.set(id, { at: Date.now(), name });
  return name;
}

// Reasons not to send, checked against the live shift right before sending.
function skipReason(kind, shift) {
  if (!shift) return 'shift_missing';
  if (shift.cancelled) return 'cancelled';
  if (!shift.carerId) return 'no_carer';
  if (kind === 'checkin' && shift.attendStart) return 'already_checked_in';
  if (kind === 'checkout' && shift.attendEnd) return 'already_checked_out';
  if (kind.startsWith('notes') && !shift.participantId) return 'aged_care_no_notes';
  if (kind.startsWith('notes') && shift.hasProgressNote) return 'note_done';
  return null;
}

async function handle(cached, job) {
  const id = cached.id;
  const fkey = `${id}:${job.kind}`;
  if ((failures.get(fkey) || 0) >= MAX_FAILURES) return;
  if (!(await store.claim(id, job.kind))) return;

  try {
    const live = summarise(await bubble.getShift(id));
    const why = skipReason(job.kind, live);
    if (why) {
      await store.finish(id, job.kind, { status: 'skipped', error: why });
      log(`skip ${fkey}: ${why}`);
      return;
    }

    const carer = await getUserCached(live.carerId);
    const phone = sms.normalizePhone(bubble.get(carer, F.userPhone));
    if (!phone) {
      await store.finish(id, job.kind, { status: 'no_phone', carer_id: live.carerId });
      log(`skip ${fkey}: no usable phone number`);
      return;
    }

    if (config.onlyPhone && phone !== config.onlyPhone) {
      log(`skip ${fkey}: ONLY_PHONE test mode`);
      return;
    }

    let participantFirst = '';
    if (live.track === 'ndis') {
      const participant = await getUserCached(live.participantId);
      participantFirst = sms.firstWord(bubble.get(participant, F.userFirstName));
    }
    const locationName = live.track === 'aged' ? await getLocationName(live.locationId) : '';

    let link = '';
    if (job.kind === 'checkin' || job.kind === 'checkout') {
      const linkKind = job.kind === 'checkin' ? 'in' : 'out';
      const t = sign(config.linkSecret, id, linkKind, linkExpirySec(linkKind, live.window));
      link = `${config.publicBaseUrl}/c/${t}`;
    }

    const body = sms.buildMessage(job.kind, {
      firstName: bubble.get(carer, F.userFirstName),
      track: live.track,
      participantFirst,
      locationName,
      shift: live,
      link,
    });
    if (!body) {
      await store.finish(id, job.kind, { status: 'skipped', error: 'no_text_for_track' });
      return;
    }

    const res = await sms.send(phone, body);
    await store.finish(id, job.kind, {
      status: res.dryRun ? 'dry_run' : 'sent',
      carer_id: live.carerId,
      phone,
      twilio_sid: res.sid,
      sent_at: new Date().toISOString(),
    });
    log(`${res.dryRun ? 'dry run' : 'sent'} ${fkey} (${live.track})`);
  } catch (e) {
    failures.set(fkey, (failures.get(fkey) || 0) + 1);
    console.error(`failed ${fkey} (attempt ${failures.get(fkey)})`, e.message);
    try {
      await store.release(id, job.kind);
    } catch (e2) {
      console.error('release failed', e2.message);
    }
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const s of shifts) {
      for (const job of dueJobs(s.window, now, config.tz)) {
        // Aged care carers do not submit progress notes, so never claim those reminders.
        if (!s.participantId && job.kind.startsWith('notes')) continue;
        await handle(s, job);
      }
    }
  } catch (e) {
    console.error('tick failed', e.message);
  } finally {
    ticking = false;
  }
}

async function main() {
  for (const [k, v] of Object.entries({
    BUBBLE_API_BASE: config.bubble.base,
    BUBBLE_API_TOKEN: config.bubble.token,
    LINK_SECRET: config.linkSecret,
    PUBLIC_BASE_URL: config.publicBaseUrl,
  })) {
    if (!v) throw new Error(`${k} is not set`);
  }
  if (process.env.ONLY_PHONE && !config.onlyPhone) throw new Error('ONLY_PHONE is not a valid phone number');
  if (config.smsMode === 'live' && !config.onlyPhone && (!config.supabase.url || !config.supabase.key)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in live mode');
  }
  log(`carer texts worker starting (SMS_MODE=${config.smsMode}, ONLY_PHONE=${config.onlyPhone || 'off'}, tz=${config.tz})`);
  await refresh();
  await tick();
  setInterval(tick, 60 * 1000);
  setInterval(refresh, config.refreshMin * 60 * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
