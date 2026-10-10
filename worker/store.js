const config = require('../lib/config');

// Send log. One row per (shift, kind, carer) guarantees a text is never sent twice to the same carer,
// even across restarts. If a shift is handed to a different carer, that carer gets their own text.
// In dry-run mode nothing is written to Supabase, claims live in memory only.
const memory = new Set();

function headers(extra = {}) {
  return {
    apikey: config.supabase.key,
    Authorization: `Bearer ${config.supabase.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

const table = () => `${config.supabase.url}/rest/v1/carer_text_log`;
const dry = () => config.smsMode !== 'live' || Boolean(config.onlyPhone);
const where = (shiftId, kind, carerId) =>
  `?shift_id=eq.${encodeURIComponent(shiftId)}&kind=eq.${encodeURIComponent(kind)}&carer_id=eq.${encodeURIComponent(carerId)}`;

// Returns true if this caller now owns the (shift, kind, carer) send.
async function claim(shiftId, kind, carerId) {
  if (dry()) {
    const k = `${shiftId}:${kind}:${carerId}`;
    if (memory.has(k)) return false;
    memory.add(k);
    return true;
  }
  const res = await fetch(table(), {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ shift_id: shiftId, kind, carer_id: carerId, status: 'claimed' }),
  });
  if (res.status === 201) return true;
  if (res.status === 409) return false;
  throw new Error(`Supabase claim failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function finish(shiftId, kind, carerId, fields) {
  if (dry()) return;
  const res = await fetch(table() + where(shiftId, kind, carerId), {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) console.error(`Supabase update failed: ${res.status}`);
}

// Give the claim back so the next tick can retry (used when sending failed).
async function release(shiftId, kind, carerId) {
  if (dry()) {
    memory.delete(`${shiftId}:${kind}:${carerId}`);
    return;
  }
  const res = await fetch(table() + where(shiftId, kind, carerId), { method: 'DELETE', headers: headers() });
  if (!res.ok) console.error(`Supabase release failed: ${res.status}`);
}

module.exports = { claim, finish, release };
