// expectedBehavior — registers what the scorecard EXPECTED for a release (Phase 6).
//
// Reads the macro_score system's files on disk (the decoupled pattern: the prep
// agent writes them, the journal only reads):
//   daily_prep/<date>.json   → the day's events (alert/confirmation symbols, notes, regime)
//   templates/<templateId>.json → indicators, conflict rules, per-symbol narratives
//   logs/<ts>_<templateId>_score.json → the computed per-symbol bias/confidence/score
//
// parseExpected() is pure (takes the already-parsed JSON); loadExpected() does the
// I/O (locating the latest score log by filename timestamp). It NEVER writes to
// macro_score — comparison/adjustments are emitted separately, output-only.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ReleaseExpected, ExpectedSymbol, ExpectedBias, ExpectedConfidence,
} from '../schema/releaseJournalSchema';

// ── Loose shapes of the external macro_score JSON (only the fields we read) ────
export type DailyPrepEvent = {
  id?: string; timeET?: string; title?: string; templateId?: string;
  tradableAlerts?: string[]; confirmationSymbols?: string[];
  playbookKeys?: string[]; notes?: string[];
};
export type DailyPrep = {
  date?: string; activeCorrelationRegime?: string; events?: DailyPrepEvent[];
};
export type ConflictRule = {
  id?: string; description?: string; affects?: string[];
  maxConfidence?: string; conflictNote?: string;
};
export type TemplateIndicator = {
  key?: string; label?: string; weight?: number;
  contributions?: Record<string, number>;
};
export type Template = {
  id?: string; label?: string; releaseTimeET?: string;
  instruments?: string[]; narratives?: Record<string, string>;
  indicators?: TemplateIndicator[]; conflictRules?: ConflictRule[];
};
export type ScoreEntry = {
  symbol: string; score?: number; bias?: string; confidence?: string;
  narrative?: string; reasons?: string[]; conflicts?: string[]; missingFields?: string[];
};
export type ScoreLog = {
  templateId?: string; templateLabel?: string;
  scores?: ScoreEntry[]; best?: { symbol?: string }; secondary?: { symbol?: string };
  warnings?: string[];
};

const asBias = (b?: string): ExpectedBias =>
  b === 'LONG' || b === 'SHORT' ? b : 'NO_TRADE';
const asConfidence = (c?: string): ExpectedConfidence =>
  c === 'A' || c === 'B' || c === 'C' ? c : 'NO_TRADE';

// Build the ExpectedBehavior block from the (optional) daily-prep event, template,
// and score log. Robust to any input being null: the score-only path (no daily
// prep / template) and the plan-only path (no score yet) both work.
export function parseExpected(
  dailyPrep: DailyPrep | null,
  template: Template | null,
  score: ScoreLog | null,
  templateId: string,
): ReleaseExpected {
  const event = dailyPrep?.events?.find(e => e.templateId === templateId) ?? null;
  const scoreBySym = new Map<string, ScoreEntry>();
  for (const s of score?.scores ?? []) scoreBySym.set(s.symbol, s);

  // Alert symbols: prefer the daily-prep alert list, then the template instruments,
  // then whatever the score scored (excluding pure NO_TRADE confirmation rows).
  const alertSymbols: string[] =
    event?.tradableAlerts?.length ? event.tradableAlerts
    : template?.instruments?.length ? template.instruments
    : (score?.scores ?? []).map(s => s.symbol);

  const confirmationSymbols: string[] = event?.confirmationSymbols ?? [];

  const perSymbol: Record<string, ExpectedSymbol> = {};
  for (const sym of alertSymbols) {
    const e = scoreBySym.get(sym);
    perSymbol[sym] = {
      role: 'ALERT',
      expectedBias: asBias(e?.bias),
      expectedConfidence: asConfidence(e?.confidence),
      score: e?.score,
      narrative: e?.narrative ?? template?.narratives?.[sym],
      reasons: e?.reasons ?? [],
      conflicts: e?.conflicts ?? [],
      missingFields: e?.missingFields ?? [],
    };
  }
  for (const sym of confirmationSymbols) {
    if (perSymbol[sym]) continue; // an alert can't be downgraded to confirmation
    perSymbol[sym] = {
      role: 'CONFIRMATION',
      expectedBias: 'NO_TRADE',
      expectedConfidence: 'NO_TRADE',
      narrative: template?.narratives?.[sym],
      reasons: [], conflicts: [], missingFields: [],
    };
  }

  return {
    templateId,
    templateLabel: template?.label ?? score?.templateLabel,
    releaseTimeET: template?.releaseTimeET ?? event?.timeET,
    title: event?.title ?? template?.label,
    regimeContext: dailyPrep?.activeCorrelationRegime,
    notes: event?.notes ?? [],
    perSymbol,
    best: score?.best?.symbol,
    secondary: score?.secondary?.symbol,
    warnings: score?.warnings ?? [],
  };
}

async function readJsonOrNull<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch { return null; }
}

// Find the most recent logs/<ts>_<templateId>_score.json by filename timestamp.
export async function findLatestScoreLog(logsDir: string, templateId: string): Promise<string | null> {
  let files: string[];
  try { files = await readdir(logsDir); } catch { return null; }
  const suffix = `_${templateId}_score.json`;
  const matching = files.filter(f => f.endsWith(suffix)).sort().reverse(); // filenames lead with YYYYMMDD_HHMMSS
  return matching.length ? join(logsDir, matching[0]) : null;
}

// Load just the raw template (the adjustment engine reads its conflictRules).
export async function loadTemplate(macroScoreRoot: string, templateId: string): Promise<Template | null> {
  return readJsonOrNull<Template>(join(macroScoreRoot, 'templates', `${templateId}.json`));
}

export type LoadExpectedOpts = {
  macroScoreRoot: string;   // e.g. C:\RSInvest\macro_score
  dailyPrepDate: string;    // YYYY-MM-DD
  templateId: string;
};

// I/O wrapper: load + parse the three sources and build ExpectedBehavior. Any
// missing file degrades gracefully (null), so a release with only a score log,
// or only a plan, still produces a usable expected block.
export async function loadExpected(opts: LoadExpectedOpts): Promise<ReleaseExpected> {
  const root = opts.macroScoreRoot;
  const dailyPrep = await readJsonOrNull<DailyPrep>(join(root, 'daily_prep', `${opts.dailyPrepDate}.json`));
  const template = await readJsonOrNull<Template>(join(root, 'templates', `${opts.templateId}.json`));
  const scorePath = await findLatestScoreLog(join(root, 'logs'), opts.templateId);
  const score = scorePath ? await readJsonOrNull<ScoreLog>(scorePath) : null;
  return parseExpected(dailyPrep, template, score, opts.templateId);
}
