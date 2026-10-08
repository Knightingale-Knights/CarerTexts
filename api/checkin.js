const { perform, HttpError } = require('../lib/checkin');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'method', message: 'Method not allowed' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const result = await perform(String((body && body.token) || ''), body);
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof HttpError) {
      return res.status(e.status).json({ ok: false, code: e.code, message: e.message, ...e.extra });
    }
    console.error('check-in failed', e);
    return res.status(500).json({ ok: false, code: 'server', message: 'Something went wrong. Please try again.' });
  }
};
