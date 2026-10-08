const config = require('../lib/config');

// Send log. One row per (shift, kind) guarantees a text is never sent twice, even across restarts.
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
const dry = () => config.smsMode !== 'live';

// Returns true if this caller now owns the (shift, kind) send.
async function claim(shiftId, kind) {
  if (dry()) {
    const k = `${shiftId}:${kind}`;
    if (memory.has(k)) return false;
    memory.add(k);
    return true;
  }
  const res = await fetch(table(), {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ shift_id: shiftId, kind, status: 'claimed' }),
  });
  if (res.status === 201) return true;
  if (res.status === 409) return false;
  throw new Error(`Supabase claim failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

async function finish(shiftId, kind, fields) {
  if (dry()) return;
  const q = `?shift_id=eq.${encodeURIComponent(shiftId)}&kind=eq.${encodeURIComponent(kind)}`;
  const res = await fetch(table() + q, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) console.error(`Supabase update failed: ${res.status}`);
}

// Give the claim back so the next tick can retry (used when sending failed).
async function release(shiftId, kind) {
  if (dry()) {
    memory.delete(`${shiftId}:${kind}`);
    return;
  }
  const q = `?shift_id=eq.${encodeURIComponent(shiftId)}&kind=eq.${encodeURIComponent(kind)}`;
  const res = await fetch(table() + q, { method: 'DELETE', headers: headers() });
  if (!res.ok) console.error(`Supabase release failed: ${res.status}`);
}

module.exports = { claim, finish, release };
