const crypto = require('crypto');
const config = require('../lib/config');
const { buildSmartReply } = require('../lib/earlycheckout');

function authorised(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m || !config.klarraSecret) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(config.klarraSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Called by Klarra for any carer text. Body: { phone, intent: 'checkin' | 'checkout' | 'auto' }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  if (!authorised(req)) return res.status(401).json({ ok: false, message: 'Unauthorised' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const intent = ['checkin', 'checkout'].includes(body && body.intent) ? body.intent : 'auto';
    const reply = await buildSmartReply(String((body && body.phone) || ''), intent);
    return res.status(200).json({ ok: true, ...reply });
  } catch (e) {
    console.error('carer link failed', e);
    return res.status(500).json({ ok: false, message: 'Something went wrong' });
  }
};
