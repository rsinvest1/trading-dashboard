# Session Handoff — 2026-05-02

> Picking this up from another Claude account / machine? Read `/CLAUDE.md` first, then this file.
> This document captures the live state at the moment of the last hand-off and the open threads.

---

## Where things stand

The dashboard is **deployed and running in production** at https://trading-dashboard-rs.netlify.app. Recent commits in `main`:

```
1565434  Add Behavior Engine: real-time risk control system
1a516d5  (earlier work — feature expansion: TradeDetailDrawer, multi-TP/SL,
          categorized tags, Strategies, pre-trade notes, R-multiple)
```

### What's working end-to-end ✅

1. **CSV import** with dedup, Live Mode toggle, account auto-mapping
2. **Trade Log** with sortable columns, filters (account/ticker/tag), R-multiple, Strategy badge with rules-followed count, tag pills
3. **TradeDetailDrawer** — slide-in editor for any trade. Hosts: Risk & Targets (TP/SL), Strategy, Tags, Playbook, Execution Rating, Notes, Screenshot
4. **Multi-TP/Multi-SL** with auto Initial Target, Trade Risk, Planned R, Realized R
5. **Categorized tags** (Setups / Mistakes / Exit-TP / Timeframe / Confidence) — fully editable in Settings
6. **Strategies page** — reusable trading models with entry/exit rule checklists; per-strategy stats
7. **Playbooks** — date-bound pre-trade context records (existing; preserved)
8. **Journal** — per-day pre-trade notes, mood, lessons (autosaves)
9. **Behavior Engine** — full state machine (normal / paused / locked / recovery)
10. **PostTradeModal** — mandatory Plan/Error + emotion (+ if error: reason + driving emotion)
11. **Kill Switch** — locks UI on 2 consecutive errors or >3 trades within 5 min after error; override requires note ≥20 chars (logged permanently)
12. **Recovery Mode** — triggered on `urgent` emotion; reduced trade cap; exits on calm streak / idle
13. **Quick Add Trade** — manual entry that goes through the engine; gated by `canTradeNow()`
14. **InSessionControlPanel** on Dashboard — live status (last trade, emotion, allowed?, errors today, overtrading score 0-3)
15. **Real-time webhook ingestion** via Netlify Function `/webhook` (idempotent by `event_id`, stored in Netlify Blobs)
16. **Live polling** (`useWebhookPoller` hook) — every 2s, processes through `positionAggregator` (groups by `position_id`, emits trade on `is_closing=true` + net qty=0)
17. **Settings**: tunable thresholds for the entire Behavior Engine, override log viewer, webhook test/status, JSON export/import

### What was last verified

User confirmed at end of session: **"test succeed"** — webhook test deal accepted by Netlify function.

The user has NOT yet sent a real round-trip (open + close) through the webhook to fire the full Behavior Engine flow end-to-end on production. That's the next sanity check.

---

## Open threads / next steps

### 1. End-to-end round-trip test on production
Send open + close deals via PowerShell to verify:
- Position aggregator collapses to one trade
- PostTradeModal appears
- Behavior Engine state transitions correctly

Test script (PowerShell):
```powershell
$url = "https://trading-dashboard-rs.netlify.app/webhook"
$pid = "TEST-POS-" + (Get-Random)

# Open: BUY 1 NQ at 19500
$open = @{
  event_id = "OPEN-" + (Get-Random); source = "manual"; type = "deal"
  trade_id = "T1"; position_id = $pid; instrument = "NQM6"
  direction = "buy"; quantity = 1; price = 19500; pnl = 0; fees = 0.62
  timestamp = (Get-Date).ToUniversalTime().ToString("o"); is_closing = $false
} | ConvertTo-Json
Invoke-RestMethod -Uri $url -Method Post -Body $open -ContentType "application/json"

Start-Sleep -Seconds 2

# Close: SELL 1 NQ at 19510 (+10 pts = +$200)
$close = @{
  event_id = "CLOSE-" + (Get-Random); source = "manual"; type = "deal"
  trade_id = "T1"; position_id = $pid; instrument = "NQM6"
  direction = "sell"; quantity = 1; price = 19510; pnl = 200; fees = 0.62
  timestamp = (Get-Date).ToUniversalTime().ToString("o"); is_closing = $true
} | ConvertTo-Json
Invoke-RestMethod -Uri $url -Method Post -Body $close -ContentType "application/json"
```

If `WEBHOOK_SECRET` is set, add `-Headers @{ "X-Webhook-Secret" = "<secret>" }` to both calls.

### 2. Quantower side (separate Claude agent on the user's main computer)
A different Claude agent — running on `rsbs.capital@gmail.com` — is wiring up the Quantower plugin that POSTs to `/webhook`. They have the webhook contract from CLAUDE.md and our last exchange.

**Agreed contract is in CLAUDE.md → "Webhook contract".** Don't change it without coordinating.

### 3. Data restoration on the live site
The user's local `localStorage` has ~29 trades that **are not on the deployed site** (each browser has separate localStorage). To migrate:
1. From local dev (`localhost:5173`): Settings → Backup → **Export JSON** → save file
2. On live site: Settings → Backup → **Import JSON** → upload that file

This was suggested but not yet done. Both browsers (local + live) hold their own copies.

### 4. Optional: Netlify env vars to harden webhook
Set `WEBHOOK_SECRET` (32+ char random string) in Netlify → Site settings → Environment variables. Then trigger redeploy. Webhook will start requiring `X-Webhook-Secret` header.

### 5. Future: per-strategy and per-tag analytics
Plan called these out as deferrable. They're not built:
- "P&L by strategy" chart on Dashboard
- "Rules adherence vs P&L" scatter
- "P&L by tag category" breakdown

### 6. Future: quantower → broker plugin SDK
If user wants TradingView / IB / Tradovate later, would need a connector script (Python/Node) that polls the broker's API and forwards to `/webhook`. Out of scope for this session; not requested.

---

## Files modified or added in the most recent session (Behavior Engine commit)

```
modified:  src/App.jsx                       (PersistentRuleBanner, BehaviorOverlay, PostTradeModal mounted globally; useWebhookPoller hook)
modified:  src/components/CsvImporter.jsx    (Live Mode toggle → ingest path)
modified:  src/pages/DashboardPage.jsx       (InSessionControlPanel section)
modified:  src/pages/SettingsPage.jsx        (Behavior Engine tunables + override log section)
modified:  src/pages/TradeLogPage.jsx        (QuickAddTrade button + Live badge)
modified:  src/store/useStore.js             (behaviorState slice, ingestTrade, classifyTrade, tickBehavior, canTradeNow, overrideLock, resetBehaviorState; v1→v2 migrate)
new:       src/components/BehaviorOverlay.jsx
new:       src/components/InSessionControlPanel.jsx
new:       src/components/PostTradeModal.jsx
new:       src/components/QuickAddTrade.jsx
```

User-applied tweaks after that commit (still uncommitted on the source machine — see "Uncommitted local edits" below):
- `App.jsx`: imports `useWebhookPoller` hook and calls it
- `BehaviorOverlay.jsx`: KillSwitchScreen reads `cfg.override_min_reason_chars` (default 20) and shows a live `n/min` counter
- `QuickAddTrade.jsx`: calls `canTradeNow()` before ingesting; renders gate message if blocked

---

## Uncommitted local edits

When this handoff was written, the source machine had these local edits (not yet pushed):
- `src/App.jsx` — added `import { useWebhookPoller }` and the hook call
- `src/components/BehaviorOverlay.jsx` — minChars from settings, char counter
- `src/components/QuickAddTrade.jsx` — gating with `canTradeNow()` and gate message UI

These are now committed alongside this handoff (see commit log on `main`).

There are also new files in the repo that were added by the other Claude agent or user during their parallel work:
- `src/utils/positionAggregator.js`
- `src/utils/useWebhookPoller.js`
- `src/components/WebhookLiveBadge.jsx`
- `src/components/WebhookSettings.jsx`
- `netlify/functions/webhook.js`
- `netlify/functions/events.js`
- `netlify.toml`

All of these are part of the live deployment.

---

## Decisions made (don't re-litigate without good reason)

1. **No backend database.** localStorage is canonical. Webhook events are ephemeral (Netlify Blobs, ~24h cursor).
2. **Strategies ≠ Playbooks.** Strategies are reusable models with rules. Playbooks are date-bound context records (catalysts, charts, news). They coexist; a trade can link to both.
3. **Migration safety:** every persisted-state change bumps `version` in the persist config and adds a chained `migrateVN-1toVN` function. v0 → v1 (categorized tags) and v1 → v2 (Behavior Engine) are both shipped.
4. **Behavior Engine kill-switch defaults:** 5 min pause; 45 min lock; 2 consec errors triggers lock; 3 trades in 5 min post-error triggers lock. All tunable in Settings.
5. **Override flow is "honor system":** the dashboard is pure client-side, so anything is technically bypassable. We chose "Strong friction + accountability bypass" — full lock screen, override requires ≥20-char written note (logged permanently in Settings → Override log).
6. **Live Mode in CSV import:** auto-suggested ON when all fresh trades are from today. OFF for historical bulk imports (which would otherwise force the user to classify dozens of old trades).
7. **Webhook contract is fixed and shared with Quantower-side Claude.** See CLAUDE.md.
8. **Tailwind tokens only.** Never hardcode hex colors. (`bg-bg-card`, `text-accent-green`, etc.)

---

## How to pick this up on the other machine

On `rsbs.capital@gmail.com` machine:

```bash
# 1. Clone fresh
git clone https://github.com/rsinvest1/trading-dashboard.git
cd trading-dashboard

# 2. Install deps
npm install

# 3. Run locally (optional — to verify before changes)
npm run dev
# → http://localhost:5173

# 4. Open in Claude Code
# Claude will auto-read CLAUDE.md and pick up full project memory.
# Read docs/SESSION_HANDOFF.md (this file) for current state + next steps.
```

To restore the user's trade data on the new machine:
1. On VIVESCO-Capital machine: open `localhost:5173` (or live), Settings → Export JSON → save file
2. Copy the JSON file to the new machine (USB / Google Drive / OneDrive)
3. On new machine: open the running app, Settings → Import JSON → upload the file

---

## Quick sanity checks for the new Claude

Before making any changes, verify:

- `npm run build` succeeds (build is currently clean as of last commit)
- The live URL https://trading-dashboard-rs.netlify.app loads
- Dashboard → "Behavior Engine" section shows the InSessionControlPanel
- Trade Log → "Quick Add" button is visible
- Settings → "Behavior Engine" section shows tunables (pause min, kill thresholds, recovery cap)
- Settings → "Real-time Webhook" section shows webhook URL + Send test deal + Live polling toggle

If any of those are missing, **something is wrong with the local clone or the build** — don't start coding until the picture matches.

---

## Source-of-truth links

- Live: https://trading-dashboard-rs.netlify.app
- Repo: https://github.com/rsinvest1/trading-dashboard
- Netlify project: https://app.netlify.com/projects/trading-dashboard-rs
