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

module.exports = { normalizePhone, firstWord };
