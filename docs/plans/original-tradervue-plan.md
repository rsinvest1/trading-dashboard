# Trading Dashboard — Custom TraderVue Plan

> Status: **Requirements Complete — Ready for Implementation**
> Last updated: 2026-04-25

---

## Context

Building a personalized daily trading dashboard (a custom TraderVue / Tradersync) for a futures trader on Quantower/Rithmic across two prop firm accounts (Tradeify Lightning Funded 150k + Daytraders.com Straight to Sim Funded EOD 150k). Instruments: NQ, GC (Gold), CL (Crude Oil).

The dashboard is updated every day with trades taken and best opportunities of the day. It's private but should look sharp enough to screenshot for a mentor/coach. The goal is deep personalization — tracking what matters specifically to this trader: R:R, execution quality, emotional state, time-of-day patterns, and named setups.

---

## Decisions Made (All Rounds Complete)

### Platform & Delivery
- **Format**: Web app — React + Vite, local build, opened in browser
- **CSS**: Tailwind CSS + custom Tradersync-style dark theme (dark bg, green accents)
- **Charts**: Recharts (React-native, dark-themed)
- **Storage**: localStorage (fast, always available) + JSON export/import button (OneDrive-friendly backup)
- **Location**: `C:\Users\VIVESCO-Capital\OneDrive\Claude Plan\dashboard\`

### Data Entry
- Hybrid: CSV import (flexible column-mapper to handle any Quantower export format) + manual entry form
- Both paths available every session; user picks what fits the day

### Audience & Sharing
- Private + mentor screenshots only — no export/hosting needed

---

## Full Tab List (in order)

| Tab | Description |
|-----|-------------|
| **Dashboard** | Key stats, prop firm risk tracker, streak tracker |
| **Playbook** | Daily Best Opps log (quick + detail mode) + Named Pattern Library |
| **Calendar** | Monthly P&L by day, color-coded green/red |
| **Trade Log** | Full sortable/filterable trade history |
| **Journal** | Structured session journal (pre-market plan, mood, lessons) |
| **Settings** | Prop firm account rules, behavior tags, default values |

---

## Dashboard Tab — Specs

### Top Stats Row (primary)
- Total P&L (period selector: day / week / month / all-time)
- Total Trades (W/L breakdown)
- Win Rate %
- Profit Factor
- Avg R:R

### Secondary Stats Row
- Max Drawdown
- Sharpe Ratio
- Expectancy ($ per trade)
- Best Trade (ticker + $)
- Worst Trade (ticker + $)
- Streaks — current streak + best win streak / worst loss streak
- Avg Win / Avg Loss

### Prop Firm Risk Tracker (both accounts, side by side)
- **Tradeify Lightning Funded 150k**: current balance, trailing drawdown level, daily P&L vs. daily loss limit — color warning bar (green → yellow → red)
- **Daytraders.com Straight to Sim Funded EOD 150k**: same layout, same warnings
- Rules editable in Settings tab (not hardcoded)

---

## Playbook Tab — Specs

### Section 1: Daily Best Opps Log
Each day's entries. Entry toggle: **Quick** vs. **Detail** mode.

**Quick mode fields**: Date, Ticker, Setup name (dropdown from library), One-line note
**Detail mode fields** (expand from quick): Screenshot attachment, Opportunity R:R, Did I take it? (Y/N), Why I passed (if N)

### Section 2: Pattern Library
A catalog of named setups. Each pattern card contains:
- Setup name + description
- Entry rules / exit rules / stop rules (structured text fields)
- Example screenshots (uploadable)
- Auto-calculated stats pulled from trade log: Win Rate, Avg P&L, Avg R:R, # of trades using this setup

---

## Calendar Tab — Specs
- Month/Week/Year toggle
- Daily cells: color intensity = magnitude of P&L (deep green = big win, deep red = big loss, neutral = small)
- Click a day → shows trades for that day in a drawer

---

## Trade Log Tab — Specs

### Columns
| Field | Type |
|-------|------|
| Date + Time | datetime |
| Ticker | GC / NQ / CL / MNQ / MGC / MCL |
| Side | Long / Short |
| Contracts | number |
| Entry price | number |
| Exit price | number |
| Stop loss ($) | risk defined |
| Net P&L ($) | computed |
| R:R actual | computed (P&L / risk) |
| Setup | dropdown → playbook pattern |
| Behavior tags | multi-select chips |
| Execution rating | 1–5 stars |
| Screenshot | image link/attachment |
| Notes | freeform text |

### Behavior Tag Seed List (editable in Settings)
`Revenge trade` · `FOMO entry` · `Stuck to plan` · `Early exit` · `Late entry` · `Oversize` · `Moved stop` · `Chased`

---

## Journal Tab — Specs

Each day has one journal entry with structured fields:
1. **Pre-market plan / bias**: What levels, direction bias, key news/catalysts today
2. **Mood check-in (before)**: Rating 1–5 + optional note
3. **Mood check-in (after)**: Rating 1–5 + optional note
4. **Lessons learned / what to improve**: Specific field — what went wrong, what I'd do differently, key takeaway

---

## Settings Tab — Specs
- **Prop firm accounts**: Add/edit accounts — name, account size, trailing drawdown $, daily loss limit $, EOD rule toggle
- **Behavior tags**: Add/remove/rename tags
- **Instruments**: View/edit tick/point values (GC, NQ, CL + micros)
- **CSV column mapper**: Map Quantower export column names to internal fields (for import)

---

## Instruments & Point Values

| Contract | Full Name | $/Point | Note |
|----------|-----------|---------|------|
| NQ | Nasdaq-100 | $20/pt | Micro MNQ = $2/pt |
| GC | Gold | $100/pt | Micro MGC = $10/pt |
| CL | Crude Oil | $1000/pt | Micro MCL = $100/pt |

---

## Visualizations (Analytics embedded in Dashboard/Playbook)

1. **P&L by setup/pattern** — horizontal bar chart, average net P&L per named setup
2. **Intraday time-of-day heat map** — grid: hour × day-of-week, color = avg P&L
3. **Win rate by day of week** — Mon–Fri bar chart

---

## Data Model (JSON storage)

### `trades.json`
```
[ { id, date, time, ticker, side, contracts, entry, exit, stop_loss_dollars,
    pnl, rr_actual, setup_id, behavior_tags[], execution_rating, screenshot, notes } ]
```

### `sessions.json`
```
[ { date, mood_before, mood_after, premarket_plan, lessons_learned } ]
```

### `best_opps.json`
```
[ { id, date, ticker, setup_id, note, mode:"quick"|"detail",
    screenshot?, opp_rr?, took_trade?, why_passed? } ]
```

### `patterns.json`
```
[ { id, name, description, entry_rules, exit_rules, stop_rules, screenshots[] } ]
```

### `accounts.json`
```
[ { id, firm_name, account_size, trailing_drawdown_limit,
    daily_loss_limit, eod_rule, current_balance } ]
```

### `settings.json`
```
{ behavior_tags[], instruments[], csv_column_map{} }
```

---

## File Structure

```
dashboard/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── StatCard.jsx
│   │   ├── PropFirmRiskBar.jsx
│   │   ├── StreakBadge.jsx
│   │   ├── TradeForm.jsx
│   │   ├── CsvImporter.jsx
│   │   └── charts/
│   │       ├── SetupPnlChart.jsx
│   │       ├── IntraHeatmap.jsx
│   │       └── DayOfWeekChart.jsx
│   ├── pages/
│   │   ├── DashboardPage.jsx
│   │   ├── PlaybookPage.jsx
│   │   ├── CalendarPage.jsx
│   │   ├── TradeLogPage.jsx
│   │   ├── JournalPage.jsx
│   │   └── SettingsPage.jsx
│   ├── store/
│   │   └── useStore.js        ← Zustand store, persisted to localStorage
│   └── utils/
│       ├── calculations.js    ← P&L, win rate, R:R, streaks, Sharpe, etc.
│       ├── csvParser.js       ← flexible CSV import with column mapping
│       └── instruments.js     ← tick/point value lookup
```

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | React 18 + Vite | Best balance for complex local app |
| CSS | Tailwind CSS | Fast dark theme customization |
| Charts | Recharts | React-native, responsive, themeable |
| State | Zustand + localStorage persist | Simple, no boilerplate, auto-saves |
| Icons | Lucide React | Clean, trader-UI appropriate |

---

## Build Order (Phases)

### Phase 1 — Scaffold + Dashboard
- Vite + React + Tailwind setup
- Sidebar nav, dark theme, Tradersync color palette
- Dashboard page: all stat cards, streak badge, prop firm risk bars
- Zustand store with localStorage persistence

### Phase 2 — Trade Entry (data foundation)
- Manual trade entry form
- CSV importer with column-mapping UI
- Trade list stored and read correctly
- Dashboard stats now computed from real data

### Phase 3 — Trade Log + Calendar
- Trade log table with sorting, filtering, inline edit
- Calendar tab (monthly P&L cells)

### Phase 4 — Playbook
- Daily Best Opps log (quick/detail toggle)
- Pattern library (create/edit patterns, view auto-stats)

### Phase 5 — Journal
- Session journal CRUD (pre-market plan, mood, lessons)

### Phase 6 — Analytics + Settings
- 3 charts embedded in Dashboard/Analytics
- Settings tab (prop firm accounts, tags, CSV mapper)

---

## Verification Plan

1. `npm run dev` → opens in browser at localhost:5173
2. Add a test trade manually → verify it appears in Trade Log and updates Dashboard stats
3. Import a sample CSV → verify column mapper works and trades parse correctly
4. Switch between all 6 tabs without errors
5. Refresh browser → verify data persists (localStorage working)
6. Open Settings → edit a prop firm rule → verify Dashboard risk bar updates
7. Create a pattern in Playbook → add a trade using that pattern → verify stats appear on pattern card
