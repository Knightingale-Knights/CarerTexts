const { measure, HttpError } = require('../lib/checkin');

// Distance from the shift address for the page's live "your distance" readout. Nothing is written.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'method', message: 'Method not allowed' });
  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const result = await measure(String((body && body.token) || ''), body);
    return res.status(200).json(result);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, code: e.code, message: e.message });
    console.error('distance failed', e);
    return res.status(500).json({ ok: false, code: 'server', message: 'Something went wrong. Please try again.' });
  }
};
