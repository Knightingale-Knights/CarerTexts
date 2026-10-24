const config = require('../lib/config');
const { formatHHMM } = require('../lib/time');

const { normalizePhone, firstWord } = require('../lib/util');

function shortAddress(text) {
  if (!text) return 'your shift address';
  return text.length > 60 ? text.split(',').slice(0, 2).join(',').trim() : text;
}

// Texts are plain ASCII on purpose (no emoji or curly quotes) so they stay in the cheaper SMS encoding.
// ctx: { firstName, track: 'ndis' | 'aged', participantFirst, locationName, shift, link }
function buildMessage(kind, ctx) {
  const { track, shift, link } = ctx;
  const hi = ctx.firstName ? `Hi ${firstWord(ctx.firstName)}` : 'Hi';
  const participant = firstWord(ctx.participantFirst) || 'your participant';
  const place = ctx.locationName || shortAddress(shift.address && shift.address.text);
  const w = shift.window;

  if (track === 'ndis') {
    if (kind === 'checkin') return `${hi}, have a great time with ${participant}! Check in when you arrive: ${link}`;
    if (kind === 'checkout') return `${hi}, hope the shift with ${participant} went well. Please check out here: ${link}`;
    const range = `${formatHHMM(w.start, config.tz)} - ${formatHHMM(w.end, config.tz)}`;
    const when = kind === 'notes_1' ? 'today' : 'yesterday';
    return `${hi}, a gentle reminder you haven't submitted a progress note for your ${range} shift with ${participant} ${when}.`;
  }

  // aged care
  if (kind === 'checkin') return `${hi}, have a great time at ${place}! Check in when you arrive: ${link}`;
  if (kind === 'checkout') return `${hi}, hope your shift at ${place} went well. Please check out here: ${link}`;
  return null; // aged care carers do not get progress note reminders
}

async function send(to, body) {
  if (config.smsMode !== 'live') {
    console.log(`[DRY RUN] SMS to ${to}: ${body}`);
    return { dryRun: true, sid: null };
  }
  const { sid, token, from } = config.twilio;
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message || 'send failed'}`);
  return { dryRun: false, sid: json.sid };
}

module.exports = { normalizePhone, firstWord, buildMessage, send };
