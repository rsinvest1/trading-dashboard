// GET /events?since=<cursor>
//
// Returns events newer than the given cursor (ms-timestamp string).
// Cursor is the key of the last event the client has seen.
// Response includes `nextCursor` so the client can advance.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'trade-events';
const PAGE_SIZE  = 200;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });

  const url    = new URL(req.url);
  const since  = url.searchParams.get('since') || '';
  const store  = getStore({ name: STORE_NAME, consistency: 'eventual' });

  // List all keys; filter to those after `since`. Blobs keys are sorted
  // lexicographically, so timestamp-prefix keys give chronological order.
  const { blobs = [] } = await store.list({ paginate: false });
  const keys = blobs
    .map(b => b.key)
    .filter(k => k > since)
    .sort()
    .slice(0, PAGE_SIZE);

  const events = await Promise.all(
    keys.map(async k => ({ key: k, ...(await store.get(k, { type: 'json' })) }))
  );

  const nextCursor = keys.length ? keys[keys.length - 1] : since;

  return new Response(
    JSON.stringify({ ok: true, events, nextCursor }),
    {
      status: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders()
      }
    }
  );
};

export const config = { path: '/events' };
