const config = require('../lib/config');
const { formatHHMM } = require('../lib/time');

// Australian numbers to E.164. Returns null if it does not look like a number.
function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/[\s()\-.]/g, '');
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^0\d{9}$/.test(s)) return '+61' + s.slice(1);
  if (/^61\d{9}$/.test(s)) return '+' + s;
  if (/^4\d{8}$/.test(s)) return '+61' + s;
  return null;
}

// "John Doe" -> "John"
function firstWord(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function shortAddress(text) {
  if (!text) return 'your shift address';
  return text.length > 60 ? text.split(',').slice(0, 2).join(',').trim() : text;
}

const pad2 = (n) => String(n).padStart(2, '0');

// Texts are plain ASCII on purpose (no emoji or curly quotes) so they stay in the cheaper SMS encoding.
// ctx: { firstName, track: 'ndis' | 'aged', participantFirst, locationName, shift, link }
function buildMessage(kind, ctx) {
  const { track, shift, link } = ctx;
  const hi = ctx.firstName ? `Hi ${firstWord(ctx.firstName)}` : 'Hi';
  const participant = firstWord(ctx.participantFirst) || 'your participant';
  const place = ctx.locationName || shortAddress(shift.address && shift.address.text);
  const w = shift.window;

  if (track === 'ndis') {
    if (kind === 'checkin') {
      return (
        `${hi}, have a great time with ${participant} today. please click on this link to check in when you arrive: ${link}\n\n` +
        `If you need to check out early, please text me and I'll send you a check out link.`
      );
    }
    if (kind === 'checkout') {
      return `${hi}, hope you had a nice shift with ${participant}. Please click on this link to check out before you leave: ${link}`;
    }
    const range = `${formatHHMM(w.start, config.tz)} - ${formatHHMM(w.end, config.tz)}`;
    const date = `${pad2(w.d)}/${pad2(w.m)}`;
    return `${hi}, I noticed you haven't submitted a progress note for the ${range} shift you did with ${participant} on ${date}. Thought I'd send you a gentle reminder =)`;
  }

  // aged care
  if (kind === 'checkin') {
    return (
      `${hi}, have a great time at ${place} today. please click on this link to check in when you arrive: ${link}\n\n` +
      `If you need to check out early, please text me "i need to check out early" and I'll send you a check out link.`
    );
  }
  if (kind === 'checkout') {
    return `${hi}, hope you had a nice shift at ${place}. Please click on this link to check out before you leave: ${link}`;
  }
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
