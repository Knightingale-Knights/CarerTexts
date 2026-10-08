const { loadContext, publicView, HttpError } = require('../lib/checkin');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, code: 'method', message: 'Method not allowed' });
  try {
    const token = String((req.query && req.query.t) || '');
    const ctx = await loadContext(token);
    return res.status(200).json({ ok: true, ...publicView(ctx) });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, code: e.code, message: e.message });
    console.error('shift lookup failed', e);
    return res.status(500).json({ ok: false, code: 'server', message: 'Something went wrong. Please try again.' });
  }
};
