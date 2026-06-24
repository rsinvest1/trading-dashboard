# Release Journal Worker

A **separate** post-release journaling pipeline for macro economic releases. It
records what happened around a release (screenshots, market behavior,
FinancialJuice headlines, peak/MAE detection) and emits a stable **journal
package** that the existing Trading Dashboard imports for review.

> This worker is intentionally decoupled from the React dashboard. It owns
> capture/recording; the dashboard owns review/playbook/journal/stats. The
> dashboard **consumes** completed packages — it never runs the capture itself.

## Status: Phase 6 (scorecard ⇄ behavior + UB) — complete

- ✅ **Phase 1** — schema + dashboard **Import Auto Journal** / **Release Review**.
- ✅ **Phase 2 metrics engine** — `marketRecorder`, `peakMaeAnalyzer`,
  `journalPackageBuilder`. Runnable via `cli.ts`; unit-tested.
- ✅ **Phase 2 live tee** — [`tee/QT_QuoteTee`](tee/) writes the JSONL tick log from
  the dedicated 2nd Rithmic connection (built + installed; see [`tee/README.md`](tee/README.md)).
- ✅ **Phase 3 screenshots + scheduler** — `capture.ps1` (native Windows capture),
  `screenshotScheduler` (fixed-time **and** event-driven captures), `releaseScheduler`
  (release-day orchestrator: arms each window, then builds the package with the
  screenshots merged in). Unit-tested + a simulated end-to-end `runScheduleDemo`.
  Live entry: `scheduleCli.ts`. The capture step is Windows/Quantower-specific
  (runs on the journal box); the scheduling/event logic is fully tested in CI.
- ✅ **Phase 4 headline capture** — [`feed/fj_news_tee.py`](feed/) (Selenium →
  Chrome:9222 → FJ news pane → rolling `headlines-<date>.jsonl`, mirrors the
  existing `attach_financialjuice.py`) + `src/headlineCapture.ts` (read window
  slice + classify relevance/category/new-info). The scheduler merges captured
  headlines into the package and sets `summary.keyHeadlineInterference`. Classifier
  unit-tested; flows into the dashboard's headline timeline (no dashboard change).
- ✅ **Phase 5 review engine** — `src/tradabilityGrader.ts` grades every tradeable
  asset (the weighted tradability score → A+…D + directional/MAE/R-R quality
  labels) and builds the ranked, narrative summary (best/second/worst, holding
  style, takeaway, learning note). `buildJournalPackage` writes `classification`
  on each asset, so the dashboard's **Release Review** grade column and the
  **Playbook** EventCard rollup (auto-review grade + avg MAE) light up — the
  loop closes back into the Playbook with no dashboard change. Classifier
  unit-tested.
- ✅ **Phase 6 scorecard ⇄ behavior + UB bond proxy** — closes the loop with the
  `macro_score` daily-prep **scorecard**. `expectedBehavior.ts` reads the
  `daily_prep` / `templates` / `logs/*_score.json` files (what was *expected*:
  per-instrument bias/confidence/narrative/conflicts); `legAnalyzer.ts` registers
  the actual behavior (5/15/30/60 s timed reads, dominant first-leg direction,
  first/second-leg MFE/MAE/timing); `behaviorComparison.ts` scores the match
  (`expectedBiasHit`, `bestLeg`, `scoreQuality` A/B/C, `executionQuality`
  clean/late/conflicted/failed + confirmation agreement / missing-source flags);
  `adjustmentEngine.ts` emits advisory tweaks to
  `macro_score/adjustments/<date>_<templateId>.json` (**output-only** — never edits
  the templates). `runReleaseReview.ts` orchestrates it (the scheduler runs it
  automatically when a release config carries a `templateId`). Dashboard gains
  **Expected (scorecard)** / **Expected vs actual** / **Suggested adjustments**
  sections + a Playbook bias-hit rollup. **UB** (Ultra T-Bond) is added as a
  tradable journal symbol (Ricardo's bond proxy, **ETF account only**) — tee +
  backfill default symbols include it; `instruments.ts` carries its 1/32 tick size.
  All four new modules unit-tested against the real macro_score files.

### Run it

```bash
cd release-journal-worker            # Node ≥ 22.18 runs the .ts files directly
npm test                             # unit-test the metrics engine
npm run demo                         # synthesize a log → write a package to demo-output/
npm run build:journal -- <config.json> [ticklog.jsonl]   # build from a real tee log
```

The tick log (the tee's output) is JSONL, one snapshot per line:

```
{"t":"2026-05-29T14:00:00.000Z","sym":"RTY","last":2099.4,"bid":2099.3,"ask":2099.5}
```

## Folder layout

```
release-journal-worker/
  README.md
  schema/
    releaseJournalSchema.ts      # canonical TypeScript contract
  samples/
    sample-rty-nq-relative-strength.json
    sample-us-ism-manufacturing-pmi.json
    sample-eu-pmis.json
  package.json                   # scripts: test / demo / demo:schedule / schedule / build:journal
  capture/
    capture.ps1                  # native Windows screen/monitor/region → PNG   ✅ Phase 3
  src/
    marketRecorder.ts            # tick-log reader + down-sampler      ✅ Phase 2
    peakMaeAnalyzer.ts           # peak/retrace/MAE/MFE/R-R metrics    ✅ Phase 2
    journalPackageBuilder.ts     # assemble + write a package          ✅ Phase 2
    cli.ts                       # build a package from config + log   ✅ Phase 2
    runDemo.ts                   # synthesize a log + run the pipeline  ✅ Phase 2
    peakMaeAnalyzer.test.ts      # deterministic metrics unit test     ✅ Phase 2
    capture.ts                   # capturer adapter (spawns capture.ps1) ✅ Phase 3
    screenshotScheduler.ts       # fixed + event-driven capture window  ✅ Phase 3
    releaseScheduler.ts          # release-day orchestrator             ✅ Phase 3
    scheduleCli.ts               # live scheduler entry                 ✅ Phase 3
    runScheduleDemo.ts           # simulated end-to-end schedule demo    ✅ Phase 3
    screenshotScheduler.test.ts  # capture-window unit test (sim time)  ✅ Phase 3
    headlineCapture.ts           # read FJ headline log + classify       ✅ Phase 4
    headlineCapture.test.ts      # classifier + window-selection test    ✅ Phase 4
    tradabilityGrader.ts         # grade + rank + summary (review engine) ✅ Phase 5
    tradabilityGrader.test.ts    # grading + ranking unit test            ✅ Phase 5
    backfillRequest.ts           # tee-down fallback: request Quantower 1s/tick history
    backfillRequest.test.ts      # window/coverage/request-wait unit test
    backfillCli.ts               # on-demand backfill for a missed release
    instruments.ts               # tick-size table + UB/bond ETF-only flag  ✅ Phase 6
    expectedBehavior.ts          # read macro_score scorecard → ExpectedBehavior ✅ Phase 6
    expectedBehavior.test.ts     # parses the REAL daily_prep/template/score   ✅ Phase 6
    legAnalyzer.ts               # timed reads + 1st/2nd leg behavior         ✅ Phase 6
    legAnalyzer.test.ts          # synthetic-path leg unit test               ✅ Phase 6
    behaviorComparison.ts        # expected vs actual: bias-hit/best-leg/quality ✅ Phase 6
    behaviorComparison.test.ts   # comparison + confirmation matrix test       ✅ Phase 6
    adjustmentEngine.ts          # advisory tweaks → adjustments/ (output-only) ✅ Phase 6
    adjustmentEngine.test.ts     # heuristic + writeAdjustments test           ✅ Phase 6
    runReleaseReview.ts          # orchestrator (npm run review = demo)        ✅ Phase 6
  tee/
    README.md                    # the L1→JSONL tee; source + installer live in
                                 #   C:\co-work\CT market stats alerts\QT_QuoteTee\
                                 #   (built by Build_and_Install.ps1)            ✅ Phase 2
  feed/
    README.md                    # FJ news tee: prereqs / run / selector lock    ✅ Phase 4
    fj_news_tee.py               # Selenium → Chrome:9222 → headlines JSONL       ✅ Phase 4
```

## Journal package (on-disk output format)

A completed package is one folder under `../journal-data/`:

```
journal-data/<YYYY-MM-DD>/<HHMM>_<region>_<release_slug>/
  metadata.json            # a ReleaseJournal (numbers, assets, etc.)
  release_numbers.png      # screenshot of the printed numbers
  headlines.json           # ReleaseJournalHeadline[]
  summary.md               # human-readable summary
  assets/
    RTY/  pre_release.png  release_impulse.png  peak1.png  mae_between_peaks.png  peak2.png  holding_end.png  metrics.json
    NQ/   ...
    GC/   ...
    6E/   ...
  composite/
    multi_asset_dashboard.png
    timeline_annotated.png
```

See `../journal-data/2026-05-29/1000_US_ISM_Manufacturing_PMI/` for a worked
on-disk example.

## Phased roadmap

| Phase | Goal | Status |
|------|------|--------|
| 1 | Schema + manual import/viewer | ✅ done |
| 2 | Market data recorder → MAE/MFE/peak metrics | ✅ done (engine + QT_QuoteTee tee) |
| 3 | Screenshot automation (fixed-time + event-driven) + release scheduler | ✅ done (capture runs on the journal box) |
| 4 | FinancialJuice headline capture + relevance classification | ✅ done (news tee on the journal box) |
| 5 | Full review engine — auto-grade + rank + summary → back into Playbook | ✅ done (`tradabilityGrader`; grades flow to Release Review + Playbook rollup) |
| 6 | Scorecard ⇄ behavior comparison + adjustment engine + UB bond proxy | ✅ done (`expectedBehavior`/`legAnalyzer`/`behaviorComparison`/`adjustmentEngine`; Expected-vs-Actual + adjustments in the dashboard; UB in tee/backfill) |

### Phase 6 output: the adjustments review file

When a release runs with a `templateId`, the worker writes an **output-only**
advisory file the prep agent reviews (it never edits the templates/daily-prep):

```
macro_score/adjustments/<YYYY-MM-DD>_<templateId>.json
  { date, templateId, generatedAt, summary, suggestions: [
    { scope: 'template'|'daily_prep'|'holding_style', target, change?, note?, rationale, confidence } ] }
```

---

## Feed & bridge architecture (Phase 2) — IMPORTANT

There is **one** local Rithmic→Quantower (R-Trader) tick bridge, and it already
feeds the live **Macro News Trading Dashboard**. During high-impact releases the
bridge is at peak load exactly when the recorder wants data. **The live trading
path is sacred (prop-firm accounts) — the journal recorder must never compete
with it for the bridge's request budget at the release moment.**

Three isolation models, least → most isolated:

- **A — Passive tap (same machine).** Recorder subscribes to the bridge's
  *already-published* tick stream (push/fan-out) instead of issuing its own quote
  requests. Zero added Rithmic load — but only covers instruments the dashboard
  is *already* streaming, and only works if the bridge pushes (not poll/request).

- **B — Local tick-log tee (same machine).** The bridge (or a thin sidecar)
  continuously appends L1 ticks for the tracked symbols to a local rolling log;
  the recorder reads the *log*, never the live bridge API. Fully decouples the
  recorder from the live request path — if it lags/crashes, trading is untouched.
  Still limited to instruments already subscribed by the bridge.

- **C — Separate machine + second Rithmic data feed (RECOMMENDED for live).**
  Journal automation runs on its own box with its own Quantower/R-Trader Rithmic
  *market-data* login; subscribes to anything it wants (incl. 6E/ES/ZN) with zero
  impact on the trading box. Caveats: (1) confirm Rithmic/prop-firm allow a second
  concurrent market-data connection and the **exchange data-fee** implications;
  (2) keep both boxes NTP-synced so journal timestamps align with trade events
  (stamps stay ET per convention); (3) trade-event webhooks still flow from the
  trading box independently (low rate, unaffected).

**CHOSEN: hybrid C + B.** Run the worker on a **separate box (C)** with its own
Rithmic market-data login, and within that box **tee its feed to a local tick
log (B)** that the recorder reads — so the recorder is decoupled from the trading
box *and* from its own feed client. The trading machine's bridge is never
touched. The dedicated 2nd Rithmic data connection is confirmed available
(journal-only), and the tee is implemented in [`tee/QT_QuoteTee`](tee/).

The schema already records per-asset `source` (`RITHMIC | QUANTOWER | IG_CFD |
MANUAL | UNKNOWN`), so a package notes which feed/box each asset came from — no
schema change needed for the two-machine model.

### Snapshot cadence — this is NOT an HFT system

The trader enters **~3 s after the release at best**, never sub-second. So the
recorder samples, it does not capture raw tick-by-tick:

- **Default snapshot cadence: 500 ms** (last + bid + ask). ~1,800 rows / 15-min
  window / instrument — trivial storage, near-zero load, and fine enough to pin
  peaks/MAE to ±0.5 s for a multi-minute move. Tunable; 1 s is acceptable after
  the first ~2 min. Do **not** go finer than 250 ms — it only adds noise that is
  not tradeable for this style.

### Realistic-entry anchor (peak/MAE/R-R reference)

Because entry is ~3 s late, excursions must be measured from where the trade
could **realistically** be filled, NOT the instantaneous release price at T+0:

- `entryModels.immediate` anchors at **release time + ENTRY_ANCHOR_DELAY_SEC
  (default 3 s)** — the fastest realistic fill. `entry_price_initial` = the
  sampled price at that anchor.
- `entryModels.confirmed` stays the later confirmation entry (unchanged).
- All `ticksFromEntry`, MAE, MFE, and R/R are computed from the realistic anchor,
  so grades reflect *the trader's* tradeable reality — not a spike at T+0 that no
  one could have caught.

## Metrics to compute (Phase 2)

For each tracked asset:

```
entry_price_initial
entry_price_confirmed
direction
peak1_price, peak1_time, peak1_excursion_ticks
retrace1_depth_ticks, retrace1_time
peak2_price, peak2_time, peak2_excursion_ticks
MAE_to_peak1_ticks
MAE_between_peak1_and_peak2_ticks
MFE_total_ticks
total_range_ticks
time_to_peak1_sec
time_to_peak2_sec
```

## Tradability grading (Phase 5)

`src/tradabilityGrader.ts` (pure, unit-tested) scores each tradeable asset from
the Phase 2 metrics already on it. Every sub-score is a **0–1, instrument-
independent ratio**, so a 50-tick NQ move and a 5-tick GC move grade on one scale:

```
tradability_score =                                  # → 0..100
  0.30 * directional   # favorable share of realized range: maxMFE / totalRange
  0.25 * rr            # best standard-stop R/R, saturating at 3.0
  0.20 * mae           # 1 − (MAE→peak1 / maxMFE): less heat → higher
  0.15 * continuation  # peak2 extension past peak1, net of the between-peaks retrace
  0.10 * headline_stab # 1 − 0.5 × (#HIGH new-info headlines in the window)
```

Score → grade: **A+** ≥ 85 · **A** ≥ 72 · **B** ≥ 58 · **C** ≥ 42 · **D** < 42.

- **A+** — clean directional move, low/manageable MAE, strong R/R, good continuation, no major conflicting-headline damage
- **A**  — good move, moderate MAE, solid R/R
- **B**  — tradable but choppy; acceptable R/R only with a wide stop or delayed entry
- **C**  — weak quality, inconsistent reaction, poor continuation
- **D**  — not worth trading; noisy or reverse-prone

It also writes the categorical labels the dashboard reads — `directionalQuality`
(EXCELLENT/GOOD/MIXED/POOR), `maeQuality` (LOW/MODERATE/HIGH/EXTREME_MAE),
`rrQuality` — and builds the release `summary`: best/second/worst asset (ranked by
score), a **best holding style** (`SCALP_TO_PEAK_1` / `HOLD_TO_PEAK_2` /
`CONFIRMATION_ENTRY_ONLY` / `AVOID_HIGH_MAE` / `NO_TRADE`), a narrative
`finalTakeaway`, and a single actionable `learningNote`. These feed the **Playbook**
EventCard rollup (`Auto reviews · latest grade · avg MAE · R/R`) — closing the loop
back into the Playbook the morning-prep workflow reads. No dashboard change.

## Screenshots + release scheduler (Phase 3)

**Fixed-time** (relative to actual release **T**, clamped to the holding window):
`T-30s, T+5s, T+30s, T+1m, T+3m, T+5m`, and a `HOLDING_END` frame at the window end.
**Event-driven**: `PEAK_1`, `MAE_BETWEEN_PEAKS`, `PEAK_2` — fired when the Phase 2
analyzer *confirms* each event on the live tick log (peak1 confirms on a real
pullback, so nothing fires on the always-present fallback high; order is always
peak1 → mae → peak2).

**How it runs** (on the journal box, same machine as the tee):

1. `capture.ps1` captures a monitor / region / the virtual desktop to a PNG.
2. `releaseScheduler` reads the day's schedule, and for each release: waits for
   T-30s, opens the capture window (`screenshotScheduler`), fires fixed + event
   frames straight into the package dir, then at window end builds the package
   (Phase 2 metrics) with the screenshots merged in.

```bash
# simulated end-to-end (no clock, no screen) — produces a package under demo-output/
npm run demo:schedule

# live, on the journal box:
npm run schedule -- day-schedule.json
```

**Schedule JSON** = `{ "baseDir"?, "releases": [ <release-config> ] }`. Each release
is the same config `cli.ts` consumes (releaseKey, scheduledTime, actualReleaseTime,
assets, `tickLog`, holdingWindowSec) plus `views` — the capture surfaces:

```jsonc
"views": [
  { "id": "rty", "asset": "RTY", "target": { "monitor": 0 } },     // asset chart → fixed + event frames
  { "id": "nq",  "asset": "NQ",  "target": { "monitor": 1 } },
  { "id": "numbers", "globalType": "RELEASE_NUMBERS",              // global view → release_numbers.png
    "offsetsSec": [5], "target": { "region": { "x": 100, "y": 80, "w": 900, "h": 500 } } }
]
```

Arrange your Quantower charts so each asset's chart sits on its configured monitor/
region. Event frames are captured for `asset` views; global views (numbers/composite)
attach to the primary asset. (Window-by-title capture is a future enhancement —
monitor/region is reliable for hardware-accelerated charts.)

## Headline capture (Phase 4)

A **news tee** (`feed/fj_news_tee.py`, Selenium → Chrome:9222) writes a rolling
`headlines-<ET-date>.jsonl` all day; the journal reads the holding-window slice
and classifies — same tee → log → window-slice pattern as the tick feed. The
release scheduler merges the captured headlines into the package and sets
`summary.keyHeadlineInterference`. See [`feed/README.md`](feed/) to run it (the
news-pane selector needs one live `--dump` lock).

Classification (`src/headlineCapture.ts`, keyword heuristics, unit-tested):

- **HIGH** — the release topic (acronym/token match on `releaseKey`); Fed/ECB/
  central-bank comments; inflation/labor/growth macro; geopolitical shock; auctions.
- **MEDIUM** — risk-sentiment language; sector words mapped to a tracked symbol
  (crude→CL, gold→GC, tech/AI→NQ, …).
- **LOW** — unrelated corporate noise; duplicates are dropped at the window slice.
- `possibleNewInformationEvent = HIGH && category !== release_related` (a HIGH
  headline that isn't the scheduled print → may have re-priced; any true value
  sets `keyHeadlineInterference`).
- `likelyMarketEffect = unknown` for now. *Future:* correlate the headline
  timestamp against the tick log (a sharp move right after → reinforced/reversed).

## History backfill — when the live tee was off (fallback)

If `QT_QuoteTee` wasn't connected at release time, the window has no live ticks.
Instead of falling back to a manual journal, pull the window from Quantower's
**Rithmic tick (or 1-second) history** — reconstructing exactly what the tee would
have written.

- **`QT_HistoryBackfill`** (Quantower strategy, source + DLL under
  `C:\co-work\CT market stats alerts\QT_HistoryBackfill\`, installed to
  `C:\Quantower\Settings\Scripts\Strategies\QT_HistoryBackfill\`): fetches history
  via `GetHistory(HistoryAggregationTick(HistoryType.Last))` (or `Period.SECOND1`)
  for `[release−preRoll, release+hold]` and appends the **same**
  `{t,sym,last,bid,ask}` JSONL to `ticks-<ET-date>.jsonl`. Two modes:
  - **One-shot** — set *Release time (ET)* + Pre-roll/Hold + Symbols → Start.
    Reliable; use it to recover any missed release.
  - **Watcher** — *Watch requests* on → it fulfills `<id>.req.json` files the
    worker drops, writing `<id>.done.json`.
- **`src/backfillRequest.ts`** — worker side. `ensureWindowTicks` checks tee
  coverage for the window; if it's empty it writes a request and waits for the
  strategy, then re-reads. Wired into `runDayScheduleLive` (`backfill` opt, on by
  default), so the scheduler **auto-recovers** a missed window. `backfillCli.ts`
  (`npm run backfill -- <release-config.json>`) triggers it on demand.

Because the backfilled log is byte-compatible with the tee's, the rest of the
pipeline (metrics → grade → package) is unchanged. READ-ONLY history; no orders.

## Guardrails

- **No order routing. No broker execution. No ML.** Observation + journaling only.
- Bonds (ZN/ZB/UB/...) are **tracked as confirmation tells only**, never traded
  on the live accounts — see the `ZB` asset note in the RTY/NQ sample.
- The dashboard's existing trade stats / execution logic are never touched by
  this worker. Packages are additive, optional review data.
