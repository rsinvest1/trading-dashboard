# Tick-log tee (QT_QuoteTee) — the "B" feed side

The metrics engine reads a **local JSONL tick log**; this Quantower Strategy
*writes* it. It runs on the **separate journal box** against the **dedicated 2nd
Rithmic data connection**, so it never touches the trading box's bridge.

```
Rithmic (2nd data connection)
      │
  Quantower  ──[ QT_QuoteTee strategy ]──►  C:\RSInvest\journal-feed\ticks-<ET-date>.jsonl
                                                   │
                                          marketRecorder.ts reads the window
                                                   │
                                          peakMaeAnalyzer → journalPackageBuilder
```

**Read-only. No orders, no execution, no HTTP.** It only subscribes to L1 quotes
and appends snapshots to a file.

## Build & install

> **Canonical source lives outside this repo**, with your other Quantower
> strategies: `C:\co-work\CT market stats alerts\QT_QuoteTee\` (it's NOT a git
> repo — same as `QT_DealEmitter`, `SystematicEngine`, etc.). This repo keeps
> only this README as documentation. Edit the `.cs` there.

The one-command installer builds every Quantower project (incl. `QT_QuoteTee`)
and installs each DLL into `C:\Quantower\Settings\Scripts\Strategies\<Name>\`:

```powershell
cd "C:\co-work\CT market stats alerts"
powershell -ExecutionPolicy Bypass -File .\Build_and_Install.ps1
```

To build/install just the tee by hand:

```powershell
dotnet build "C:\co-work\CT market stats alerts\QT_QuoteTee\QT_QuoteTee.csproj" -c Release
Copy-Item "C:\co-work\CT market stats alerts\QT_QuoteTee\bin\Release\net10.0-windows\QT_QuoteTee.dll" `
          "C:\Quantower\Settings\Scripts\Strategies\QT_QuoteTee\" -Force
```

If your Quantower version differs, fix the `<HintPath>` in `QT_QuoteTee.csproj`
(the installer auto-updates it to the DLL it finds; mirrors `SystematicEngine.cs`).

## Install + run (journal box)

1. Run the installer above (or the hand build) — the DLL lands in
   `C:\Quantower\Settings\Scripts\Strategies\QT_QuoteTee\`. Restart Quantower or
   refresh Algos.
2. Connect Quantower to the **2nd Rithmic connection** (journal-only).
3. Make sure the tracked symbols are streaming on that connection — open them in
   a watchlist/chart if quotes don't flow (Quantower delivers `NewLast`/`NewQuote`
   for subscribed symbols).
4. Add the **QT Quote Tee** strategy, set inputs, and **Start** it:

| Input | Default | Notes |
|-------|---------|-------|
| Symbols (CSV) | `RTY,NQ,GC,6E,ES` | short tokens written to the log; matched against connected symbol names by `Contains`. Add `ZN` for bonds **observation only**. |
| Log directory | `C:\RSInvest\journal-feed` | created if missing |
| Throttle per symbol (ms) | `100` | the recorder down-samples to 500 ms; 100 gives headroom and keeps the file small |
| Flush interval (ms) | `1000` | buffered writes flushed to disk every second |
| Enabled | `true` | master switch |

It writes one file per **ET session date**: `ticks-YYYY-MM-DD.jsonl`. Line
timestamps are UTC ISO (unambiguous for the recorder).

## Feed it into the worker

Point a release config's `tickLog` at the day's file and build the package:

```bash
cd release-journal-worker
npm run build:journal -- my-release-config.json "C:\RSInvest\journal-feed\ticks-2026-05-29.jsonl"
```

The config lists the assets (symbol, direction, role, tickSize). See
`samples/demo-ism-config.json` (created by `npm run demo`) for the shape. The
builder computes peak/MAE/MFE/R-R from the window and writes the package the
dashboard imports.

## Notes & edge cases

- **Symbol matching** is `Name.ToUpper().Contains(token)`. If a token is ambiguous
  on your connection (e.g. two contracts match), use a more specific token.
- **Release window across ET midnight:** a window that crosses midnight ET spans
  two daily files — concatenate them (`type a.jsonl b.jsonl > merged.jsonl`) and
  point `tickLog` at the merged file.
- **Always-on:** simplest operation is to leave the tee running through the
  session; the recorder just reads whatever window each release needs. No
  release scheduling lives in the tee (that's Phase 3+).
- **Not built/tested in CI** — this is Quantower/Windows/Rithmic-specific and must
  be built + run on the journal box. It mirrors the deployed `QT_DealEmitter` /
  `SystematicEngine` API usage (v1.146.x).
