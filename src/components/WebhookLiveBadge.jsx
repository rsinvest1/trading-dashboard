import { Radio, Pause } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * Compact live-status pill rendered in the Trade Log header.
 * One click toggles real-time webhook polling on/off.
 */
export default function WebhookLiveBadge() {
  const live = useStore(s => s.webhook.live_mode);
  const lastPoll = useStore(s => s.webhook.last_poll_at);
  const setLive  = useStore(s => s.setWebhookLiveMode);

  const ageSec = lastPoll ? Math.round((Date.now() - new Date(lastPoll).getTime()) / 1000) : null;

  return (
    <button
      onClick={() => setLive(!live)}
      title={live ? 'Click to stop live polling' : 'Click to start live polling'}
      className={`flex items-center gap-1.5 px-2.5 py-2 text-xs rounded font-mono uppercase tracking-wider border transition-colors ${
        live
          ? 'border-accent-green/40 text-accent-green bg-accent-green/5'
          : 'border-bg-border text-text-muted hover:text-text-secondary'
      }`}
    >
      {live ? (
        <>
          <Radio size={12} className="animate-pulse" />
          Live
          {ageSec != null && <span className="text-text-muted ml-1">·{ageSec}s</span>}
        </>
      ) : (
        <>
          <Pause size={12} />
          Live off
        </>
      )}
    </button>
  );
}
