// tradabilityGrader — the Phase 5 review engine.
//
// Pure & deterministic: no I/O, no feed. Given the Phase 2 metrics already on a
// ReleaseJournalAsset (peaks / excursions / rr) plus the release-level headline
// context, it grades each tradeable asset and writes the `classification` block
// (directionalQuality / maeQuality / rrQuality / tradabilityGrade / tradabilityScore)
// the dashboard's Release Review and Playbook rollup already read. It also builds
// the ranked, narrative `summary` (best/second/worst, holding style, takeaway,
// learning note) — so every imported package auto-feeds the Playbook EventCard.
//
// Score model (README "Tradability grading"):
//   tradability_score =
//     0.30 * directional_quality + 0.25 * rr + 0.20 * mae +
//     0.15 * continuation + 0.10 * headline_stability
// Each sub-score is normalized to [0,1] from instrument-independent ratios, so a
// 50-tick NQ move and a 5-tick GC move grade on the same scale. The final score
// is reported 0–100; the grade is a threshold on it.

import type { ReleaseJournalAsset, ReleaseJournalSummary, Grade } from '../schema/releaseJournalSchema';

type Classification = NonNullable<ReleaseJournalAsset['classification']>;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export const GRADE_WEIGHTS = {
  directional: 0.30, rr: 0.25, mae: 0.20, continuation: 0.15, headlineStability: 0.10,
} as const;

// Release-level context shared by every asset in the package.
export type GradeContext = {
  newInfoHeadlineCount?: number;        // # of HIGH new-information headlines in window
  keyHeadlineInterference?: boolean;
};

// The sub-scores + the raw ratios behind them — kept for the summary (ranking,
// holding style, narrative) so we never recompute.
export type ScoreParts = {
  directional: number; rr: number; mae: number; continuation: number; headlineStability: number;
  total: number;            // 0..1 (×100 → classification.tradabilityScore)
  favShare: number; bestRR: number; maeRatio: number;
  hasContinuation: boolean;
};

export type GradedAsset = {
  asset: ReleaseJournalAsset;
  classification: Classification;
  parts: ScoreParts;
};

function gradeFromScore(score100: number): Grade {
  if (score100 >= 85) return 'A+';
  if (score100 >= 72) return 'A';
  if (score100 >= 58) return 'B';
  if (score100 >= 42) return 'C';
  return 'D';
}

function directionalQualityLabel(s: number): Classification['directionalQuality'] {
  return s >= 0.75 ? 'EXCELLENT' : s >= 0.5 ? 'GOOD' : s >= 0.25 ? 'MIXED' : 'POOR';
}
function maeQualityLabel(ratio: number): Classification['maeQuality'] {
  return ratio < 0.25 ? 'LOW_MAE' : ratio < 0.6 ? 'MODERATE_MAE' : ratio < 1.0 ? 'HIGH_MAE' : 'EXTREME_MAE';
}
function rrQualityLabel(bestRR: number): Classification['rrQuality'] {
  return bestRR >= 2.5 ? 'EXCELLENT' : bestRR >= 1.5 ? 'GOOD' : bestRR >= 1.0 ? 'ACCEPTABLE' : 'POOR';
}

// Grade one asset. Returns null for non-tradeable (NONE/MIXED) assets or assets
// with no recorded excursions — those carry no classification.
export function gradeAsset(asset: ReleaseJournalAsset, ctx: GradeContext = {}): GradedAsset | null {
  const dir = asset.direction;
  if (dir !== 'LONG' && dir !== 'SHORT') return null;
  const ex = asset.excursions;
  if (!ex || ex.mfeToPeak1Ticks == null) return null;

  const mfe1 = Math.max(0, ex.mfeToPeak1Ticks ?? asset.peaks?.peak1?.ticksFromEntry ?? 0);
  const mfe2 = Math.max(mfe1, ex.mfeToPeak2Ticks ?? asset.peaks?.peak2?.ticksFromEntry ?? mfe1);
  const mae1 = Math.max(0, ex.maeToPeak1Ticks ?? 0);
  const maeBetween = Math.max(0, ex.maeBetweenPeaksTicks ?? 0);
  const range = Math.max(ex.totalRangeTicks ?? (mfe2 + mae1), 1);
  const maxMfe = Math.max(mfe1, mfe2);
  const bestRR = Math.max(asset.rr?.peak1Standard ?? 0, asset.rr?.peak2Standard ?? 0);

  // 1. Directional quality — how much of the realized range went your way.
  //    range≈mfe → ~1 (clean); symmetric whipsaw → ~0.5; reversal-dominant → low.
  const favShare = clamp01(maxMfe / range);
  const directional = clamp01((favShare - 0.45) / (0.85 - 0.45));

  // 2. R/R — best standard-stop reward:risk, saturating at 3.0.
  const rr = clamp01(bestRR / 3);

  // 3. MAE — adverse heat relative to the favorable run; less heat → higher.
  const maeRatio = mae1 / Math.max(maxMfe, 1);
  const mae = clamp01(1 - maeRatio);

  // 4. Continuation — did a second leg extend past peak1, net of the retrace?
  const extension = mfe1 > 0 ? mfe2 / mfe1 - 1 : 0;     // peak2 = 2×peak1 → 1.0
  const retraceFrac = mfe1 > 0 ? maeBetween / mfe1 : 0;
  const continuation = clamp01(extension - 0.3 * retraceFrac);
  const hasContinuation = mfe2 > mfe1 * 1.05;

  // 5. Headline stability — new-information headlines during the window erode it.
  const newInfo = ctx.newInfoHeadlineCount ?? (ctx.keyHeadlineInterference ? 1 : 0);
  const headlineStability = clamp01(1 - 0.5 * newInfo);

  const total =
    GRADE_WEIGHTS.directional * directional +
    GRADE_WEIGHTS.rr * rr +
    GRADE_WEIGHTS.mae * mae +
    GRADE_WEIGHTS.continuation * continuation +
    GRADE_WEIGHTS.headlineStability * headlineStability;

  const score100 = Math.round(total * 100);
  const classification: Classification = {
    directionalQuality: directionalQualityLabel(directional),
    maeQuality: maeQualityLabel(maeRatio),
    rrQuality: rrQualityLabel(bestRR),
    tradabilityGrade: gradeFromScore(score100),
    tradabilityScore: score100,
  };
  return {
    asset,
    classification,
    parts: { directional, rr, mae, continuation, headlineStability, total, favShare, bestRR, maeRatio, hasContinuation },
  };
}

const tag = (a: ReleaseJournalAsset) => `${a.symbol} (${(a.direction ?? '').toLowerCase()})`;
const fmtRR = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');

function holdingStyle(best: GradedAsset | undefined): ReleaseJournalSummary['bestHoldingStyle'] {
  if (!best || best.classification.tradabilityScore! < 42) return 'NO_TRADE';
  if (best.classification.maeQuality === 'EXTREME_MAE') return 'AVOID_HIGH_MAE';
  if (best.parts.continuation >= 0.4 && best.parts.hasContinuation) return 'HOLD_TO_PEAK_2';
  if (best.classification.maeQuality === 'HIGH_MAE') return 'CONFIRMATION_ENTRY_ONLY';
  return 'SCALP_TO_PEAK_1';
}

// Build the ranked, narrative summary from the graded assets + headline context.
// `graded` is already gradeAsset() output for every tradeable asset; non-tradeable
// assets are excluded (they have no grade to rank).
export function buildReleaseSummary(graded: GradedAsset[], ctx: GradeContext = {}): ReleaseJournalSummary {
  const ranked = [...graded].sort((a, b) =>
    (b.classification.tradabilityScore ?? 0) - (a.classification.tradabilityScore ?? 0));
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const style = holdingStyle(best);
  const newInfo = ctx.newInfoHeadlineCount ?? (ctx.keyHeadlineInterference ? 1 : 0);

  if (!best) {
    return {
      bestAsset: '', secondBestAsset: '', worstAsset: '',
      bestHoldingStyle: 'NO_TRADE',
      keyHeadlineInterference: !!ctx.keyHeadlineInterference,
      finalTakeaway: 'No tradeable asset was tracked for this release — nothing to grade.',
      learningNote: '',
    };
  }

  const bg = best.classification;
  const styleText: Record<NonNullable<ReleaseJournalSummary['bestHoldingStyle']>, string> = {
    SCALP_TO_PEAK_1: 'scalp to peak 1 — the second leg did not extend',
    HOLD_TO_PEAK_2: 'hold to peak 2 — the move kept extending after the first pullback',
    CONFIRMATION_ENTRY_ONLY: 'enter on confirmation only — the initial heat was wide',
    AVOID_HIGH_MAE: 'avoid / size down — the adverse excursion was extreme',
    NO_TRADE: 'no trade — quality too low to justify risk',
  };

  const takeaway =
    `${tag(best.asset)} graded ${bg.tradabilityGrade} (${bg.tradabilityScore}/100): `
    + `${(bg.directionalQuality ?? '').toLowerCase()} direction, ${fmtRR(best.parts.bestRR)} R/R, `
    + `${(bg.maeQuality ?? '').replace(/_/g, ' ').toLowerCase()}. Best play: ${styleText[style!]}.`
    + (ranked[1] ? ` ${tag(ranked[1].asset)} graded ${ranked[1].classification.tradabilityGrade}.` : '')
    + (newInfo > 0 ? ` Headline interference (${newInfo} new-info) dented stability — discount the read.` : '');

  // Surface the single most actionable lesson.
  let learningNote = '';
  if (newInfo > 0) {
    learningNote = `A new-information headline hit during the window — the price reaction was not purely the release; confirm before trusting the move.`;
  } else if (style === 'AVOID_HIGH_MAE') {
    learningNote = `${best.asset.symbol} ran heavy adverse heat before paying — entry timing or size was the problem, not direction.`;
  } else if (style === 'SCALP_TO_PEAK_1') {
    learningNote = `${best.asset.symbol}'s edge was the first impulse; the continuation faded — bank peak 1 rather than holding for peak 2.`;
  } else if (style === 'CONFIRMATION_ENTRY_ONLY') {
    learningNote = `${best.asset.symbol} paid, but only after wide initial heat — wait for the pullback/confirmation entry.`;
  } else if (style === 'HOLD_TO_PEAK_2') {
    learningNote = `${best.asset.symbol} rewarded patience — the runner to peak 2 was where the size lived.`;
  }

  return {
    bestAsset: tag(best.asset),
    secondBestAsset: ranked[1] ? tag(ranked[1].asset) : '',
    worstAsset: worst && worst !== best ? tag(worst.asset) : '',
    bestHoldingStyle: style,
    keyHeadlineInterference: !!ctx.keyHeadlineInterference,
    finalTakeaway: takeaway,
    learningNote,
  };
}

// Convenience: grade every asset in place (writes `classification`) and return the
// ranked summary. The builder calls this once trackedAssets + headlines are assembled.
export function gradeRelease(assets: ReleaseJournalAsset[], ctx: GradeContext = {}): ReleaseJournalSummary {
  const graded: GradedAsset[] = [];
  for (const a of assets) {
    const g = gradeAsset(a, ctx);
    if (g) { a.classification = g.classification; graded.push(g); }
  }
  return buildReleaseSummary(graded, ctx);
}
