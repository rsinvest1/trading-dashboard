# FinancialJuice news tee (fj_news_tee.py) — Phase 4 headline source

The journal classifies FinancialJuice headlines that hit during each holding
window; this scraper *writes* the rolling headline log it reads. It mirrors your
existing `attach_financialjuice.py` (Selenium attached to Chrome:9222) — but
captures the **news pane** instead of the calendar.

```
Chrome:9222 (FJ logged in)
      │  fj_news_tee.py  (polls news pane, dedups)
      ▼
C:\RSInvest\journal-feed\headlines-<ET-date>.jsonl   ← rolling, all-day
      │  headlineCapture.ts: read window slice + classify
      ▼
ReleaseJournalHeadline[]  →  package  →  dashboard headline timeline
```

Same `journal-feed` folder + ET-date filename convention as the tick tee. Line
timestamps are UTC; `t` is the first-seen capture time (poll-accurate, timezone-safe).

## Prereqs (journal box)

1. `C:\RSInvest\start_chrome_cdp.bat` — Chrome with `--remote-debugging-port=9222`.
2. Log into FinancialJuice (PRO) on that Chrome, news pane visible.
3. `pip install selenium`.

## One-time: lock the news-item selector

The **calendar** selectors are known (`event-*`); the **news-feed** item selector
needs one live verification (just like `PCE_Scraper.py`: *"selectores verificados
ao vivo"*).

```powershell
python fj_news_tee.py --dump
```

Open `feed/fj_news_dump.html`, find the repeating news-item element, then run with
that selector (or set `DEFAULT_SELECTOR` in the script). The tee autodetects from a
guess list, but locking the selector makes it robust.

## Run

```powershell
python fj_news_tee.py                          # autodetect
python fj_news_tee.py --selector "div.news-item"  # locked selector
```

Leave it running through the session. Each new headline is appended once
(deduped by `source|text`). The release scheduler reads whatever window each
release needs — no per-release wiring.

## Classification (done in the journal, not here)

`src/headlineCapture.ts` reads the window slice and tags each headline:
relevance HIGH/MEDIUM/LOW, category, and `possibleNewInformationEvent` (a HIGH
headline that isn't the scheduled print → may have re-priced the market). That
flag drives `summary.keyHeadlineInterference`, which the dashboard surfaces.

> READ-ONLY. No orders, no posting. It only reads the FinancialJuice page you're
> already viewing.
