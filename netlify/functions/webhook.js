// POST /webhook
//
// Accepts a single event or an array of events from any broker / connector.
// Stores in Netlify Blobs keyed by event_id (idempotent — same event_id wins).
// The dashboard polls /events?since=<cursor> to pull new events.

import { getStore } from '@netlify/blobs';

const STORE_NAME   = 'trade-events';
const SECRET_ENV   = 'WEBHOOK_SECRET';
const REQUIRED_FIELDS = ['event_id', 'type', 'instrument', 'direction', 'quantity', 'price', 'timestamp'];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret'
  };
}

function bad(status, msg) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST')    return bad(405, 'POST only');

  // Optional shared-secret check (set WEBHOOK_SECRET env var in Netlify)
  const expected = process.env[SECRET_ENV];
  if (expected) {
    const got = req.headers.get('x-webhook-secret');
    if (got !== expected) return bad(401, 'invalid secret');
  }

  let body;
  try { body = await req.json(); }
  catch { return bad(400, 'invalid JSON'); }

  const events = Array.isArray(body) ? body : [body];
  const store  = getStore({ name: STORE_NAME, consistency: 'strong' });

  const accepted = [];
  const skipped  = [];
  for (const ev of events) {
    const missing = REQUIRED_FIELDS.filter(f => ev?.[f] == null);
    if (missing.length) { skipped.push({ event_id: ev?.event_id, reason: `missing ${missing.join(',')}` }); continue; }

    // Sequential timestamp-prefixed key keeps natural sort order
    const ts  = new Date(ev.timestamp).getTime();
    if (!isFinite(ts)) { skipped.push({ event_id: ev.event_id, reason: 'bad timestamp' }); continue; }

    const key = `${String(ts).padStart(15, '0')}-${ev.event_id}`;

    // Idempotent: skip if exists
    const existing = await store.get(key, { type: 'json' });
    if (existing) { skipped.push({ event_id: ev.event_id, reason: 'duplicate' }); continue; }

    const stored = {
      ...ev,
      received_at: new Date().toISOString()
    };
    await store.setJSON(key, stored, { metadata: { event_id: ev.event_id, ts } });
    accepted.push(ev.event_id);
  }

  return new Response(
    JSON.stringify({ ok: true, accepted: accepted.length, skipped: skipped.length, details: { accepted, skipped } }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
  );
};

export const config = { path: '/webhook' };
