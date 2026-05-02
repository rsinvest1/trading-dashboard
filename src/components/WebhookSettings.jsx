import { useState } from 'react';
import { Copy, Check, Send, Radio, RotateCcw } from 'lucide-react';
import { useStore } from '../store/useStore';

const SAMPLE_DEAL = {
  event_id: 'TEST-' + Math.random().toString(36).slice(2, 10),
  source: 'manual_test',
  type: 'deal',
  trade_id: 'T-1',
  position_id: 'POS-' + Math.random().toString(36).slice(2, 6),
  instrument: 'NQM6',
  direction: 'buy',
  quantity: 1,
  price: 19500.25,
  pnl: 0,
  fees: 0.62,
  timestamp: new Date().toISOString(),
  is_closing: false
};

export default function WebhookSettings() {
  const live    = useStore(s => s.webhook.live_mode);
  const lastPoll = useStore(s => s.webhook.last_poll_at);
  const lastStatus = useStore(s => s.webhook.last_status);
  const positions = useStore(s => s.webhook.positions || {});
  const seenCount = useStore(s => (s.webhook.seen_event_ids || []).length);
  const setLive  = useStore(s => s.setWebhookLiveMode);
  const reset    = useStore(s => s.resetWebhookPositions);

  const [copied, setCopied]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/webhook`;
  const eventsUrl  = `${origin}/events`;

  function copy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function sendTest() {
    setTesting(true);
    setTestRes(null);
    try {
      const res = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...SAMPLE_DEAL, event_id: 'TEST-' + Date.now() })
      });
      const data = await res.json();
      setTestRes(res.ok ? `OK · accepted ${data.accepted}` : `FAIL · ${data.error || res.status}`);
    } catch (err) {
      setTestRes('FAIL · ' + (err.message || 'network'));
    } finally {
      setTesting(false);
    }
  }

  const openCount = Object.keys(positions).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-text-secondary">Real-time Webhook</h2>
        <button
          onClick={() => setLive(!live)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded font-medium border transition-colors ${
            live
              ? 'border-accent-green text-accent-green bg-accent-green/10'
              : 'border-bg-border text-text-secondary hover:border-text-muted'
          }`}
        >
          <Radio size={12} className={live ? 'animate-pulse' : ''} />
          {live ? 'Live polling ON' : 'Live polling OFF'}
        </button>
      </div>
      <p className="text-xs text-text-muted">
        Configure your broker / connector to POST trade events to the URL below. The dashboard polls
        every 2 seconds in live mode, deduplicates by <code className="text-accent-green">event_id</code>,
        aggregates deals by <code className="text-accent-green">position_id</code>, and triggers the
        Behavior Engine on each completed trade.
      </p>

      <div className="card p-4 space-y-3">
        {/* Webhook URL */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Webhook URL (POST)</div>
          <div className="flex gap-2">
            <code className="flex-1 bg-bg border border-bg-border rounded px-2 py-1.5 text-xs font-mono break-all">
              {webhookUrl}
            </code>
            <button
              onClick={() => copy(webhookUrl)}
              className="px-2 py-1.5 text-xs border border-bg-border rounded hover:border-accent-green/40 hover:text-accent-green flex items-center gap-1"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Polled events URL (GET)</div>
          <code className="block bg-bg border border-bg-border rounded px-2 py-1.5 text-xs font-mono break-all text-text-muted">
            {eventsUrl}?since=&lt;cursor&gt;
          </code>
        </div>

        {/* Live state */}
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-bg-border text-xs">
          <Stat label="Last poll"   value={lastPoll ? new Date(lastPoll).toLocaleTimeString() : '—'} />
          <Stat label="Last status" value={lastStatus || '—'} tone={lastStatus === 'completed' ? 'text-accent-green' : 'text-text-secondary'} />
          <Stat label="Open positions" value={openCount} sub={`${seenCount} events seen`} />
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={sendTest}
            disabled={testing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft disabled:opacity-40"
          >
            <Send size={12} /> {testing ? 'Sending…' : 'Send test deal'}
          </button>
          {testRes && (
            <span className={`self-center text-xs ${testRes.startsWith('OK') ? 'text-accent-green' : 'text-accent-red'}`}>
              {testRes}
            </span>
          )}
          <button
            onClick={() => { if (confirm('Clear open positions and event-id dedupe set?')) reset(); }}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-accent-yellow"
          >
            <RotateCcw size={12} /> Reset positions
          </button>
        </div>
      </div>

      <details className="card p-3 text-xs">
        <summary className="cursor-pointer text-text-secondary">Example POST payload</summary>
        <pre className="mt-2 bg-bg border border-bg-border rounded p-3 text-[11px] font-mono whitespace-pre-wrap overflow-auto">
{`POST ${webhookUrl}
Content-Type: application/json

${JSON.stringify(SAMPLE_DEAL, null, 2)}`}
        </pre>
        <p className="mt-2 text-text-muted">
          Set <code>is_closing: true</code> on the deal that flattens the position. The aggregator
          waits until net qty is zero before emitting a completed trade.
        </p>
      </details>
    </section>
  );
}

function Stat({ label, value, tone = 'text-text-primary', sub }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`font-mono ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}
