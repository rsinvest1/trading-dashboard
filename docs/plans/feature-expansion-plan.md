# Trade Journal Feature Expansion

## Context

The dashboard currently supports CSV trade import with a Trade Log that allows only inline editing of `notes` and `playbook_id`. Six trade-schema slots exist but have no UI: `stop_loss_dollars`, `rr_actual`, `setup_id`, `behavior_tags`, `execution_rating`, `screenshot`. The orphan `patterns` collection in the store has CRUD but no UI consumer.

The user wants to introduce four features inspired by a competitor screenshot:

1. **Multiple TP/SL & Auto Risk-Reward Tracking** — multi-level take-profits and stop-losses per trade, with computed Initial Target ($), Trade Risk ($), Planned R-Multiple, Realized R-Multiple.
2. **Custom Tagging System** — categorized tags (Setups / Mistakes / Exit-TP / Timeframe / Confidence) replacing the current flat `behavior_tags` list.
3. **Trade Notes** — richer per-trade notes plus a per-day Pre-Trade Notes section.
4. **Strategy Tagging** — reusable trading models with entry/exit rule checklists; per-trade rules-followed scoring (e.g., MODEL 3, 7/8 rules followed).

Decisions confirmed with user:
- Strategies are a **new, separate collection** alongside Playbooks. A trade can link to both. Reuse orphaned `patterns` store slot (renamed).
- Pre-Trade Notes lives on the existing **JournalPage** as a `pre_market_notes` field on each session.

Outcome: a complete trade-detail editing surface, multi-leg risk tracking, structured tagging, and rules-driven strategy adherence — turning the dashboard from a CSV viewer into an actively-curated trading journal.

---

## Architecture: phased rollout

The biggest unlock is a **TradeDetailDrawer** — a slide-in panel opened by clicking any trade row. Once it exists, all four feature UIs plug into tabs/sections inside it. We build it first (Phase 0), then layer features on.

### Phase 0 — TradeDetailDrawer (foundation)

**New file:** `dashboard/src/components/TradeDetailDrawer.jsx`

- Slide-in right-aligned panel, full-height, ~480px wide. Fixed-position overlay similar to `CsvImporter` (modal pattern at `dashboard/src/components/CsvImporter.jsx:71-78`).
- Sections (collapsible or scrollable, no tabs needed at this size):
  - **Header** — date/time, ticker, side, P&L, account chip
  - **Risk & Targets** (Phase 1)
  - **Tags** (Phase 2)
  - **Strategy** (Phase 3)
  - **Notes** — multi-line textarea (replaces inline `NotesCell`)
  - **Screenshot** — drag-drop image to data-URL into `t.screenshot`; reuse pattern from `PlaybookPage.jsx` (uses `ImagePlus` icon and FileReader.readAsDataURL)
  - **Execution rating** — 1-5 star picker, reuse `MoodPicker` pattern at `dashboard/src/pages/JournalPage.jsx:29-48`
- All edits pipe through existing `updateTrade(id, patch)` in `dashboard/src/store/useStore.js:52`.

**Wire-up in `dashboard/src/pages/TradeLogPage.jsx`:**
- Add `selectedTradeId` state; row `onClick` opens drawer
- Stop-propagation on existing inline cells (Notes/Playbook) so they keep working
- Remove inline `NotesCell` cell (drawer is the canonical edit), keep read-only display in column

### Phase 1 — Multi-TP / Multi-SL & R-Multiple

**Schema additions to trade object** (in `dashboard/src/utils/tradeAggregator.js:62-84` and `dashboard/src/store/useStore.js:48`):
```js
tp_levels: []          // [{ id, price, contracts, percent }]
sl_levels: []          // same shape
planned_target_dollars: null   // optional manual override
planned_risk_dollars:   null   // optional manual override
```

**New module:** extend `dashboard/src/utils/calculations.js`:
- `tpDollars(trade)` — sum across `tp_levels` of `(|tp.price - entry|) × pointValue × tp.contracts`
- `slDollars(trade)` — same for `sl_levels`, returns negative
- `plannedR(trade)` — `tpDollars / |slDollars|`
- `realizedR(trade)` — `pnl / |slDollars|` (or `planned_risk_dollars` override)

Use `INSTRUMENTS[t.ticker].pointValue` from `dashboard/src/utils/instruments.js` for $/point conversion.

**New component:** `dashboard/src/components/TpSlEditor.jsx`
- Mirrors the screenshot layout: header row with `+ TP` and `+ SL` buttons (green/red)
- Rows: `price | qty | %  [trash]`
- Footer summary: Initial Target, Trade Risk, Planned R-Multiple, Realized R-Multiple — color-coded green/red

**Render in:** TradeDetailDrawer "Risk & Targets" section.

**TradeLogPage:** add optional **R** column (realized R-multiple) sortable like other columns.

### Phase 2 — Categorized Tag System

**Schema migration** in `dashboard/src/store/useStore.js`:
- Replace flat `settings.behavior_tags: string[]` with `settings.tag_categories: Category[]`:
```js
{ id, label, color, tags: [{ id, label }] }
```
- Default categories on rehydrate: Setups, Mistakes, Exit/TP, Timeframe, Confidence
- **Migration step**: existing flat `behavior_tags` strings auto-import into a "Mistakes" category (matches the original DEFAULT_BEHAVIOR_TAGS intent)
- Trade schema: replace `behavior_tags: string[]` with `tags: { [categoryId]: tagId[] }`

**Persistence:** bump persist key from `trading-dashboard-v2` → `v3`, and add a one-shot migration in `persist`'s `onRehydrateStorage` to translate old data forward (preserves existing trades).

**SettingsPage** changes (`dashboard/src/pages/SettingsPage.jsx`):
- Replace "Behavior Tags" section (lines 188-219) with **Tag Categories** editor: each category collapsible, add/remove tags within, add/rename/delete categories.

**New component:** `dashboard/src/components/TagPicker.jsx`
- Rendered per-category in the drawer's Tags section
- Pill-style toggleable buttons (selected = filled, unselected = outline)
- Reuses behavior-tag pill style from current SettingsPage (lines 191-201)

**TradeLogPage:** optional small tag-pills column (truncated, hover for full list); add a tag filter dropdown alongside the existing account/ticker filters.

### Phase 3 — Strategies with Rules Checklists

**Store changes** in `dashboard/src/store/useStore.js`:
- Rename orphan `patterns` collection → `strategies` (no data exists; safe rename of slot + `addPattern`/etc. methods)
- Strategy shape:
```js
{ id, name, color, description,
  entry_rules: [{ id, text }],
  exit_rules:  [{ id, text }] }
```

**Trade schema additions:**
- `strategy_id: null`
- `rules_followed: []` — array of rule ids that were checked

**New page:** `dashboard/src/pages/StrategiesPage.jsx`
- Route: `/strategies`, sidebar entry in `dashboard/src/components/Sidebar.jsx`
- CRUD list: each strategy card lets user edit name, color, and add/remove entry & exit rules
- Modeled on the simpler half of `PlaybookPage.jsx` (skip catalysts/charts/outcome — those stay Playbook-exclusive)

**New component:** `dashboard/src/components/RulesChecklist.jsx`
- Rendered in TradeDetailDrawer "Strategy" section
- Strategy `<select>` at top → upon selection, render entry + exit rules with checkboxes
- Progress bar: "7 / 8 rules followed" with green fill (matches screenshot)
- Stores `rules_followed` ids in trade

**TradeLogPage:** add Strategy column (similar dropdown pattern to existing PlaybookCell).

**Optional analytics** (deferrable): add a "P&L by Strategy" chart and "Rules adherence vs P&L" scatter to DashboardPage.

### Phase 4 — Pre-Trade Notes (per day)

**Session schema** — `addSession` in `dashboard/src/store/useStore.js:58-61` already keys by `date`. Extend payload shape to include:
- `pre_market_notes: string` (already free-form via existing journal)
- Existing fields: mood, lessons (already there per `JournalPage.jsx`)

**JournalPage** (`dashboard/src/pages/JournalPage.jsx`):
- Add a "Pre-Trade Notes (Before the Day Starts)" textarea at the top of the day view (above mood)
- Auto-save on blur via existing `addSession` upsert pattern

(This is the lightest phase — schema and persistence already exist; only UI wiring.)

---

## Files to modify

| File | Change |
|---|---|
| `dashboard/src/store/useStore.js` | Schema migration (tag_categories, rename patterns→strategies, new trade fields), bump persist key to v3, write rehydrate migration |
| `dashboard/src/utils/tradeAggregator.js` | Initialize new trade fields (`tp_levels`, `sl_levels`, `tags`, `strategy_id`, `rules_followed`) on CSV import |
| `dashboard/src/utils/calculations.js` | Add `tpDollars`, `slDollars`, `plannedR`, `realizedR` |
| `dashboard/src/components/TradeDetailDrawer.jsx` | **NEW** — main editing surface |
| `dashboard/src/components/TpSlEditor.jsx` | **NEW** — multi-leg price editor (Phase 1) |
| `dashboard/src/components/TagPicker.jsx` | **NEW** — categorized pill picker (Phase 2) |
| `dashboard/src/components/RulesChecklist.jsx` | **NEW** — strategy rules checklist (Phase 3) |
| `dashboard/src/pages/StrategiesPage.jsx` | **NEW** — strategy CRUD |
| `dashboard/src/pages/SettingsPage.jsx` | Replace flat behavior-tags section with categorized tag editor |
| `dashboard/src/pages/TradeLogPage.jsx` | Row click → drawer; add R / tags / strategy columns; tag filter |
| `dashboard/src/pages/JournalPage.jsx` | Add `pre_market_notes` textarea |
| `dashboard/src/App.jsx` | Add `/strategies` route |
| `dashboard/src/components/Sidebar.jsx` | Add Strategies sidebar entry |

---

## Verification

1. **Run dev server:** `npm run dev` in `dashboard/`. Open `http://localhost:5173`.
2. **Foundation:** Click a trade row in Trade Log → drawer opens with all existing fields populated, edits round-trip via reload.
3. **Phase 1:** Add 2 TP rows + 1 SL row in the drawer. Initial Target / Trade Risk / Planned R appear. After exit, Realized R shows correct value.
4. **Phase 2:** In Settings, add a new tag category and tags. In drawer, tag a trade across categories. Filter Trade Log by a tag and verify count.
5. **Phase 3:** Visit /strategies, create "MODEL 3" with 5 entry + 3 exit rules. Link to a trade in drawer, check 4/5 entry rules. Verify "4/8" appears in trade row. Reload — persisted.
6. **Phase 4:** Open Journal for today, write pre-trade notes, navigate away and back — value persists.
7. **Backwards compatibility:** Export current data as JSON via Settings, import a v2 export, verify no crashes and old trades have new fields defaulted (null/empty).
8. **Persist migration:** Clear localStorage, re-import a v2 backup → confirm old `behavior_tags` migrate into the "Mistakes" category.

---

## Out of scope (deferred)

- Per-trade analytics (rules-adherence scatter, P&L by strategy) — can be added once data accumulates
- Multi-leg fills splitting (preserving individual fill price points pre-aggregation) — TP/SL editor is manual entry; full fill-by-fill tracking is a bigger CSV-parser refactor
- Chart annotations / drawn TP-SL lines on price chart — no chart component exists today
- AI-suggested tag application
