import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyEvents } from '../utils/positionAggregator';
import { tickerFromSymbol } from '../utils/instruments';
import { extractImages, inlineImages, putImages, clearAllImages } from '../utils/imageStore';

const DEFAULT_BEHAVIOR_TAGS = [
  'Revenge trade', 'FOMO entry', 'Stuck to plan', 'Early exit',
  'Late entry', 'Oversize', 'Moved stop', 'Chased'
];

const uid = () => Math.random().toString(36).slice(2, 10);

// True if `iso` is within `minutes` of now (used by Behavior Engine windows).
function withinMinutes(iso, minutes) {
  if (!iso) return false;
  const diff = (Date.now() - new Date(iso).getTime()) / 60_000;
  return diff <= minutes;
}

// ── Default tag taxonomy (replaces flat behavior_tags) ──────────────────
function defaultTagCategories() {
  return [
    {
      id: 'setups', label: 'Setups', color: 'green',
      tags: [
        { id: uid(), label: 'Opening drive' },
        { id: uid(), label: 'VWAP fade' },
        { id: uid(), label: 'Breakout' },
        { id: uid(), label: 'Range reversion' }
      ]
    },
    {
      id: 'mistakes', label: 'Mistakes', color: 'red',
      tags: DEFAULT_BEHAVIOR_TAGS.map(label => ({ id: uid(), label }))
    },
    {
      id: 'exit', label: 'Exit / TP', color: 'blue',
      tags: [
        { id: uid(), label: 'Hit TP' },
        { id: uid(), label: 'Hit SL' },
        { id: uid(), label: 'Manual exit' },
        { id: uid(), label: 'Trailed stop' },
        { id: uid(), label: 'No exit signal' }
      ]
    },
    {
      id: 'timeframe', label: 'Timeframe', color: 'yellow',
      tags: [
        { id: uid(), label: '1m' },
        { id: uid(), label: '5m' },
        { id: uid(), label: '15m' },
        { id: uid(), label: '1h' }
      ]
    },
    {
      id: 'confidence', label: 'Confidence', color: 'muted',
      tags: [
        { id: uid(), label: 'High' },
        { id: uid(), label: 'Medium' },
        { id: uid(), label: 'Low' }
      ]
    }
  ];
}

const DEFAULT_ACCOUNTS = [
  {
    id: 'tradeify-lf-150k',
    firm_name: 'Tradeify Lightning Funded 150k',
    account_size: 150000,
    trailing_drawdown_limit: 5250,
    daily_loss_limit: 3000,
    eod_rule: false,
    current_balance: 150000
  },
  {
    id: 'daytraders-sts-150k',
    firm_name: 'Daytraders.com Straight to Sim Funded EOD 150k',
    account_size: 150000,
    trailing_drawdown_limit: 6000,
    daily_loss_limit: 3750,
    eod_rule: true,
    current_balance: 150000
  }
];

// ── Per-trade defaults for new schema fields ────────────────────────────
function tradeDefaults() {
  return {
    tp_levels: [],
    sl_levels: [],
    duration_sec: null,        // seconds held: position open → flat (TP/SL/exit)
    planned_target_dollars: null,
    planned_risk_dollars: null,
    tags: {},                 // { [categoryId]: [tagId, ...] }
    strategy_id: null,
    rules_followed: [],
    playbook_id: null,
    screenshot_id: null,      // → IndexedDB image (see utils/imageStore)
    execution_rating: null,
    notes: null,
    // ── Behavior Engine fields (v2) ───────────────────────────────────
    trade_type: null,          // 'plan' | 'error' | null until classified
    post_trade_state: null,    // 'calm' | 'neutral' | 'frustrated' | 'urgent'
    error_reason: null,        // freeform text after error
    error_emotion: null,       // 'frustration' | 'urgency' | 'fomo' | 'anger'
    is_post_error_trade: false,
    time_since_last_trade_sec: null,
    impulsive_trade_flag: false,
    classified_at: null
  };
}

// ── Playbook factory ────────────────────────────────────────────────────
// Builds a fully-defaulted playbook from a partial. Always assigns a fresh id
// and only picks known fields (ignores transient draft fields like `_meta`).
// Shared by addPlaybook (one) and addPlaybooks (batch / OneNote import).
function playbookDefaults(p = {}) {
  return {
    id: uid(),
    title: p.title ?? '',
    date: p.date ?? new Date().toISOString().slice(0, 10),
    time: p.time ?? '',
    setup_name: p.setup_name ?? '',
    event_key: p.event_key ?? null,   // links playbook to a recurring release event
    instruments: p.instruments ?? [],
    catalysts: p.catalysts ?? [],
    context: p.context ?? '',
    charts: p.charts ?? [],
    outcome: p.outcome ?? '',
    created_at: new Date().toISOString()
  };
}

// ── Default Behavior Engine settings ────────────────────────────────────
function defaultBehaviorSettings() {
  return {
    pause_minutes: 5,           // mandatory pause after error
    kill_lock_minutes: 45,      // length of full lock
    kill_consecutive_errors: 2, // 2 errors in a row → lock
    kill_post_error_count: 3,   // >3 trades within 5min after error → lock
    kill_post_error_window_min: 5,
    impulsive_window_sec: 120,  // <2 min between trades after error
    recovery_max_trades_per_hour: 2,
    recovery_min_seconds_between: 600,  // 10 min between trades in recovery
    recovery_calm_streak_to_exit: 2,
    recovery_idle_minutes_to_exit: 30,
    override_min_reason_chars: 20,
    sound_alerts: true,
    browser_notifications: false
  };
}

function defaultBehaviorState() {
  return {
    mode: 'normal',            // 'normal' | 'paused' | 'locked' | 'recovery'
    pause_until: null,         // ISO datetime
    lock_until:  null,         // ISO datetime
    recovery_started_at: null,
    last_error_at: null,
    consecutive_errors: 0,
    post_error_window_trades: 0,
    last_trade_at: null,
    last_emotion: null,
    calm_streak: 0,
    pending_classification_id: null  // id of trade awaiting modal
  };
}

// ── Migration v0 → v1: convert flat behavior_tags into a categorized
//    taxonomy and move the old `patterns` collection to `strategies`. ────
function migrateV0toV1(state) {
  const oldSettings  = state?.settings || {};
  const flatTags     = Array.isArray(oldSettings.behavior_tags) ? oldSettings.behavior_tags : DEFAULT_BEHAVIOR_TAGS;

  // Build new taxonomy with the user's existing flat tags slotted into Mistakes
  const cats = defaultTagCategories();
  const mistakesCat = cats.find(c => c.id === 'mistakes');
  if (mistakesCat) {
    mistakesCat.tags = flatTags.map(label => ({ id: uid(), label }));
  }
  const labelToTagId = {};
  for (const cat of cats) for (const t of cat.tags) labelToTagId[t.label] = { catId: cat.id, tagId: t.id };

  // Translate old per-trade behavior_tags (flat string array) → new tags object
  const trades = (state?.trades || []).map(t => {
    const merged = { ...tradeDefaults(), ...t };
    if (Array.isArray(t.behavior_tags) && t.behavior_tags.length) {
      const tagsObj = {};
      for (const label of t.behavior_tags) {
        const m = labelToTagId[label];
        if (!m) continue;
        if (!tagsObj[m.catId]) tagsObj[m.catId] = [];
        tagsObj[m.catId].push(m.tagId);
      }
      merged.tags = tagsObj;
    }
    delete merged.behavior_tags;
    return merged;
  });

  return {
    ...state,
    trades,
    strategies: state?.strategies?.length ? state.strategies : (state?.patterns || []),
    settings: {
      ...oldSettings,
      tag_categories: oldSettings.tag_categories || cats,
      behavior: oldSettings.behavior || defaultBehaviorSettings(),
      behavior_tags: undefined
    },
    behaviorState: state?.behaviorState || defaultBehaviorState(),
    overrideLog: state?.overrideLog || []
  };
}

// ── Migration v1 → v2: add Behavior Engine fields ────────────────────────
function migrateV1toV2(state) {
  return {
    ...state,
    trades: (state?.trades || []).map(t => ({
      trade_type: null,
      post_trade_state: null,
      error_reason: null,
      error_emotion: null,
      is_post_error_trade: false,
      time_since_last_trade_sec: null,
      impulsive_trade_flag: false,
      classified_at: null,
      ...t
    })),
    settings: {
      ...(state?.settings || {}),
      behavior: state?.settings?.behavior || defaultBehaviorSettings()
    },
    behaviorState: state?.behaviorState || defaultBehaviorState(),
    overrideLog: state?.overrideLog || []
  };
}

// ── Migration v2 → v3: recompute `ticker` from `symbol` so newly-added
//    instruments (HG, 6B, 6E, …) resolve for already-stored trades, and add
//    the `duration_sec` field default. ────────────────────────────────────
function migrateV2toV3(state) {
  return {
    ...state,
    trades: (state?.trades || []).map(t => ({
      duration_sec: null,
      ...t,
      ticker: t.symbol ? tickerFromSymbol(t.symbol) : t.ticker
    }))
  };
}

// ── Migration v3 → v4: add `event_key` to playbooks so the morning-prep agent
//    can match a calendar release to its historical playbooks. ──────────────
function migrateV3toV4(state) {
  return {
    ...state,
    playbooks: (state?.playbooks || []).map(p => ({ event_key: null, ...p }))
  };
}

// ── Migration v4 → v5: add `playbookEventMeta` map for event-level metadata
//    (rating, etc.) keyed by event_key. ─────────────────────────────────────
function migrateV4toV5(state) {
  return { ...state, playbookEventMeta: state?.playbookEventMeta ?? {} };
}

// ── Migration v5 → v6: move inline image data URLs (chart.dataUrl,
//    trade.screenshot) out of localStorage and into IndexedDB, leaving only
//    lightweight references behind. The IDB writes are async, so we stash the
//    extracted images here and flush them in `onRehydrateStorage`. ──────────
let __pendingImageWrites = [];
function migrateV5toV6(state) {
  try {
    const { data, images } = extractImages(state || {});
    if (images.length) __pendingImageWrites.push(...images);
    return data;
  } catch {
    return state;
  }
}

export const useStore = create(
  persist(
    (set, get) => ({
      trades: [],
      sessions: [],
      bestOpps: [],
      patterns: [],          // legacy slot, kept for back-compat (unused)
      strategies: [],        // ← reusable trading models with rule checklists
      playbooks: [],
      playbookEventMeta: {}, // event-level metadata keyed by event_key: { rating }
      tendencies: [],
      accounts: DEFAULT_ACCOUNTS,
      settings: {
        tag_categories: defaultTagCategories(),
        csv_column_map: {},
        csv_account_map: {},
        behavior: defaultBehaviorSettings()
      },

      // ── Behavior Engine state (persisted) ─────────────────────────────
      behaviorState: defaultBehaviorState(),
      overrideLog: [],

      // ── Webhook ingestion (real-time) ─────────────────────────────────
      webhook: {
        live_mode: false,
        cursor: '',
        last_poll_at: null,
        last_status: null,
        seen_event_ids: [],   // FIFO bounded list for dedupe (last 500)
        positions: {}          // open positions keyed by position_id
      },

      setWebhookLiveMode: (on) => set((s) => ({
        webhook: { ...s.webhook, live_mode: !!on }
      })),

      // Process webhook events: dedupe by event_id, run through position
      // aggregator, ingest each completed trade into the Behavior Engine.
      processWebhookEvents: (events) => {
        const s = get();
        const seen = new Set(s.webhook.seen_event_ids || []);
        const fresh = (events || []).filter(e => e?.event_id && !seen.has(e.event_id));
        if (!fresh.length) {
          set({ webhook: { ...s.webhook, last_poll_at: new Date().toISOString(), last_status: 'idle' } });
          return { newEvents: 0, completed: 0 };
        }

        const { positions, completed } = applyEvents(s.webhook.positions || {}, fresh);

        // Bound the dedupe set to last 500 event ids
        const newSeen = [...(s.webhook.seen_event_ids || []), ...fresh.map(e => e.event_id)];
        const trimmedSeen = newSeen.length > 500 ? newSeen.slice(-500) : newSeen;

        set({
          webhook: {
            ...s.webhook,
            positions,
            seen_event_ids: trimmedSeen,
            last_poll_at: new Date().toISOString(),
            last_status: completed.length ? 'completed' : 'partial'
          }
        });

        // Ingest each completed trade — fingerprint dedupe vs existing trades
        const after = get();
        const existingFingerprints = new Set(
          after.trades.map(t => t.fingerprint || `${t.symbol}|${t.date}|${t.time}|${t.side}|${t.contracts}|${t.entry}|${t.exit}|${t.pnl}`)
        );
        for (const trade of completed) {
          const fp = `${trade.symbol}|${trade.date}|${trade.time}|${trade.side}|${trade.contracts}|${trade.entry}|${trade.exit}|${trade.pnl}`;
          if (existingFingerprints.has(fp)) continue;
          // Use ingestTrade so the Behavior Engine fires
          get().ingestTrade({ ...trade, fingerprint: fp });
        }

        return { newEvents: fresh.length, completed: completed.length };
      },

      setWebhookCursor: (cursor) => set((s) => ({
        webhook: { ...s.webhook, cursor }
      })),

      resetWebhookPositions: () => set((s) => ({
        webhook: { ...s.webhook, positions: {}, seen_event_ids: [] }
      })),

      // Process a trade event through the Behavior Engine. Returns the
      // newly-created trade id so the UI can open the post-trade modal.
      ingestTrade: (rawTrade) => {
        const id = uid();
        const now = new Date();
        const s = get();
        const last = s.behaviorState.last_trade_at ? new Date(s.behaviorState.last_trade_at) : null;
        const time_since_last_trade_sec = last ? Math.round((now - last) / 1000) : null;
        const is_post_error_trade = !!s.behaviorState.last_error_at;
        const cfg = s.settings.behavior || defaultBehaviorSettings();
        const impulsive_trade_flag = !!(
          is_post_error_trade &&
          time_since_last_trade_sec != null &&
          time_since_last_trade_sec < cfg.impulsive_window_sec
        );
        const trade = {
          id,
          ...tradeDefaults(),
          ...rawTrade,
          ingested_at: now.toISOString(),
          time_since_last_trade_sec,
          is_post_error_trade,
          impulsive_trade_flag
        };
        set({
          trades: [...s.trades, trade],
          behaviorState: {
            ...s.behaviorState,
            pending_classification_id: id,
            last_trade_at: now.toISOString(),
            // count post-error trades in the rolling window
            post_error_window_trades:
              is_post_error_trade && s.behaviorState.last_error_at
                ? withinMinutes(s.behaviorState.last_error_at, cfg.kill_post_error_window_min)
                  ? s.behaviorState.post_error_window_trades + 1
                  : s.behaviorState.post_error_window_trades
                : s.behaviorState.post_error_window_trades
          }
        });
        return id;
      },

      // Recovery-mode gate — UI calls this BEFORE Quick Add or live ingest
      // to check if a new trade is allowed. Returns:
      //   { allowed: true } | { allowed: false, reason: '...', wait_sec: N }
      canTradeNow: () => {
        const s = get();
        const bs = s.behaviorState;
        const cfg = s.settings.behavior || defaultBehaviorSettings();
        if (bs.mode === 'paused' || bs.mode === 'locked') {
          return { allowed: false, reason: bs.mode };
        }
        if (bs.mode === 'recovery' && bs.last_trade_at) {
          const sinceSec = (Date.now() - new Date(bs.last_trade_at).getTime()) / 1000;
          const minSpace = cfg.recovery_min_seconds_between || 600;
          if (sinceSec < minSpace) {
            return { allowed: false, reason: 'recovery_spacing', wait_sec: Math.ceil(minSpace - sinceSec) };
          }
          // Trades-per-hour cap
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          const recent = s.trades.filter(t =>
            t.ingested_at && new Date(t.ingested_at).getTime() >= oneHourAgo
          ).length;
          if (recent >= cfg.recovery_max_trades_per_hour) {
            return { allowed: false, reason: 'recovery_cap' };
          }
        }
        return { allowed: true };
      },

      // Apply user's classification + emotion → run state machine →
      // possibly transition into paused / locked / recovery mode.
      classifyTrade: (tradeId, { trade_type, post_trade_state, error_reason, error_emotion }) => {
        const s = get();
        const cfg = s.settings.behavior || defaultBehaviorSettings();
        const now = new Date();

        const updatedTrade = {
          trade_type,
          post_trade_state,
          error_reason: error_reason || null,
          error_emotion: error_emotion || null,
          classified_at: now.toISOString()
        };

        let bs = { ...s.behaviorState, pending_classification_id: null, last_emotion: post_trade_state };

        // Calm-streak tracking (used to exit Recovery mode)
        if (post_trade_state === 'calm') bs.calm_streak = (bs.calm_streak || 0) + 1;
        else bs.calm_streak = 0;

        if (trade_type === 'error') {
          bs.last_error_at = now.toISOString();
          bs.consecutive_errors = (bs.consecutive_errors || 0) + 1;
          bs.post_error_window_trades = 0;
          // Pause for cfg.pause_minutes
          bs.pause_until = new Date(now.getTime() + cfg.pause_minutes * 60_000).toISOString();
          bs.mode = 'paused';

          // Kill-switch: 2+ consecutive errors → full lock
          if (bs.consecutive_errors >= cfg.kill_consecutive_errors) {
            bs.lock_until = new Date(now.getTime() + cfg.kill_lock_minutes * 60_000).toISOString();
            bs.mode = 'locked';
          }
        } else {
          // Plan trade resets the consecutive-error counter
          bs.consecutive_errors = 0;
        }

        // Kill-switch: too many trades in the post-error window
        if (
          bs.post_error_window_trades >= cfg.kill_post_error_count &&
          bs.last_error_at &&
          withinMinutes(bs.last_error_at, cfg.kill_post_error_window_min)
        ) {
          bs.lock_until = new Date(now.getTime() + cfg.kill_lock_minutes * 60_000).toISOString();
          bs.mode = 'locked';
        }

        // Recovery mode trigger — emotional state = urgent
        if (post_trade_state === 'urgent' && bs.mode === 'normal') {
          bs.mode = 'recovery';
          bs.recovery_started_at = now.toISOString();
        }

        set({
          trades: s.trades.map(t => t.id === tradeId ? { ...t, ...updatedTrade } : t),
          behaviorState: bs
        });
      },

      // Run periodic check (called from a timer hook): expire pause/lock,
      // potentially exit Recovery on calm streak / idle.
      tickBehavior: () => {
        const s = get();
        const cfg = s.settings.behavior || defaultBehaviorSettings();
        const now = new Date();
        let bs = { ...s.behaviorState };
        let changed = false;

        // Expire pause
        if (bs.mode === 'paused' && bs.pause_until && new Date(bs.pause_until) <= now) {
          bs.mode = 'normal';
          bs.pause_until = null;
          changed = true;
        }
        // Expire lock
        if (bs.mode === 'locked' && bs.lock_until && new Date(bs.lock_until) <= now) {
          bs.mode = 'normal';
          bs.lock_until = null;
          bs.consecutive_errors = 0;
          bs.post_error_window_trades = 0;
          changed = true;
        }
        // Exit recovery on calm streak or idle
        if (bs.mode === 'recovery') {
          if (bs.calm_streak >= cfg.recovery_calm_streak_to_exit) {
            bs.mode = 'normal';
            bs.recovery_started_at = null;
            changed = true;
          } else if (bs.last_trade_at) {
            const idleMin = (now - new Date(bs.last_trade_at)) / 60_000;
            if (idleMin >= cfg.recovery_idle_minutes_to_exit) {
              bs.mode = 'normal';
              bs.recovery_started_at = null;
              changed = true;
            }
          }
        }
        if (changed) set({ behaviorState: bs });
      },

      // Manual override (logged for accountability)
      overrideLock: (note) => {
        const s = get();
        const now = new Date();
        set({
          behaviorState: {
            ...s.behaviorState,
            mode: 'normal',
            pause_until: null,
            lock_until: null,
            consecutive_errors: 0,
            post_error_window_trades: 0
          },
          overrideLog: [
            ...(s.overrideLog || []),
            {
              id: uid(),
              at: now.toISOString(),
              previous_mode: s.behaviorState.mode,
              note: note || ''
            }
          ]
        });
      },

      // Manual reset of behavior state (e.g. start of new day)
      resetBehaviorState: () => set({ behaviorState: defaultBehaviorState() }),

      addTrade: (t) => set((s) => ({ trades: [...s.trades, { id: uid(), ...tradeDefaults(), ...t }] })),
      addTrades: (newTrades) => set((s) => ({
        trades: [...s.trades, ...newTrades.map(t => ({ id: uid(), ...tradeDefaults(), ...t }))]
      })),
      updateTrade: (id, patch) => set((s) => ({
        trades: s.trades.map(t => t.id === id ? { ...t, ...patch } : t)
      })),
      deleteTrade: (id) => set((s) => ({ trades: s.trades.filter(t => t.id !== id) })),
      clearTrades: () => set({ trades: [] }),

      addSession: (sess) => set((s) => {
        const others = s.sessions.filter(x => x.date !== sess.date);
        return { sessions: [...others, sess] };
      }),

      addBestOpp: (o) => set((s) => ({ bestOpps: [...s.bestOpps, { id: uid(), ...o }] })),
      updateBestOpp: (id, patch) => set((s) => ({
        bestOpps: s.bestOpps.map(o => o.id === id ? { ...o, ...patch } : o)
      })),
      deleteBestOpp: (id) => set((s) => ({ bestOpps: s.bestOpps.filter(o => o.id !== id) })),

      addPattern: (p) => set((s) => ({ patterns: [...s.patterns, { id: uid(), ...p }] })),
      updatePattern: (id, patch) => set((s) => ({
        patterns: s.patterns.map(p => p.id === id ? { ...p, ...patch } : p)
      })),
      deletePattern: (id) => set((s) => ({ patterns: s.patterns.filter(p => p.id !== id) })),

      // Strategies — reusable models with rule checklists
      addStrategy: (p) => set((s) => ({
        strategies: [...s.strategies, {
          id: uid(),
          name: p.name ?? 'New strategy',
          color: p.color ?? 'green',
          description: p.description ?? '',
          entry_rules: p.entry_rules ?? [],
          exit_rules:  p.exit_rules  ?? [],
          created_at: new Date().toISOString()
        }]
      })),
      updateStrategy: (id, patch) => set((s) => ({
        strategies: s.strategies.map(p => p.id === id ? { ...p, ...patch } : p)
      })),
      deleteStrategy: (id) => set((s) => ({ strategies: s.strategies.filter(p => p.id !== id) })),

      addPlaybook: (p) => set((s) => ({
        playbooks: [...s.playbooks, playbookDefaults(p)]
      })),
      // Additive batch insert (mirrors addTrades) — used by the OneNote importer.
      // NEVER use importData() for this: that replaces the whole store.
      addPlaybooks: (arr) => set((s) => ({
        playbooks: [...s.playbooks, ...(arr || []).map(playbookDefaults)]
      })),
      updatePlaybook: (id, patch) => set((s) => ({
        playbooks: s.playbooks.map(p => p.id === id ? { ...p, ...patch } : p)
      })),
      deletePlaybook: (id) => set((s) => ({ playbooks: s.playbooks.filter(p => p.id !== id) })),
      setEventMeta: (key, patch) => set((s) => ({
        playbookEventMeta: {
          ...s.playbookEventMeta,
          [key]: { ...(s.playbookEventMeta[key] ?? {}), ...patch }
        }
      })),

      // Create an empty, first-class event key (shows as a 0-release group via meta).
      createEventKey: (key) => set((s) => {
        const k = (key || '').trim();
        if (!k) return {};
        const exists = s.playbookEventMeta[k] || s.playbooks.some(p => p.event_key === k);
        if (exists) return {};                      // no-op; UI navigates to the existing one
        return { playbookEventMeta: { ...s.playbookEventMeta, [k]: {} } };
      }),
      // Rename a key across all releases + metadata. If `newKey` already exists this
      // MERGES (releases re-point to it; target meta wins on field collisions).
      renameEventKey: (oldKey, newKey) => set((s) => {
        const from = (oldKey || '').trim(), to = (newKey || '').trim();
        if (!from || !to || from === to) return {};
        const meta = { ...s.playbookEventMeta };
        meta[to] = { ...(meta[from] ?? {}), ...(meta[to] ?? {}) };
        delete meta[from];
        return {
          playbooks: s.playbooks.map(p => p.event_key === from ? { ...p, event_key: to } : p),
          playbookEventMeta: meta,
        };
      }),
      // Delete a key AND its release records (per user decision). Removes meta too.
      deleteEventKey: (key) => set((s) => {
        const k = (key || '').trim();
        const meta = { ...s.playbookEventMeta }; delete meta[k];
        return {
          playbooks: s.playbooks.filter(p => p.event_key !== k),
          playbookEventMeta: meta,
        };
      }),

      addTendency: (t) => set((s) => ({
        tendencies: [...s.tendencies, {
          id: uid(),
          name: t.name,
          description: t.description ?? '',
          status: t.status ?? 'watching',
          seen_count: t.seen_count ?? 0,
          last_seen_date: t.last_seen_date ?? null,
          created_at: new Date().toISOString()
        }]
      })),
      updateTendency: (id, patch) => set((s) => ({
        tendencies: s.tendencies.map(t => t.id === id ? { ...t, ...patch } : t)
      })),
      deleteTendency: (id) => set((s) => ({ tendencies: s.tendencies.filter(t => t.id !== id) })),
      logTendencySighting: (id, date) => set((s) => ({
        tendencies: s.tendencies.map(t => t.id === id ? {
          ...t,
          seen_count: (t.seen_count || 0) + 1,
          last_seen_date: date || new Date().toISOString().slice(0, 10)
        } : t)
      })),

      addAccount: (a) => set((s) => ({ accounts: [...s.accounts, { id: uid(), ...a }] })),
      updateAccount: (id, patch) => set((s) => ({
        accounts: s.accounts.map(a => a.id === id ? { ...a, ...patch } : a)
      })),
      deleteAccount: (id) => set((s) => ({ accounts: s.accounts.filter(a => a.id !== id) })),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      // Async: re-inlines images from IndexedDB so the backup is one portable
      // JSON in the legacy format (charts[].dataUrl, trade.screenshot).
      exportData: async () => {
        const s = get();
        const withImages = await inlineImages({
          trades: s.trades, playbooks: s.playbooks
        });
        return JSON.stringify({
          trades: withImages.trades, sessions: s.sessions, bestOpps: s.bestOpps,
          patterns: s.patterns, strategies: s.strategies,
          playbooks: withImages.playbooks, playbookEventMeta: s.playbookEventMeta,
          tendencies: s.tendencies,
          accounts: s.accounts, settings: s.settings,
          exported_at: new Date().toISOString(),
          schema_version: 1
        }, null, 2);
      },
      // Async: pulls inline images out into IndexedDB so the localStorage write
      // stays tiny (no quota overflow), then replaces all state.
      importData: async (json) => {
        const d = typeof json === 'string' ? JSON.parse(json) : json;
        const isV0 = !d.schema_version || d.schema_version < 1;
        const migrated = isV0
          ? migrateV0toV1({
              trades:    d.trades    ?? [],
              sessions:  d.sessions  ?? [],
              bestOpps:  d.bestOpps  ?? [],
              patterns:  d.patterns  ?? [],
              strategies: d.strategies ?? [],
              playbooks: d.playbooks ?? [],
              tendencies: d.tendencies ?? [],
              accounts:  d.accounts  ?? DEFAULT_ACCOUNTS,
              settings:  d.settings  ?? {}
            })
          : d;
        // Separate images from the lightweight data, then swap IDB contents.
        const { data: next, images } = extractImages(migrated);
        await clearAllImages();
        await putImages(images);
        set({
          trades:    next.trades     ?? [],
          sessions:  next.sessions   ?? [],
          bestOpps:  next.bestOpps   ?? [],
          patterns:  next.patterns   ?? [],
          strategies: next.strategies ?? [],
          playbooks: next.playbooks  ?? [],
          playbookEventMeta: next.playbookEventMeta ?? {},
          tendencies: next.tendencies ?? [],
          accounts:  next.accounts   ?? DEFAULT_ACCOUNTS,
          settings: {
            tag_categories: next.settings?.tag_categories || defaultTagCategories(),
            csv_column_map: next.settings?.csv_column_map || {},
            csv_account_map: next.settings?.csv_account_map || {},
            behavior: next.settings?.behavior || defaultBehaviorSettings()
          }
        });
      }
    }),
    {
      name: 'trading-dashboard-v2',
      version: 6,
      migrate: (persisted, fromVersion) => {
        let next = persisted || {};
        if (fromVersion < 1) next = migrateV0toV1(next);
        if (fromVersion < 2) next = migrateV1toV2(next);
        if (fromVersion < 3) next = migrateV2toV3(next);
        if (fromVersion < 4) next = migrateV3toV4(next);
        if (fromVersion < 5) next = migrateV4toV5(next);
        if (fromVersion < 6) next = migrateV5toV6(next);
        return next;
      },
      // Flush images extracted during the v5→v6 migration into IndexedDB once
      // rehydration finishes (migrate() must stay synchronous).
      onRehydrateStorage: () => () => {
        if (__pendingImageWrites.length) {
          const batch = __pendingImageWrites;
          __pendingImageWrites = [];
          putImages(batch).catch(() => {});
        }
      }
    }
  )
);
