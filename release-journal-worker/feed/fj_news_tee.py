"""
fj_news_tee.py — FinancialJuice news-feed tee (Release Journal Worker · Phase 4)

Mirrors the proven attach_financialjuice.py idiom: attach (Selenium) to the
already-logged-in Chrome on 127.0.0.1:9222, poll the FJ NEWS pane, dedup, and
append new headlines to a rolling JSONL log the journal reads:

    C:\\RSInvest\\journal-feed\\headlines-<ET-date>.jsonl
    {"t": "<UTC ISO>", "source": "CNBC", "text": "<title>", "sub": "<subtitle>", "fj_time": "17:45 Jun 03 CNBC",
     "impact": "breaking"|"high"|"normal", "keys": ["Energy", "US Indexes", "USD"]}

`t` = first-seen UTC capture time (same philosophy as the tick tee) — accurate to
the poll interval, and immune to FinancialJuice's displayed-time timezone.

IMPACT/KEYS (headline-listener phase 1): FJ marks high-impact headlines with a
RED background and tags the impacted markets ("Energy", "US Indexes", "US Bonds",
"USD", ...) in the item footer; the very biggest also appear as a BREAKING banner
at the top of the page. The tee captures both signals:
  impact: "breaking" (top banner) / "high" (red background) / "normal"
  keys:   market tags parsed from the trailing time line / footer text
Red detection needs no locked selector — the item's computed backgroundColor
(walking up transparent ancestors) is tested for redness; --red-class can pin a
class substring instead once locked via --dump. Extra fields are ignored by the
release-journal consumer (headlineCapture.ts parseHeadlineLog), so the existing
scheduler keeps working unchanged.

PREREQS (journal box): run C:\\RSInvest\\start_chrome_cdp.bat, log into FJ on that
Chrome, then `pip install selenium`. READ-ONLY: it only reads the page.

USAGE:
    python fj_news_tee.py --dump            # one-time: dump the news pane DOM to lock the selector
    python fj_news_tee.py                    # run the tee (default selector autodetect)
    python fj_news_tee.py --selector "div.news-item"   # override once you've locked it

SELECTOR NOTE: the *calendar* selectors are known (event-*). The *news-feed*
item selector needs ONE live verification (like PCE_Scraper.py: "selectores
verificados ao vivo"). Run --dump, open feed/fj_news_dump.html, find the repeating
news-item element, and pass it via --selector (or set DEFAULT_SELECTOR below).
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import time

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

CHROME_DEBUG = "127.0.0.1:9222"
DEFAULT_LOG_DIR = r"C:\RSInvest\journal-feed"
DEFAULT_POLL_S = 4.0
# Best-guess news-item selectors, tried in order until one yields time-stamped
# items. Lock the real one with --dump → --selector.
DEFAULT_SELECTORS = [
    "div.news-item", "li.news-item", "[class*='news-item']", "[class*='newsItem']",
    "div[class*='news'] [class*='item']", "a[class*='news']",
]
# "17:45 Jun 03" style line (time + Mon + day), optionally trailed by a source
# and/or market-impact keys ("08:23 Jun 11 Energy US Indexes USD").
TIME_RX = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d\s+[A-Z][a-z]{2}\s+\d{1,2}\b(.*)$")

# FJ market-impact key vocabulary (longest-first so "US Indexes" can't be
# shadowed by a shorter token). Tokens in the time-line trailer / footer that
# match become `keys`; the remainder stays the `source` (e.g. "CNBC").
KEY_VOCAB = [
    "Market Moving", "US Indexes", "US Bonds", "EU Indexes", "UK Indexes",
    "Asian Indexes", "Energy", "Metals", "Grains", "Softs", "Forex", "Crypto",
    "USD", "EUR", "GBP", "JPY",
]


def extract_keys(trailer):
    """Trailer/footer text -> (keys list, leftover source string)."""
    keys = []
    rest = " " + (trailer or "") + " "
    for k in KEY_VOCAB:
        rx = re.compile(r"(?<![A-Za-z])" + re.escape(k) + r"(?![A-Za-z])", re.IGNORECASE)
        if rx.search(rest):
            keys.append(k)
            rest = rx.sub(" ", rest)
    source = re.sub(r"\s+", " ", rest).strip()
    return keys, source


def is_red_element(driver, el, red_class=""):
    """High-impact (red background) test. Class-substring match when locked via
    --red-class; otherwise computed backgroundColor, walking up transparent
    ancestors, tested for redness."""
    try:
        if red_class:
            cls = el.get_attribute("class") or ""
            return red_class.lower() in cls.lower()
        bg = driver.execute_script(
            "var e=arguments[0];"
            "for (var i=0; i<4 && e; i++) {"
            "  var c=window.getComputedStyle(e).backgroundColor;"
            "  if (c && c!=='rgba(0, 0, 0, 0)' && c!=='transparent') return c;"
            "  e=e.parentElement;"
            "} return '';", el)
        m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)", bg or "")
        if not m:
            return False
        return is_red_rgb(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except Exception:
        return False


def is_red_rgb(r, g, b):
    return r > 120 and r > 1.5 * g and r > 1.5 * b


def find_breaking(driver):
    """Top-of-page BREAKING banner headlines (oversized red banner). Returns
    list of cleaned headline strings. Autodetect: class containing 'breaking',
    then any element whose text starts with 'BREAKING'."""
    els = []
    try:
        els = driver.find_elements(By.CSS_SELECTOR, "[class*='breaking' i]")
    except Exception:
        pass
    if not els:
        try:
            els = driver.find_elements(
                By.XPATH, "//*[starts-with(normalize-space(.), 'BREAKING')]")
        except Exception:
            pass
    out = []
    for el in els[:5]:
        try:
            txt = (el.text or "").strip()
        except Exception:
            continue
        txt = re.sub(r"^\s*BREAKING\s*:?\s*", "", txt, flags=re.IGNORECASE)
        txt = txt.split("\n")[0].strip()
        if len(txt) >= 12 and txt not in out:
            out.append(txt)
    return out


def attach_driver():
    opts = Options()
    opts.debugger_address = CHROME_DEBUG
    return webdriver.Chrome(options=opts)


def et_date():
    # ET session date for the filename (line timestamps stay UTC).
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return datetime.datetime.utcnow().strftime("%Y-%m-%d")


def utc_now_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse_item(text):
    """Item text → dict. Lines: title, [sub], 'HH:MM Mon DD [SOURCE] [KEYS]',
    [key footer lines]. The time line is searched from the end (FJ may render
    the market-key tags as extra lines after it)."""
    lines = [ln.strip() for ln in (text or "").split("\n") if ln.strip()]
    if not lines:
        return None
    ti = -1
    for i in range(len(lines) - 1, max(-1, len(lines) - 4), -1):
        if TIME_RX.match(lines[i]):
            ti = i
            break
    if ti <= 0:   # no time line, or nothing before it to be the title
        return None
    m = TIME_RX.match(lines[ti])
    trailer = " ".join([(m.group(2) or "").strip()] + lines[ti + 1:])
    keys, source = extract_keys(trailer)
    body = lines[:ti]
    title = body[0]
    sub = " ".join(body[1:]) if len(body) > 1 else ""
    return {"text": title, "sub": sub, "fj_time": lines[ti], "source": source, "keys": keys}


def find_items(driver, selector, red_class=""):
    selectors = [selector] if selector else DEFAULT_SELECTORS
    for sel in selectors:
        try:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
        except Exception:
            continue
        items = []
        for el in els:
            try:
                parsed = parse_item(el.text)
            except Exception:
                parsed = None
            if parsed and parsed["fj_time"]:   # require a timestamp line → it's a news item
                parsed["impact"] = "high" if is_red_element(driver, el, red_class) else "normal"
                items.append(parsed)
        if items:
            return sel, items
    return None, []


def main():
    ap = argparse.ArgumentParser(description="FinancialJuice news-feed tee")
    ap.add_argument("--selector", default="", help="CSS selector for a news item (overrides autodetect)")
    ap.add_argument("--red-class", default="", help="class substring marking a red/high-impact item (overrides the computed-style heuristic)")
    ap.add_argument("--poll", type=float, default=DEFAULT_POLL_S, help="poll interval seconds")
    ap.add_argument("--log-dir", default=DEFAULT_LOG_DIR, help="output directory")
    ap.add_argument("--dump", action="store_true", help="dump the page DOM to fj_news_dump.html and exit")
    args = ap.parse_args()

    print(f"[fj_news_tee] attaching to Chrome {CHROME_DEBUG} ...")
    driver = attach_driver()
    print(f"[fj_news_tee] page: {driver.title}")

    if args.dump:
        html = driver.execute_script("return document.body.outerHTML;")
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fj_news_dump.html")
        with open(out, "w", encoding="utf-8") as f:
            f.write(html)
        print(f"[fj_news_tee] DOM dumped → {out}")
        print("Open it, find the repeating news-item element, and re-run with --selector \"<css>\".")
        return

    os.makedirs(args.log_dir, exist_ok=True)
    seen = set()
    print(f"[fj_news_tee] polling every {args.poll}s — Ctrl+C to stop")
    while True:
        try:
            sel, items = find_items(driver, args.selector, args.red_class)
            if not items:
                print("[fj_news_tee] no news items matched — run with --dump to lock the selector")
            path = os.path.join(args.log_dir, f"headlines-{et_date()}.jsonl")
            new = 0
            with open(path, "a", encoding="utf-8") as f:
                # BREAKING banner first, so a headline visible in both places is
                # recorded at its highest impact (dedup is first-seen-wins).
                for txt in find_breaking(driver):
                    key = hashlib.md5(("|" + txt).lower().encode("utf-8")).hexdigest()
                    if key in seen:
                        continue
                    seen.add(key)
                    rec = {"t": utc_now_iso(), "source": "", "text": txt, "sub": "",
                           "fj_time": "", "impact": "breaking", "keys": []}
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    new += 1
                for it in items:
                    key = hashlib.md5(((it["source"] or "") + "|" + it["text"]).lower().encode("utf-8")).hexdigest()
                    if key in seen:
                        continue
                    seen.add(key)
                    rec = {"t": utc_now_iso(), "source": it["source"], "text": it["text"],
                           "sub": it["sub"], "fj_time": it["fj_time"],
                           "impact": it["impact"], "keys": it["keys"]}
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    new += 1
            if new:
                print(f"[fj_news_tee] +{new} headline(s) via '{sel}' → {os.path.basename(path)}")
        except KeyboardInterrupt:
            print("\n[fj_news_tee] stopped")
            break
        except Exception as e:
            print(f"[fj_news_tee] poll error: {e}")
        time.sleep(args.poll)


if __name__ == "__main__":
    main()
