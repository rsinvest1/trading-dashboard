import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_BEHAVIOR_TAGS = [
  'Revenge trade', 'FOMO entry', 'Stuck to plan', 'Early exit',
  'Late entry', 'Oversize', 'Moved stop', 'Chased'
];

const uid = () => Math.random().toString(36).slice(2, 10);

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
    planned_target_dollars: null,
    planned_risk_dollars: null,
    tags: {},                 // { [categoryId]: [tagId, ...] }
    strategy_id: null,
    rules_followed: [],
    playbook_id: null,
    screenshot: null,
    execution_rating: null,
    notes: null
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
      behavior_tags: undefined  // dropped; harmless if persisted as undefined
    }
  };
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
      tendencies: [],
      accounts: DEFAULT_ACCOUNTS,
      settings: {
        tag_categories: defaultTagCategories(),
        csv_column_map: {},
        csv_account_map: {}
      },

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
        playbooks: [...s.playbooks, {
          id: uid(),
          title: p.title ?? '',
          date: p.date ?? new Date().toISOString().slice(0, 10),
          time: p.time ?? '',
          setup_name: p.setup_name ?? '',
          instruments: p.instruments ?? [],
          catalysts: p.catalysts ?? [],
          context: p.context ?? '',
          charts: p.charts ?? [],
          outcome: p.outcome ?? '',
          created_at: new Date().toISOString()
        }]
      })),
      updatePlaybook: (id, patch) => set((s) => ({
        playbooks: s.playbooks.map(p => p.id === id ? { ...p, ...patch } : p)
      })),
      deletePlaybook: (id) => set((s) => ({ playbooks: s.playbooks.filter(p => p.id !== id) })),

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

      exportData: () => {
        const s = get();
        return JSON.stringify({
          trades: s.trades, sessions: s.sessions, bestOpps: s.bestOpps,
          patterns: s.patterns, strategies: s.strategies,
          playbooks: s.playbooks, tendencies: s.tendencies,
          accounts: s.accounts, settings: s.settings,
          exported_at: new Date().toISOString(),
          schema_version: 1
        }, null, 2);
      },
      importData: (json) => {
        const d = typeof json === 'string' ? JSON.parse(json) : json;
        const isV0 = !d.schema_version || d.schema_version < 1;
        const next = isV0
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
        set({
          trades:    next.trades     ?? [],
          sessions:  next.sessions   ?? [],
          bestOpps:  next.bestOpps   ?? [],
          patterns:  next.patterns   ?? [],
          strategies: next.strategies ?? [],
          playbooks: next.playbooks  ?? [],
          tendencies: next.tendencies ?? [],
          accounts:  next.accounts   ?? DEFAULT_ACCOUNTS,
          settings: {
            tag_categories: next.settings?.tag_categories || defaultTagCategories(),
            csv_column_map: next.settings?.csv_column_map || {},
            csv_account_map: next.settings?.csv_account_map || {}
          }
        });
      }
    }),
    {
      name: 'trading-dashboard-v2',
      version: 1,
      migrate: (persisted, fromVersion) => {
        if (fromVersion < 1) return migrateV0toV1(persisted || {});
        return persisted;
      }
    }
  )
);
