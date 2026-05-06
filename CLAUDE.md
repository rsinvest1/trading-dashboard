# CLAUDE.md — Trading Dashboard Project Memory

> Read this first. This file is the canonical context for any Claude Code session working on this repo.
> If you're a new Claude instance picking this up, you have everything you need below to continue safely.

---

## Project at a glance

**What it is:** A personal trading journal and behavioral risk control system for a futures trader.
React 18 + Vite + Tailwind + Zustand. Pure client-side except for two Netlify Functions that handle real-time webhook ingestion. Persists to browser localStorage; backups via Settings → Export/Import JSON.

**Who uses it:** A solo futures trader running two prop firm accounts (Tradeify Lightning Funded 150k + Daytraders.com Straight to Sim Funded EOD 150k) on Quantower/Rithmic. Instruments: NQ, GC, CL.

**Core thesis:** This is **not** passive journaling. It is a real-time behavioral risk control system designed to **interrupt overtrading at the moment it starts** — mandatory post-trade classification, kill-switch lockouts on consecutive errors, recovery mode on emotional escalation.

---

## Live deployment

| | |
|---|---|
| **Live URL** | https://trading-dashboard-rs.netlify.app |
| **Webhook URL** | https://trading-dashboard-rs.netlify.app/webhook |
| **Events poll URL** | https://trading-dashboard-rs.netlify.app/events?since=&lt;cursor&gt; |
| **GitHub repo** | https://github.com/rsinvest1/trading-dashboard |
| **Netlify project** | `trading-dashboard-rs` (team: RSInvest) |
| **Auto-deploy** | Every push to `main` → Netlify auto-builds |

**Netlify env vars** (configured in dashboard, not in code):
- `WEBHOOK_SECRET` — optional. If set, webhook requires `X-Webhook-Secret` header.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Quantower / connector script                                │
│        │  POST /webhook  { event_id, position_id, ... }      │
│        ▼                                                     │
│  Netlify Function: webhook.js                                │
│        │  Idempotent store (Netlify Blobs by event_id)       │
│        ▼                                                     │
│  Netlify Function: events.js  (GET /events?since=cursor)     │
│        ▲                                                     │
│        │  poll every 2s                                      │
│  React app (useWebhookPoller hook)                           │
│        │                                                     │
│        ▼                                                     │
│  positionAggregator.js                                       │
│        │  When net qty returns to 0 + is_closing=true →      │
│        │  emit completed trade                               │
│        ▼                                                     │
│  store.ingestTrade(t)                                        │
│        │                                                     │
│        ▼                                                     │
│  PostTradeModal — MANDATORY classification                   │
│        │  Plan|Error + emotion (+ if error: reason+emotion)  │
│        ▼                                                     │
│  store.classifyTrade()  ← Behavior Engine state machine      │
│        │                                                     │
│        ├──→ normal / paused / locked / recovery transitions  │
│        └──→ Drives BehaviorOverlay UI:                       │
│             • PauseCountdown (red banner, mandatory cooldown)│
│             • KillSwitchScreen (full-page lock, override log)│
│             • RecoveryBanner (yellow, reduced trade cap)     │
└──────────────────────────────────────────────────────────────┘
```

### State Modes

| Mode | Trigger | Effect |
|------|---------|--------|
| **normal** | default | Trading allowed |
| **paused** | any error trade classification | Quick Add disabled; full-width red banner with countdown (default 5 min) |
| **locked** | 2 consecutive errors OR >3 trades in 5 min after error | Full-page kill screen with countdown (default 45 min); override requires note ≥20 chars (logged permanently) |
| **recovery** | emotion=urgent | Yellow banner; reduced trade cap (default 2/hr, 10 min between); exits on 2 calm streak OR 30 min idle |

All thresholds are tunable in **Settings → Behavior Engine**.

---

## Repo layout

```
dashboard/
├── netlify.toml                    # Netlify build + redirect config
├── netlify/functions/
│   ├── webhook.js                  # POST /webhook  (deal ingestion, idempotent)
│   └── events.js                   # GET  /events?since=cursor (poll source)
├── src/
│   ├── App.jsx                     # Routes + global overlays
│   ├── main.jsx                    # Vite entry
│   ├── store/useStore.js           # Zustand store + Behavior Engine state machine
│   ├── components/
│   │   ├── BehaviorOverlay.jsx     # PauseCountdown, RecoveryBanner, KillSwitchScreen, PersistentRuleBanner
│   │   ├── PostTradeModal.jsx      # Mandatory Plan/Error + emotion modal
│   │   ├── QuickAddTrade.jsx       # Manual trade entry (gated by canTradeNow())
│   │   ├── InSessionControlPanel.jsx  # Live status: last trade, emotion, allowed?, errors, score
│   │   ├── WebhookLiveBadge.jsx    # ● Live indicator in Trade Log header
│   │   ├── WebhookSettings.jsx     # Settings panel: webhook URL, test, polling toggle
│   │   ├── TradeDetailDrawer.jsx   # Slide-in editor for any trade
│   │   ├── TpSlEditor.jsx          # Multi-TP/SL editor with auto R-multiple
│   │   ├── TagPicker.jsx           # Categorized tag pill picker
│   │   ├── RulesChecklist.jsx      # Strategy rules-followed checklist
│   │   ├── CsvImporter.jsx         # CSV import (with optional Live mode)
│   │   ├── Sidebar.jsx             # Nav
│   │   └── ...                     # StatCard, charts, PropFirmRiskBar, etc.
│   ├── pages/
│   │   ├── DashboardPage.jsx       # Stats, charts, Behavior Engine panel, Prop firm risk
│   │   ├── TradeLogPage.jsx        # Sortable/filterable trade table; row click → drawer
│   │   ├── PlaybookPage.jsx        # Date-bound pre-trade context records
│   │   ├── StrategiesPage.jsx      # Reusable trading models with rule lists
│   │   ├── JournalPage.jsx         # Per-day pre-trade notes, mood, lessons
│   │   ├── CalendarPage.jsx        # Calendar view of P&L
│   │   └── SettingsPage.jsx        # Accounts, tag categories, Behavior Engine tunables, override log, webhook, backup
│   └── utils/
│       ├── useWebhookPoller.js     # Polls /events every 2s, runs through positionAggregator
│       ├── positionAggregator.js   # Group deals by position_id → completed trade
│       ├── tradeAggregator.js      # CSV-fill aggregator (existing path)
│       ├── csvParser.js            # Quantower/Rithmic CSV parser
│       ├── calculations.js         # P&L, win rate, profit factor, R-multiple math
│       ├── analytics.js            # Day-of-week, intraday heatmap, etc.
│       └── instruments.js          # Symbols + point values
└── docs/
    └── SESSION_HANDOFF.md          # Most recent session's state + next steps
```

---

## Webhook contract (Quantower → dashboard)

The Quantower-side agent (separate Claude instance) is wiring up the broker plugin. They post to `/webhook`. **Don't change this contract without coordinating with that side.**

```json
{
  "event_id":    "uuid-v4",       // unique per deal; duplicates are dropped
  "source":      "quantower",
  "type":        "deal",
  "trade_id":    "string",
  "position_id": "string",        // SAME id for all deals of one round-trip
  "instrument":  "NQM6",
  "direction":   "buy" | "sell",
  "quantity":    1,
  "price":       19500.25,
  "pnl":         0,               // realized; non-zero only on closing deals
  "fees":        0.62,
  "timestamp":   "2026-05-02T14:30:00.000Z",
  "is_closing":  false            // true on the deal that flattens position
}
```

Headers (if `WEBHOOK_SECRET` is set in Netlify):
```
X-Webhook-Secret: <secret>
```

The aggregator emits a completed trade only when `is_closing=true` AND running net qty returns to 0.

---

## Persistence & schema versioning

Persisted in `localStorage` under key `trading-dashboard-v2`. Schema is versioned via Zustand persist middleware.

| Version | Migration |
|---------|-----------|
| **v0 → v1** | Flat `behavior_tags` → categorized `tag_categories`; rename `patterns` → `strategies`; per-trade `behavior_tags: string[]` → `tags: { [catId]: tagId[] }` |
| **v1 → v2** | Add Behavior Engine fields: `trade_type`, `post_trade_state`, `error_reason`, `error_emotion`, `is_post_error_trade`, `time_since_last_trade_sec`, `impulsive_trade_flag`, `classified_at`. Add `behaviorState` slice and `overrideLog`. |

Migration code lives in `useStore.js` — `migrateV0toV1()` and `migrateV1toV2()`.
**Always bump the version when changing persisted shape.** Add a new `migrateVN-1toVN()` and chain it in the `migrate` function.

---

## Trade schema (current, v1+)

```js
{
  id: 'string',
  account_id: 'string',
  account_id_raw: 'string',  // CSV import only
  fingerprint: 'string',     // dedup hash for re-imports
  date: 'YYYY-MM-DD',
  time: 'HH:MM',
  ticker: 'NQ',
  symbol: 'NQM6',
  side: 'Long' | 'Short',
  contracts: 1,
  entry: 19500.25,
  exit:  19510.50,
  pnl:   200,
  fees:  0.62,
  fills_count: 4,
  source: 'csv' | 'quick_add' | 'webhook',

  // Risk / R-multiple (Phase 1 of feature expansion)
  tp_levels: [{ id, price, contracts, percent }],
  sl_levels: [{ id, price, contracts, percent }],
  planned_target_dollars: null,
  planned_risk_dollars: null,
  rr_actual: null,
  stop_loss_dollars: null,

  // Tagging (Phase 2)
  tags: { [categoryId]: [tagId, ...] },

  // Strategy linkage (Phase 3)
  strategy_id: null,
  rules_followed: [],

  // Misc journal
  playbook_id: null,
  screenshot: null,         // data URL
  execution_rating: null,   // 1-5
  notes: null,

  // Behavior Engine fields (Phase 5 — Behavior Engine)
  trade_type: 'plan' | 'error' | null,
  post_trade_state: 'calm' | 'neutral' | 'frustrated' | 'urgent' | null,
  error_reason: 'string' | null,
  error_emotion: 'frustration' | 'urgency' | 'fomo' | 'anger' | null,
  is_post_error_trade: false,
  time_since_last_trade_sec: null,
  impulsive_trade_flag: false,
  classified_at: 'ISO8601' | null
}
```

---

## Conventions / things to know

- **Tailwind theme tokens** (defined in `tailwind.config.js`): `bg.{DEFAULT,card,hover,border}`, `accent.{green,red,yellow,blue,green-soft,red-soft}`, `text.{primary,secondary,muted}`. Use these — **do not hardcode hex colors**.
- **Money formatting:** always `fmtMoney(n)` from `utils/calculations.js`.
- **R-multiple formatting:** `fmtR(n)`.
- **Symbol → ticker:** `tickerFromSymbol('NQM6')` returns `'NQ'`.
- **`uid()`:** use `Math.random().toString(36).slice(2, 10)` (already used everywhere).
- **No external API keys** are required to run this app locally. Just `npm run dev`.
- **No backend database** — Netlify Blobs only stores webhook events for ~24h polling cursor; the dashboard owns canonical trade state in localStorage.
- **Don't add CSS files.** Use Tailwind utility classes.
- **State management:** all state through `useStore`. Don't introduce React Context or another store unless there's a strong reason.

---

## Behavior Engine state machine reference

```js
// store.ingestTrade(rawTrade)
//   ↓ creates trade with pending_classification_id, computes flags

// store.classifyTrade(id, { trade_type, post_trade_state, ... })
//   ↓ runs the state machine

// On 'plan' trade:
//   consecutive_errors = 0
//   mode stays normal (or recovery if currently recovery)

// On 'error' trade:
//   consecutive_errors += 1
//   pause_until = now + cfg.pause_minutes
//   mode = 'paused'
//   if consecutive_errors >= cfg.kill_consecutive_errors:
//     lock_until = now + cfg.kill_lock_minutes
//     mode = 'locked'

// On post_error_window_trades >= cfg.kill_post_error_count
//   within cfg.kill_post_error_window_min minutes:
//     lock_until = now + cfg.kill_lock_minutes
//     mode = 'locked'

// On post_trade_state === 'urgent' (and not already locked/paused):
//   mode = 'recovery'

// store.tickBehavior() — runs every 1s via useBehaviorTick:
//   expires pause/lock when timer hits 0
//   exits recovery on 2 calm streak OR cfg.recovery_idle_minutes_to_exit idle

// store.canTradeNow() — gate function used by QuickAddTrade:
//   returns { allowed: bool, reason: string, wait_sec?: number }
//   honors pause, lock, recovery spacing, recovery cap

// store.overrideLock(note) — manual unlock (logged permanently in overrideLog)
```

---

## Dev workflow

```bash
cd dashboard
npm install      # first time only
npm run dev      # local dev: http://localhost:5173
npm run build    # production bundle to dist/
```

**Deploy:** push to `main` → Netlify auto-deploys (~2 min).

**Backup data:** in the running app, Settings → Backup → Export JSON. Save the file — it's a full snapshot.

---

## Outstanding / known issues

See `docs/SESSION_HANDOFF.md` for the most recent session's open threads.

---

## Plan files (historical context)

The project's evolution is captured in two plan files (kept in `docs/plans/`):
- `original-tradervue-plan.md` — original requirements + scope
- `feature-expansion-plan.md` — Multi-TP/SL, categorized tags, strategies, pre-trade notes, TradeDetailDrawer
