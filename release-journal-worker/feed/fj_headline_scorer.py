"""
fj_headline_scorer.py — RED-headline judge (ContextEngine daily-bias feed, phase 1).

Sits next to fj_news_tee.py and consumes its rolling JSONL log:

    C:\\RSInvest\\journal-feed\\headlines-<ET-date>.jsonl
    {"t": "<UTC ISO>", "source": "CNBC", "text": "...", "sub": "...", "fj_time": "...",
     "impact": "breaking"|"high"|"normal", "keys": ["Energy", "US Indexes", "USD"]}

FinancialJuice already classifies: high-impact headlines come with a RED
background ("impact": "high") and market keys naming the impacted markets; the
biggest appear as the top-of-page BREAKING banner ("impact": "breaking"). This
scorer is therefore deterministic — NO Anthropic API (phase 1 decision):

  impact normal              -> ignored
  scheduled-print outcome    -> SKIPPED (already reaches the bias via the
                                strategy-log composites; would double-count)
  keys -> symbols            -> US Indexes: NQ ES YM RTY · US Bonds / USD: GC UB
                                · Energy: CL · Market Moving: amplifier only
  direction                  -> risk-on/off lexicon, de-escalation checked FIRST
                                ("cancelled scheduled strikes" = risk-ON);
                                unreadable direction -> skip + log
  magnitude                  -> red +/-50, BREAKING +/-75
  signs (risk-OFF)           -> indexes -, GC +, UB +, CL +   (risk-ON inverse)

Per 5s cycle: tail new lines (persisted byte offset, ET-date rollover) -> dedup
(rolling hash set, survives tee restarts) -> score -> publish (atomic):

    C:\\RSInvest\\signals\\headline_score.json     (own file — NEVER news_score.json)
    {"updated_at_et": "...", "items": [{"symbol","score","ts","headline","src"}]}

Items pruned after 12h. The ContextEngine aggregates them with the same
symbol-match + 6h half-life it uses for the intraday release tier.

USAGE:
    python fj_headline_scorer.py                  # resident loop (watchdog-managed)
    python fj_headline_scorer.py --once           # single pass and exit (tests)
    python fj_headline_scorer.py --feed-dir D --out F --state S   # overrides
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import time

FEED_DIR_DEFAULT  = r"C:\RSInvest\journal-feed"
OUT_DEFAULT       = r"C:\RSInvest\signals\headline_score.json"
STATE_DEFAULT     = r"C:\co-work\autopilot\state\headline_scorer_state.json"

POLL_S            = 5.0
SEEN_HASH_MAX     = 500
ITEM_TTL_HOURS    = 12.0
HEADLINE_MAX      = 80
RED_MAGNITUDE     = 50
BREAKING_MAGNITUDE = 75

# ── FJ keys -> futures symbols (case-insensitive; union across keys) ─────────
KEY_SYMBOLS = {
    "us indexes": ["NQ", "ES", "YM", "RTY"],
    "us bonds":   ["GC", "UB"],
    "usd":        ["GC", "UB"],
    "energy":     ["CL"],
    # "market moving" carries no symbols by itself — amplifier tag only
}

# Sign per symbol when the headline reads risk-OFF (risk-ON is the inverse).
RISK_OFF_SIGN = {"NQ": -1, "ES": -1, "YM": -1, "RTY": -1, "GC": +1, "UB": +1, "CL": +1}

# ── direction lexicon ────────────────────────────────────────────────────────
# Risk-ON is checked FIRST: "cancelled scheduled strikes" contains both
# "cancelled" (on) and "strikes" (off) — the de-escalation reading wins.
RISK_ON_RX = re.compile(
    r"\b(cancel\w*|calls? off|called off|halt\w*|paus\w*|no longer"
    r"|ceasefire|cease-fire|truce|peace|deal|agreement"
    r"|dovish|rate cuts?|cuts? rates?|eas(?:e|es|ing)"
    r"|beat(?:s)?|tops?|surge\w*|rall(?:y|ies))\b", re.I)
RISK_OFF_RX = re.compile(
    r"\b(strikes?|struck|hitting|attack\w*|missiles?|war|escalat\w*|invasion|bomb\w*|nuclear"
    r"|sanction\w*|tariff\w*"
    r"|hawkish|rate hikes?|hikes? rates?|raises? rates?|higher for longer"
    r"|miss(?:es|ed)?|plunge\w*|tumble\w*|crash\w*|warns?)\b", re.I)

# Scheduled-print outcome shape: "US CPI YoY Actual 2.4% (Forecast 2.5% ...)".
RELEASE_PRINT_RX = re.compile(
    r"\bactual\b|\(\s*(?:est|exp|fcst|forecast|cons)\b|\bvs\.?\s+(?:est|exp|forecast|consensus)\b"
    r"|\b(?:est|exp|fcst|forecast|prev|previous)\.?\s*:?\s*-?\d", re.I)

# BREAKING banner records carry no key tags; a banner is market-wide by
# definition -> default to indexes + bonds/USD complex, plus CL when oil-linked.
OIL_LINKED_RX = re.compile(r"\b(oil|crude|opec|hormuz|refinery|tanker|iran|russia|kharg)\b", re.I)


def classify_direction(text, sub):
    """-> 'risk_on' | 'risk_off' | None (unreadable)."""
    blob = f"{text} {sub or ''}"
    if RISK_ON_RX.search(blob):
        return "risk_on"
    if RISK_OFF_RX.search(blob):
        return "risk_off"
    return None


def symbols_for(rec):
    """Impacted symbols from the FJ keys (BREAKING default when keys absent)."""
    keys = [str(k).strip().lower() for k in (rec.get("keys") or [])]
    syms = []
    for k in keys:
        for s in KEY_SYMBOLS.get(k, []):
            if s not in syms:
                syms.append(s)
    if not syms and rec.get("impact") == "breaking":
        syms = ["NQ", "ES", "YM", "RTY", "GC", "UB"]
        if OIL_LINKED_RX.search(f"{rec.get('text', '')} {rec.get('sub', '')}"):
            syms.append("CL")
    return syms


def score_record(rec):
    """One tee record -> {symbol: signed score} or {} (skip)."""
    impact = rec.get("impact", "normal")
    if impact not in ("high", "breaking"):
        return {}
    text, sub = rec.get("text", ""), rec.get("sub", "")
    if RELEASE_PRINT_RX.search(f"{text} {sub}"):
        print(f"[scorer] skip scheduled-print outcome: {text[:60]}")
        return {}
    syms = symbols_for(rec)
    if not syms:
        print(f"[scorer] skip (no mapped keys {rec.get('keys')}): {text[:60]}")
        return {}
    direction = classify_direction(text, sub)
    if direction is None:
        print(f"[scorer] skip (direction unreadable): {text[:60]}")
        return {}
    mag = BREAKING_MAGNITUDE if impact == "breaking" else RED_MAGNITUDE
    flip = 1 if direction == "risk_off" else -1
    return {s: RISK_OFF_SIGN[s] * flip * mag for s in syms if s in RISK_OFF_SIGN}


# ── time / state / io plumbing (unchanged from v1) ───────────────────────────

def et_now():
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("America/New_York"))
    except Exception:   # missing tzdata package — same fallback as the tee
        return datetime.datetime.utcnow()


def et_date():
    # Must produce the same date string as the tee's et_date() (it names the
    # JSONL file we tail) — including the same UTC fallback.
    return et_now().strftime("%Y-%m-%d")


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc)


def load_state(path):
    state = {"date": "", "offset": 0, "seen_hashes": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            j = json.load(f)
        for k in state:
            if k in j:
                state[k] = j[k]
    except (OSError, ValueError):
        pass
    return state


def save_state(path, state):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f)
        os.replace(tmp, path)
    except OSError as e:
        print(f"[scorer] state save failed: {e}")


def headline_hash(source, text):
    # identical to the tee's dedup key, so tee-restart duplicates collapse
    return hashlib.md5(((source or "") + "|" + (text or "")).lower().encode("utf-8")).hexdigest()


def read_new_lines(feed_dir, state):
    """Tail today's JSONL from the persisted offset. ET rollover resets the
    offset to the new day's file. Returns list of parsed records."""
    today = et_date()
    if state["date"] != today:
        state["date"] = today
        state["offset"] = 0
    path = os.path.join(feed_dir, f"headlines-{today}.jsonl")
    if not os.path.exists(path):
        return []
    size = os.path.getsize(path)
    if size < state["offset"]:        # truncated/rewritten file: start over
        state["offset"] = 0
    if size == state["offset"]:
        return []
    with open(path, "rb") as f:
        f.seek(state["offset"])
        chunk = f.read()
    # only complete lines advance the offset (tee may be mid-write)
    end = chunk.rfind(b"\n")
    if end < 0:
        return []
    state["offset"] += end + 1
    records = []
    for raw in chunk[:end].split(b"\n"):
        raw = raw.strip()
        if not raw:
            continue
        try:
            rec = json.loads(raw.decode("utf-8", errors="replace"))
        except ValueError:
            continue
        if rec.get("text"):
            records.append(rec)
    return records


def load_items(out_path):
    try:
        with open(out_path, "r", encoding="utf-8") as f:
            j = json.load(f)
        return [it for it in j.get("items", []) if it.get("symbol") and it.get("score")]
    except (OSError, ValueError):
        return []


def prune_items(items):
    cutoff = utc_now() - datetime.timedelta(hours=ITEM_TTL_HOURS)
    keep = []
    for it in items:
        try:
            ts = datetime.datetime.fromisoformat(str(it.get("ts", "")).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
        if ts >= cutoff:
            keep.append(it)
    return keep


def write_output(out_path, items):
    payload = {
        "updated_at_et": et_now().strftime("%Y-%m-%d %H:%M:%S"),
        "items": items,
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    os.replace(tmp, out_path)


def make_items(rec, scores):
    ts = rec.get("t") or utc_now().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    head = (rec.get("text") or "")[:HEADLINE_MAX]
    src = "breaking" if rec.get("impact") == "breaking" else "red"
    return [{"symbol": s, "score": v, "ts": ts, "headline": head, "src": src}
            for s, v in scores.items() if v]


# ── one scoring cycle ────────────────────────────────────────────────────────

def run_cycle(args, state, items):
    """Returns True when the output file changed."""
    records = read_new_lines(args.feed_dir, state)
    new_items = []
    if records:
        seen = set(state["seen_hashes"])
        for rec in records:
            h = headline_hash(rec.get("source"), rec.get("text"))
            if h in seen:
                continue
            seen.add(h)
            state["seen_hashes"].append(h)
            scores = score_record(rec)
            if scores:
                new_items.extend(make_items(rec, scores))
        state["seen_hashes"] = state["seen_hashes"][-SEEN_HASH_MAX:]

    items.extend(new_items)
    pruned = prune_items(items)
    changed = bool(new_items) or len(pruned) != len(items)
    items[:] = pruned
    if changed:
        write_output(args.out, items)
        for it in new_items:
            print(f"[scorer] {it['src']}: {it['symbol']} {it['score']:+d} | {it['headline']}")
    return changed


def main():
    ap = argparse.ArgumentParser(description="FinancialJuice RED-headline scorer (no API)")
    ap.add_argument("--once", action="store_true", help="single pass and exit (tests)")
    ap.add_argument("--feed-dir", default=FEED_DIR_DEFAULT)
    ap.add_argument("--out", default=OUT_DEFAULT)
    ap.add_argument("--state", default=STATE_DEFAULT)
    args = ap.parse_args()

    print(f"[scorer] online — red +/-{RED_MAGNITUDE} breaking +/-{BREAKING_MAGNITUDE} "
          f"feed={args.feed_dir} out={args.out}")

    state = load_state(args.state)
    items = prune_items(load_items(args.out))

    while True:
        try:
            run_cycle(args, state, items)
            save_state(args.state, state)   # offset/date move even on quiet cycles
        except KeyboardInterrupt:
            print("\n[scorer] stopped")
            break
        except Exception as e:
            print(f"[scorer] cycle error: {type(e).__name__}: {e}")
        if args.once:
            break
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
