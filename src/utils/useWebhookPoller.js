import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

const POLL_INTERVAL_MS = 2000;
const EVENTS_ENDPOINT  = '/events';

/**
 * Polls the /events Netlify Function while live_mode is on. Every batch is
 * fed into the store's processWebhookEvents — which handles dedupe,
 * position aggregation, and Behavior Engine ingestion.
 *
 * Mounted once at the top of the app (App.jsx).
 */
export function useWebhookPoller() {
  const liveMode = useStore(s => s.webhook.live_mode);
  const cursor   = useStore(s => s.webhook.cursor);
  const setCursor = useStore(s => s.setWebhookCursor);
  const process  = useStore(s => s.processWebhookEvents);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!liveMode) return;
    let cancelled = false;

    async function tick() {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const url = `${EVENTS_ENDPOINT}?since=${encodeURIComponent(cursor || '')}`;
        const res = await fetch(url, { headers: { 'Cache-Control': 'no-store' } });
        if (!res.ok) throw new Error(`events ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.events?.length) process(data.events);
        if (data.nextCursor && data.nextCursor !== cursor) setCursor(data.nextCursor);
      } catch (err) {
        // Soft-fail: keep polling, surface via behavior state in UI later
        console.warn('[webhook poll]', err);
      } finally {
        inFlight.current = false;
      }
    }

    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [liveMode, cursor, process, setCursor]);
}
