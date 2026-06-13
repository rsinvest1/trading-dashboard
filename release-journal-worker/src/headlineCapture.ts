// headlineCapture — read + classify FinancialJuice news headlines (Phase 4).
//
// The Python news tee (feed/fj_news_tee.py) attaches to the logged-in FJ Chrome
// and appends a rolling JSONL headline log. This module is the Node side: it
// reads the window slice and classifies each headline (relevance / category /
// possible-new-info). Pure & deterministic — no browser, fully unit-testable.
//
// Log line: {"t":ISO, "source":"CNBC", "text":"...", "sub":"..."}

import { readFile } from 'node:fs/promises';
import type { ReleaseJournalHeadline } from '../schema/releaseJournalSchema';

export type RawHeadline = { timestamp: string; text: string; sub?: string; source?: string };
export type HeadlineContext = { releaseKey: string; symbols: string[] };

type Relevance = 'HIGH' | 'MEDIUM' | 'LOW';
type Category =
  | 'release_related' | 'fed_central_bank' | 'geopolitical' | 'inflation'
  | 'growth' | 'labor' | 'risk_sentiment' | 'other';

// ── Log parsing ──────────────────────────────────────────────────────────────
export function parseHeadlineLog(text: string): RawHeadline[] {
  const out: RawHeadline[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    let o: any;
    try { o = JSON.parse(s); } catch { continue; }
    const timestamp = o.t ?? o.timestamp;
    const txt = o.text ?? o.title;
    if (!timestamp || !txt) continue;
    out.push({ timestamp, text: String(txt).trim(), sub: o.sub ?? o.subtitle, source: o.source ?? o.src });
  }
  return out;
}

export async function readHeadlineLog(path: string): Promise<RawHeadline[]> {
  return parseHeadlineLog(await readFile(path, 'utf8'));
}

// Filter to [startTime, endTime] and dedup by source|text (keep earliest).
export function selectHeadlineWindow(raw: RawHeadline[], w: { startTime: string; endTime: string }): RawHeadline[] {
  const start = Date.parse(w.startTime);
  const end = Date.parse(w.endTime);
  const seen = new Set<string>();
  const out: RawHeadline[] = [];
  for (const h of [...raw].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    const ms = Date.parse(h.timestamp);
    if (!Number.isFinite(ms) || ms < start || ms > end) continue;
    const key = ((h.source || '') + '|' + h.text).toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

// ── Classification ───────────────────────────────────────────────────────────
const RX: Record<Exclude<Category, 'release_related' | 'other'>, RegExp> = {
  fed_central_bank: /\b(fed|fomc|federal reserve|powell|goolsbee|williams|waller|bostic|ecb|lagarde|boe|bailey|boj|ueda|snb|schlegel|rba|rbnz|central bank|rate decision|interest rate|hawkish|dovish|policymaker)\b/i,
  inflation: /\b(cpi|pce|inflation|prices? paid|\bppi\b|deflator|disinflation|price index)\b/i,
  labor: /\b(payrolls?|nonfarm|\bnfp\b|jobless|unemployment|employment|\bjobs\b|jobless claims|\badp\b)\b/i,
  growth: /\b(\bgdp\b|\bpmi\b|\bism\b|retail sales|industrial production|durable goods|factory orders|consumer (confidence|sentiment))\b/i,
  geopolitical: /\b(war|sanction|missile|nuclear|airstrike|strike on|attack|invasion|iran|russia|ukraine|north korea|israel|gaza|opec|coup|tariff|kremlin)\b/i,
  risk_sentiment: /\b(risk-off|risk on|sell-?off|plunge|plunges|surge|tumble|rally|volatility|\bvix\b|safe haven|flight to)\b/i,
};

const SECTOR: { rx: RegExp; sym: string }[] = [
  { rx: /\b(crude|oil|wti|brent|opec|gasoline|distillate)\b/i, sym: 'CL' },
  { rx: /\b(gold|bullion|\bxau\b|precious metal)\b/i, sym: 'GC' },
  { rx: /\b(nasdaq|tech\b|semiconduct|\bchip\b|chips|\bai\b|software|nvidia|broadcom|apple|microsoft|alphabet)\b/i, sym: 'NQ' },
  { rx: /\b(s&p ?500|equities|stocks|wall street)\b/i, sym: 'ES' },
  { rx: /\b(russell|small[- ]?cap)\b/i, sym: 'RTY' },
  { rx: /\b(euro\b|eur\/usd|eurozone|germany|german|\becb\b)\b/i, sym: '6E' },
];

const KEY_STOP = new Set(['us', 'the', 'and', 'for', 'final', 'prelim', 'flash', 'mom', 'yoy', 'qoq', 'sa', 'nsa', 'vs']);

// Distinctive tokens + acronyms from the release key (e.g. "US ISM Manufacturing PMI").
function releaseSignals(releaseKey: string) {
  const tokens = (releaseKey || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const acronyms = tokens.filter(t => /^[A-Z0-9]{2,5}$/.test(t) && /[A-Z]/.test(t));
  const distinctive = tokens
    .map(t => t.toLowerCase())
    .filter(t => t.length >= 3 && !KEY_STOP.has(t));
  return { acronyms: acronyms.map(a => a.toLowerCase()), distinctive };
}

export function classifyHeadline(text: string, sub: string | undefined, _source: string | undefined, ctx: HeadlineContext): {
  relevance: Relevance; category: Category; possibleNewInformationEvent: boolean; likelyMarketEffect: 'unknown';
} {
  const blob = `${text} ${sub || ''}`.toLowerCase();
  const { acronyms, distinctive } = releaseSignals(ctx.releaseKey);

  // release_related: the headline references this scheduled release's topic.
  const hasAcronym = acronyms.some(a => new RegExp(`\\b${a}\\b`, 'i').test(blob));
  const matchedDistinct = distinctive.filter(t => blob.includes(t)).length;
  const releaseRelated = hasAcronym || matchedDistinct >= 2;

  let category: Category;
  if (releaseRelated) category = 'release_related';
  else if (RX.fed_central_bank.test(blob)) category = 'fed_central_bank';
  else if (RX.inflation.test(blob)) category = 'inflation';
  else if (RX.labor.test(blob)) category = 'labor';
  else if (RX.growth.test(blob)) category = 'growth';
  else if (RX.geopolitical.test(blob)) category = 'geopolitical';
  else if (RX.risk_sentiment.test(blob)) category = 'risk_sentiment';
  else category = 'other';

  const HIGH_CATS: Category[] = ['release_related', 'fed_central_bank', 'inflation', 'labor', 'growth', 'geopolitical'];
  const sectorHit = SECTOR.some(s => s.rx.test(blob)); // any tracked-sector mention bumps to MEDIUM

  let relevance: Relevance;
  if (HIGH_CATS.includes(category)) relevance = 'HIGH';
  else if (category === 'risk_sentiment' || sectorHit) relevance = 'MEDIUM';
  else relevance = 'LOW';

  return {
    relevance,
    category,
    // A HIGH headline that ISN'T just the scheduled print → may have re-priced.
    possibleNewInformationEvent: relevance === 'HIGH' && category !== 'release_related',
    likelyMarketEffect: 'unknown',
  };
}

// ── Capture (read window + classify → schema headlines) ──────────────────────
export function captureHeadlines(p: {
  raw: RawHeadline[]; startTime: string; endTime: string; releaseKey: string; symbols: string[];
}): ReleaseJournalHeadline[] {
  const ctx: HeadlineContext = { releaseKey: p.releaseKey, symbols: p.symbols };
  return selectHeadlineWindow(p.raw, p).map(h => {
    const c = classifyHeadline(h.text, h.sub, h.source, ctx);
    return {
      timestamp: h.timestamp,
      text: h.text,
      source: 'FINANCIALJUICE',
      relevance: c.relevance,
      category: c.category,
      possibleNewInformationEvent: c.possibleNewInformationEvent,
      likelyMarketEffect: c.likelyMarketEffect,
    };
  });
}
