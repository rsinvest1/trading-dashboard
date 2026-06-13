// behaviorComparison — closes the scorecard ⇄ behavior loop (Phase 6).
//
// Given the ExpectedBehavior (what the scorecard called) and the per-symbol
// LegAnalysis (what actually happened), it scores the match for every alert
// symbol — did the expected bias hit, which leg paid, what was the realized
// quality and how clean was the execution — plus a confirmation-market check
// (did the confirmation symbols agree, and were any confirmation sources missing,
// which caps confidence). Pure & deterministic.

import type {
  ReleaseExpected, LegAnalysis, ReleaseComparison, SymbolComparison,
  ConfirmationCheck, ExpectedBias, LegDir, BestLeg, ScoreQuality, ExecutionQuality,
} from '../schema/releaseJournalSchema';

const MIN_EDGE_TICKS = 4;   // a first impulse smaller than this is "no real edge"
const SLOW_FIRST_SEC = 120; // first extreme later than this reads as a slow/late move

// How each symbol moves in a generic risk-on / lower-yields impulse (+1 with risk,
// -1 against). Used ONLY for the confirmation agreement vote; ambiguous symbols
// (GC/CL/HG/6C/6J) are reported but excluded from the vote. Bond PRICE up = lower
// yields = dovish/risk-on, hence +1.
const RISK_SIGN: Record<string, number> = {
  NQ: 1, MNQ: 1, RTY: 1, M2K: 1, ES: 1, MES: 1, NKD: 1, DAX: 1, EUROSTOXX50: 1,
  UB: 1, ZN: 1, ZB: 1, TN: 1, BUND: 1,
  '6E': 1, DXY: -1, VIX: -1,
};

const biasToDir = (b: ExpectedBias): LegDir => (b === 'LONG' ? 'UP' : b === 'SHORT' ? 'DOWN' : 'FLAT');

function gradeScoreQuality(biasHit: boolean, expectedBias: ExpectedBias, firstMfe: number, firstMae: number, bestExtreme: number): ScoreQuality {
  if (expectedBias === 'NO_TRADE' || !biasHit) return 'NO_TRADE';
  if (bestExtreme < MIN_EDGE_TICKS) return 'NO_TRADE';
  const rr = firstMfe / Math.max(firstMae, 1);
  if (bestExtreme >= 10 && rr >= 2.5) return 'A';
  if (bestExtreme >= 6 && rr >= 1.3) return 'B';
  return 'C';
}

function compareSymbol(sym: string, expectedBias: ExpectedBias, expectedConfidence: SymbolComparison['expectedConfidence'], conflicts: string[], leg: LegAnalysis | undefined): SymbolComparison {
  if (!leg || !leg.hadData) {
    return {
      symbol: sym, expectedBias, expectedConfidence,
      expectedBiasHit: false, actualFirstLegDir: 'FLAT', actualSecondLegDir: 'FLAT',
      bestLeg: 'NO_EDGE', scoreQuality: 'NO_TRADE', executionQuality: 'failed',
      note: 'No tick data captured for this symbol — restart the tee or run a history backfill.',
    };
  }

  const expectedDir = biasToDir(expectedBias);
  const actualFirstLegDir = leg.actualFirstLegDir;
  const actualSecondLegDir = leg.secondLeg?.pushDir ?? 'FLAT';
  const firstMfe = leg.firstLeg?.mfeTicks ?? 0;
  const firstMae = leg.firstLeg?.maeTicks ?? 0;
  const secondExtreme = leg.secondLeg?.secondExtremeTicks ?? firstMfe;
  const bestExtreme = Math.max(firstMfe, secondExtreme);

  const expectedBiasHit = expectedBias === 'NO_TRADE'
    ? actualFirstLegDir === 'FLAT'              // correctly called "no edge"
    : expectedDir === actualFirstLegDir;

  let bestLeg: BestLeg;
  if (bestExtreme < MIN_EDGE_TICKS) bestLeg = 'NO_EDGE';
  else if (leg.secondLeg?.secondLegBetter && secondExtreme > firstMfe * 1.1) bestLeg = 'SECOND_LEG';
  else bestLeg = 'FIRST_LEG';

  const scoreQuality = gradeScoreQuality(expectedBiasHit, expectedBias, firstMfe, firstMae, bestExtreme);

  let executionQuality: ExecutionQuality;
  if (expectedBias === 'NO_TRADE') executionQuality = expectedBiasHit ? 'clean' : 'failed';
  else if (!expectedBiasHit) executionQuality = 'failed';
  else if (conflicts.length) executionQuality = 'conflicted';
  else if (bestLeg === 'SECOND_LEG' || (leg.firstLeg?.timeToFirstExtremeSec ?? 0) > SLOW_FIRST_SEC) executionQuality = 'late';
  else executionQuality = 'clean';

  const note = buildNote(sym, expectedBias, expectedBiasHit, actualFirstLegDir, bestLeg, bestExtreme, firstMae, executionQuality);
  return { symbol: sym, expectedBias, expectedConfidence, expectedBiasHit, actualFirstLegDir, actualSecondLegDir, bestLeg, scoreQuality, executionQuality, note };
}

function buildNote(sym: string, expectedBias: ExpectedBias, hit: boolean, actualDir: LegDir, bestLeg: BestLeg, bestExtreme: number, firstMae: number, exec: ExecutionQuality): string {
  if (expectedBias === 'NO_TRADE') {
    return hit
      ? `${sym}: scorecard called no edge and the tape stayed flat — correct stand-aside.`
      : `${sym}: scorecard called NO_TRADE but the tape moved ${actualDir} (~${bestExtreme}t) — a tradable move was missed.`;
  }
  if (!hit) return `${sym}: expected ${expectedBias} but the first leg went ${actualDir} — bias missed (${exec}).`;
  const legText = bestLeg === 'SECOND_LEG' ? 'the second leg paid best — don\'t chase the first spike'
    : bestLeg === 'NO_EDGE' ? 'the move was too small to trade'
    : 'the first impulse paid';
  return `${sym}: ${expectedBias} hit, ~${bestExtreme}t with ${firstMae}t heat — ${legText} (${exec}).`;
}

// Confirmation-market check: among the confirmation symbols that HAD data, did
// they agree with the best alert symbol's actual direction (single risk-on axis)?
// And which confirmation sources were MISSING — those cap confidence.
function checkConfirmation(expected: ReleaseExpected, legBySymbol: Record<string, LegAnalysis>, bestSym: string | undefined): ConfirmationCheck {
  const confSyms = Object.entries(expected.perSymbol).filter(([, e]) => e.role === 'CONFIRMATION').map(([s]) => s);
  const missingSources: string[] = [];
  const available: { sym: string; dir: LegDir }[] = [];
  for (const sym of confSyms) {
    const leg = legBySymbol[sym];
    if (!leg || !leg.hadData) missingSources.push(sym);
    else available.push({ sym, dir: leg.actualFirstLegDir });
  }

  const bestLeg = bestSym ? legBySymbol[bestSym] : undefined;
  const bestDir = bestLeg?.actualFirstLegDir;
  const agreeing: string[] = [];
  const conflicting: string[] = [];
  if (bestSym && bestDir && bestDir !== 'FLAT' && RISK_SIGN[bestSym] != null) {
    const impulseRiskOn = (bestDir === 'UP' ? 1 : -1) * RISK_SIGN[bestSym]; // +1 risk-on, -1 risk-off
    for (const { sym, dir } of available) {
      if (RISK_SIGN[sym] == null || dir === 'FLAT') continue; // ambiguous / flat → no vote
      const expectedDir: LegDir = impulseRiskOn * RISK_SIGN[sym] > 0 ? 'UP' : 'DOWN';
      (dir === expectedDir ? agreeing : conflicting).push(sym);
    }
  }

  let agreement: ConfirmationCheck['agreement'];
  if (agreeing.length && conflicting.length) agreement = 'MIXED';
  else if (agreeing.length) agreement = 'CONFIRM';
  else if (conflicting.length) agreement = 'CONFLICT';
  else agreement = 'UNKNOWN';

  const parts: string[] = [];
  if (agreement === 'CONFIRM') parts.push(`Confirmation agrees (${agreeing.join(', ')}).`);
  else if (agreement === 'CONFLICT') parts.push(`Confirmation conflicts (${conflicting.join(', ')}) — discount the read.`);
  else if (agreement === 'MIXED') parts.push(`Confirmation mixed (+${agreeing.join('/')} vs −${conflicting.join('/')}).`);
  else parts.push('No usable confirmation agreement (flat or no feed).');
  if (missingSources.length) parts.push(`Missing source(s) ${missingSources.join(', ')} — confidence capped (no Rithmic feed / tee gap).`);

  return { agreement, agreeing, conflicting, missingSources, note: parts.join(' ') };
}

// Rank alert symbols to pick the "best" when the scorecard didn't name one.
const QUALITY_RANK: Record<ScoreQuality, number> = { A: 3, B: 2, C: 1, NO_TRADE: 0 };

export function compareRelease(expected: ReleaseExpected, legBySymbol: Record<string, LegAnalysis>): ReleaseComparison {
  const alertSyms = Object.entries(expected.perSymbol).filter(([, e]) => e.role === 'ALERT').map(([s]) => s);
  const bySymbol: SymbolComparison[] = alertSyms.map(sym => {
    const e = expected.perSymbol[sym];
    return compareSymbol(sym, e.expectedBias, e.expectedConfidence, e.conflicts ?? [], legBySymbol[sym]);
  });

  // Best symbol: the scorecard's pick if it's an alert here, else the highest
  // realized score-quality (tie-break: the comparison list order).
  let bestSym = expected.best && alertSyms.includes(expected.best) ? expected.best : undefined;
  if (!bestSym && bySymbol.length) {
    bestSym = [...bySymbol].sort((a, b) => QUALITY_RANK[b.scoreQuality] - QUALITY_RANK[a.scoreQuality])[0].symbol;
  }

  const confirmation = checkConfirmation(expected, legBySymbol, bestSym);
  const best = bySymbol.find(c => c.symbol === bestSym);

  const overall = {
    expectedBiasHit: best?.expectedBiasHit ?? false,
    bestLeg: best?.bestLeg ?? 'NO_EDGE' as BestLeg,
    scoreQuality: best?.scoreQuality ?? 'NO_TRADE' as ScoreQuality,
    executionQuality: best?.executionQuality ?? 'failed' as ExecutionQuality,
    bestSymbol: bestSym,
    bestSymbolActualVsExpected: best
      ? `${best.symbol}: expected ${best.expectedBias} (${best.expectedConfidence}) · first leg ${best.actualFirstLegDir} · `
        + `bias ${best.expectedBiasHit ? 'HIT' : 'MISS'} · best leg ${best.bestLeg.replace('_', ' ')} · `
        + `quality ${best.scoreQuality} · ${best.executionQuality}`
      : undefined,
  };

  return { bySymbol, confirmation, overall };
}
