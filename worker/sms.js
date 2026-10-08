const config = require('../lib/config');
const { formatTime, formatDay } = require('../lib/time');

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

function shortAddress(text) {
  if (!text) return 'your shift address';
  return text.length > 60 ? text.split(',').slice(0, 2).join(',').trim() : text;
}

function buildMessage(kind, { firstName, shift, link }) {
  const name = firstName ? `Hi ${firstName}, ` : 'Hi, ';
  const w = shift.window;
  const addr = shortAddress(shift.address && shift.address.text);
  if (kind === 'checkin') {
    return `${name}your shift at ${addr} starts at ${formatTime(w.start, config.tz)}. Check in when you arrive: ${link}`;
  }
  if (kind === 'checkout') {
    return `${name}your shift at ${addr} has finished. Check out before you leave: ${link}`;
  }
  const when = `${formatDay(w.start, config.tz)} at ${formatTime(w.start, config.tz)}`;
  return `${name}your progress note for your shift on ${when} (${addr}) is still outstanding. Please complete it in the Knightingale app. Please do not reply to this message.`;
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

module.exports = { normalizePhone, buildMessage, send };
