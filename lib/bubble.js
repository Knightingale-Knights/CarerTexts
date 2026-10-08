const config = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(method, path, { query, body } = {}) {
  const { base, token } = config.bubble;
  if (!base || !token) throw new Error('BUBBLE_API_BASE and BUBBLE_API_TOKEN must be set');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Bubble ${method} ${path} -> ${res.status}`);
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Bubble ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      }
      if (res.status === 204) return {};
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (e) {
      lastErr = e;
      if (String(e.message).startsWith('Bubble ')) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Read a field from a Bubble object, tolerating key-style differences
// (e.g. "attend start_date" vs "attend start").
function get(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined) return obj[key];
  const base = key.replace(/_(date|boolean|number|text|user|geographic_address|custom_.*)$/, '');
  for (const k of [base, base.replace(/ /g, '_'), base.replace(/ /g, '')]) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

async function getShift(id) {
  const r = await request('GET', `/obj/shift/${encodeURIComponent(id)}`);
  return r && r.response ? r.response : null;
}

async function getUser(id) {
  const r = await request('GET', `/obj/user/${encodeURIComponent(id)}`);
  return r && r.response ? r.response : null;
}

// All shifts whose `date` falls in [fromISO, toISO). Pages through the cursor.
async function listShiftsBetween(fromISO, toISO) {
  const constraints = JSON.stringify([
    { key: config.fields.date, constraint_type: 'greater than', value: fromISO },
    { key: config.fields.date, constraint_type: 'less than', value: toISO },
  ]);
  const out = [];
  let cursor = 0;
  for (let page = 0; page < 50; page++) {
    const r = await request('GET', '/obj/shift', { query: { constraints, cursor: String(cursor), limit: '100' } });
    const resp = (r && r.response) || {};
    out.push(...(resp.results || []));
    if (!resp.remaining) break;
    cursor += (resp.results || []).length;
  }
  return out;
}

async function patchShift(id, fields) {
  await request('PATCH', `/obj/shift/${encodeURIComponent(id)}`, { body: fields });
}

module.exports = { request, get, getShift, getUser, listShiftsBetween, patchShift };
