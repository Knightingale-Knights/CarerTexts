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

// Short link token for Bubble shift ids shaped like "<digits>x<digits>": about 30 characters instead of 100.
// No expiry is stored in it (expSec is null); the caller works the expiry out from the shift's own times.
// Format: <i|o><base36 a>.<base36 b>.<mac>
const ID_RE = /^(\d+)x(\d+)$/;

function signShort(secret, shiftId, kind) {
  if (!secret) throw new Error('LINK_SECRET is not set');
  const m = ID_RE.exec(shiftId);
  if (!m) return null;
  const head = `${kind === 'in' ? 'i' : 'o'}${BigInt(m[1]).toString(36)}.${BigInt(m[2]).toString(36)}`;
  return `${head}.${b64(crypto.createHmac('sha256', secret).update(head).digest().subarray(0, 6))}`;
}

function verifyShort(secret, token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !/^[io][0-9a-z]+$/.test(parts[0]) || !/^[0-9a-z]+$/.test(parts[1])) return null;
  const head = `${parts[0]}.${parts[1]}`;
  const expected = b64(crypto.createHmac('sha256', secret).update(head).digest().subarray(0, 6));
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const toBig = (str) => [...str].reduce((acc, ch) => acc * 36n + BigInt(parseInt(ch, 36)), 0n);
  const shiftId = `${toBig(parts[0].slice(1))}x${toBig(parts[1])}`;
  return { shiftId, kind: parts[0][0] === 'i' ? 'in' : 'out', expSec: null };
}

// Short token when the shift id allows it, otherwise the long signed token with an expiry.
function signLink(secret, shiftId, kind, expSec) {
  return signShort(secret, shiftId, kind) || sign(secret, shiftId, kind, expSec);
}

// Returns { shiftId, kind, expSec } or null if invalid. Expiry is checked by the caller via isExpired.
function verify(secret, token) {
  if (!secret || typeof token !== 'string') return null;
  if (token.split('.').length === 3) return verifyShort(secret, token);
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

const isExpired = (payload, nowMs = Date.now()) => payload.expSec != null && nowMs / 1000 > payload.expSec;

module.exports = { sign, signLink, verify, isExpired };
