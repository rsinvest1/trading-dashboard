// adjustmentEngine — turns the expected-vs-actual comparison into advisory tweaks
// for the NEXT release (Phase 6b). OUTPUT-ONLY: writeAdjustments() drops a review
// JSON in macro_score/adjustments/ for the prep agent to read and apply. This
// module NEVER edits the templates or daily-prep — the scorecard stays the prep
// agent's source of truth; the journal only suggests.
//
// Heuristics (each is one release's worth of evidence — confidence is calibrated
// low/medium accordingly):
//   • bias missed            → review the contribution sign/weight, or make the
//                               instrument confirmation-only next time
//   • best edge = 2nd leg    → wait for the post-spike pullback, don't chase
//   • heavy pre-pay heat     → enter on confirmation / size down
//   • conflict fired, clean  → consider relaxing the conflict's confidence cap
//   • missing confirm source → wire up the data (or drop it) so confidence isn't capped

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Template, ConflictRule } from './expectedBehavior.ts';
import type {
  ReleaseComparison, ReleaseExpected, LegAnalysis, SuggestedAdjustment, ReleaseAdjustmentsFile,
} from '../schema/releaseJournalSchema';

export type AdjustmentOpts = {
  legBySymbol?: Record<string, LegAnalysis>;
  template?: Template | null;
};

function conflictFor(template: Template | null | undefined, sym: string): ConflictRule | undefined {
  return (template?.conflictRules ?? []).find(r => (r.affects ?? []).includes(sym));
}

export function suggestAdjustments(comparison: ReleaseComparison, expected: ReleaseExpected, opts: AdjustmentOpts = {}): SuggestedAdjustment[] {
  const out: SuggestedAdjustment[] = [];
  const templateId = expected.templateId;
  const legs = opts.legBySymbol ?? {};

  for (const c of comparison.bySymbol) {
    const exp = expected.perSymbol[c.symbol];
    const leg = legs[c.symbol];

    // 1. Bias missed — the scorecard called a direction and the first leg went the
    //    other way. Review the contribution that drives this instrument, or demote
    //    it to confirmation-only.
    if (c.expectedBias !== 'NO_TRADE' && !c.expectedBiasHit && c.actualFirstLegDir !== 'FLAT') {
      out.push({
        scope: 'template',
        target: `${templateId}.contributions.${c.symbol}`,
        rationale: `Expected ${c.expectedBias} for ${c.symbol} but the first leg went ${c.actualFirstLegDir}. `
          + `Review the contribution sign/weight for ${c.symbol}, or set it confirmation-only until it confirms.`,
        confidence: c.symbol === expected.best ? 'HIGH' : 'MEDIUM',
      });
    }

    // 2. NO_TRADE under-call — scorecard said no edge but a real move developed.
    if (c.expectedBias === 'NO_TRADE' && !c.expectedBiasHit && c.bestLeg !== 'NO_EDGE') {
      out.push({
        scope: 'template',
        target: `${templateId}.narratives.${c.symbol}`,
        rationale: `${c.symbol} was scored NO_TRADE but produced a tradable ${c.actualFirstLegDir} move. `
          + `Consider giving ${c.symbol} a directional contribution for this release type.`,
        confidence: 'MEDIUM',
      });
    }

    // 3. Heavy pre-pay heat — bias hit but the first leg carried a lot of adverse
    //    excursion before paying → enter on confirmation / size down.
    if (c.expectedBiasHit && leg?.firstLeg) {
      const { mfeTicks, maeTicks } = leg.firstLeg;
      if (mfeTicks >= 4 && maeTicks >= 0.6 * mfeTicks) {
        out.push({
          scope: 'daily_prep',
          target: c.symbol,
          rationale: `${c.symbol} ${c.expectedBias} paid (~${mfeTicks}t) but only after ${maeTicks}t of adverse heat. `
            + `Plan note: enter on the confirmation/pullback and size down on the first impulse.`,
          confidence: 'MEDIUM',
        });
      }
    }

    // 4. Conflict fired but the move was clean — the scorecard capped confidence on
    //    a conflict rule, yet the instrument moved cleanly in the expected direction.
    if (c.expectedBiasHit && (exp?.conflicts?.length ?? 0) > 0 && (c.scoreQuality === 'A' || c.scoreQuality === 'B')) {
      const rule = conflictFor(opts.template, c.symbol);
      out.push({
        scope: 'template',
        target: `${templateId}.conflictRules${rule?.id ? `.${rule.id}` : ''}`,
        rationale: `Conflict rule${rule?.id ? ` "${rule.id}"` : ''} capped ${c.symbol} to ${rule?.maxConfidence ?? 'a lower confidence'}, `
          + `but ${c.symbol} moved cleanly (${c.scoreQuality}). Consider relaxing the cap for this pattern.`,
        confidence: 'LOW',
      });
    }
  }

  // 5. Best edge was the second leg — codify "don't chase the first spike".
  if (comparison.overall.bestLeg === 'SECOND_LEG' && comparison.overall.bestSymbol) {
    out.push({
      scope: 'holding_style',
      target: comparison.overall.bestSymbol,
      rationale: `Best edge on ${comparison.overall.bestSymbol} was the SECOND leg. `
        + `Holding-style note: wait for the post-spike pullback / second entry rather than chasing the first impulse.`,
      confidence: 'MEDIUM',
    });
  }

  // 6. Missing confirmation source — confidence was capped because a confirmation
  //    market had no usable tick data.
  if (comparison.confirmation.missingSources.length) {
    out.push({
      scope: 'daily_prep',
      target: comparison.confirmation.missingSources.join(','),
      rationale: `No tick feed for confirmation symbol(s) ${comparison.confirmation.missingSources.join(', ')} — confidence was capped. `
        + `Wire up a data source (or drop them from confirmationSymbols if they aren't actionable).`,
      confidence: 'HIGH',
    });
  }

  return out;
}

// One-line human summary of the comparison for the adjustments file header.
export function summarizeComparison(comparison: ReleaseComparison): string {
  const o = comparison.overall;
  const hits = comparison.bySymbol.filter(c => c.expectedBias !== 'NO_TRADE');
  const hitN = hits.filter(c => c.expectedBiasHit).length;
  return `Best ${o.bestSymbol ?? '—'}: bias ${o.expectedBiasHit ? 'HIT' : 'MISS'}, ${o.scoreQuality}, ${o.executionQuality}, best leg ${o.bestLeg.replace('_', ' ')}. `
    + `Alert bias hits ${hitN}/${hits.length}. ${comparison.confirmation.note}`;
}

// Write the advisory review file. OUTPUT-ONLY → macro_score/adjustments/<date>_<templateId>.json.
export async function writeAdjustments(macroScoreRoot: string, date: string, templateId: string, suggestions: SuggestedAdjustment[], summary: string): Promise<string> {
  const dir = join(macroScoreRoot, 'adjustments');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${date}_${templateId}.json`);
  const payload: ReleaseAdjustmentsFile = {
    date, templateId, generatedAt: new Date().toISOString(), summary, suggestions,
  };
  await writeFile(file, JSON.stringify(payload, null, 2));
  return file;
}
