const crypto = require('crypto');
const config = require('../lib/config');
const { HttpError } = require('../lib/checkin');
const { buildLink } = require('../lib/link');

function authorised(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m || !config.bubbleLinkSecret) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(config.bubbleLinkSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Called by Bubble (API Connector) when a carer taps the check in button there.
// Body: { shiftId, carerId }. Returns { ok, kind, url }.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'method', message: 'Method not allowed' });
  if (!authorised(req)) return res.status(401).json({ ok: false, code: 'unauthorised', message: 'Unauthorised' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const out = await buildLink(String((body && body.shiftId) || ''), String((body && body.carerId) || ''));
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, code: e.code, message: e.message });
    console.error('link failed', e);
    return res.status(500).json({ ok: false, code: 'server', message: 'Something went wrong. Please try again.' });
  }
};
