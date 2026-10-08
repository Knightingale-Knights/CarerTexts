const crypto = require('crypto');

const b64 = (buf) => Buffer.from(buf).toString('base64url');

function mac(secret, data) {
  return b64(crypto.createHmac('sha256', secret).update(data).digest().subarray(0, 12));
}

// kind: 'in' | 'out'. expSec: expiry as unix seconds.
function sign(secret, shiftId, kind, expSec) {
  if (!secret) throw new Error('LINK_SECRET is not set');
  const body = b64(`${shiftId}|${kind}|${expSec}`);
  return `${body}.${mac(secret, body)}`;
}

// Returns { shiftId, kind, expSec } or null if invalid. Expiry is checked by the caller via isExpired.
function verify(secret, token) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = mac(secret, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let decoded;
  try {
    decoded = Buffer.from(body, 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }
  const [shiftId, kind, exp] = decoded.split('|');
  const expSec = Number(exp);
  if (!shiftId || (kind !== 'in' && kind !== 'out') || !Number.isFinite(expSec)) return null;
  return { shiftId, kind, expSec };
}

const isExpired = (payload, nowMs = Date.now()) => nowMs / 1000 > payload.expSec;

module.exports = { sign, verify, isExpired };
