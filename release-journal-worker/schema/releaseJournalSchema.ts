// Canonical Release Journal schema (worker side).
//
// This is the contract the Release Journal Worker emits and the Trading
// Dashboard consumes. The dashboard keeps a JSDoc-typed mirror at
// src/utils/releaseJournalSchema.js — keep the two in sync when this changes.
//
// A completed "journal package" on disk is one folder:
//   journal-data/<YYYY-MM-DD>/<HHMM>_<region>_<release_slug>/
//     metadata.json   ← a ReleaseJournal (minus headlines/summary if split out)
//     headlines.json   ← ReleaseJournalHeadline[]
//     summary.md       ← human-readable ReleaseJournalSummary
//     assets/<SYMBOL>/*.png   ← screenshots referenced by ReleaseJournalScreenshot.path

export type ReleaseTemplate =
  | 'inflation_release'
  | 'labor_release'
  | 'pmi_release'
  | 'growth_release'
  | 'central_bank'
  | 'auction'
  | 'mixed_macro'
  | 'custom';

export type Importance = 'LOW' | 'MEDIUM' | 'HIGH' | 'A_PLUS';

export type AssetRole = 'PRIMARY' | 'SECONDARY' | 'CONFIRMATION' | 'SPREAD_LEG';

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D';

export type ReleaseJournal = {
  releaseId: string;
  releaseKey: string;          // matches a Playbook event_key (financialjuice headline)
  releaseName: string;
  region: string;
  scheduledTime: string;       // ISO8601
  actualReleaseTime?: string;  // ISO8601
  releaseTemplate: ReleaseTemplate;
  importance: Importance;
  holdingWindow: {
    startTime: string;
    endTime: string;
    durationSec: number;
  };
  numbers: {
    lines: Array<{
      name: string;
      actual?: string | number;
      forecast?: string | number;
      previous?: string | number;
      revision?: string | number;
      surprise?: number;
      weight?: number;
    }>;
    aggregateSurpriseScore?: number;
    interpretation?: string;
  };
  trackedAssets: ReleaseJournalAsset[];
  headlines: ReleaseJournalHeadline[];
  summary: ReleaseJournalSummary;
  dataQuality?: ReleaseDataQuality;
  postReleaseInterview?: ReleasePostReleaseInterview;
  executionReview?: ReleaseExecutionReview;
  // Phase 6: scorecard ⇄ behavior comparison. Present only when the release was
  // run with a macro_score templateId (the daily-prep scorecard for the event).
  templateId?: string;
  expected?: ReleaseExpected;           // what the scorecard expected (per symbol)
  comparison?: ReleaseComparison;       // expected vs actual (bias-hit, best-leg, quality)
  suggestedAdjustments?: SuggestedAdjustment[]; // advisory tweaks for the next release
  createdAt: string;
  updatedAt: string;
};

export type ReleaseJournalAsset = {
  symbol: string;
  contract?: string;           // resolved futures contract month, e.g. NQU6
  role: AssetRole;
  source?: 'RITHMIC' | 'QUANTOWER' | 'IG_CFD' | 'MANUAL' | 'UNKNOWN';
  direction?: 'LONG' | 'SHORT' | 'MIXED' | 'NONE';
  entryModels?: {
    immediate?: { timestamp: string; price: number };
    confirmed?: { timestamp: string; price: number };
  };
  peaks?: {
    peak1?: ReleasePeak;
    peak2?: ReleasePeak;
    retrace1?: ReleasePeak;
  };
  excursions?: {
    maeToPeak1Ticks?: number;
    maeBetweenPeaksTicks?: number;
    mfeToPeak1Ticks?: number;
    mfeToPeak2Ticks?: number;
    totalRangeTicks?: number;
  };
  rr?: {
    peak1Tight?: number;
    peak1Standard?: number;
    peak2Standard?: number;
    peak2Wide?: number;
  };
  classification?: {
    directionalQuality?: 'EXCELLENT' | 'GOOD' | 'MIXED' | 'POOR';
    maeQuality?: 'LOW_MAE' | 'MODERATE_MAE' | 'HIGH_MAE' | 'EXTREME_MAE';
    rrQuality?: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR';
    tradabilityGrade?: Grade;
    tradabilityScore?: number;
  };
  // Phase 6 per-asset enrichment (present only on a templateId-driven release).
  expected?: ExpectedSymbol;   // the scorecard's expected bias/confidence for this symbol
  legAnalysis?: LegAnalysis;   // timed reads + first/second leg behavior
  comparison?: SymbolComparison; // expected vs actual for this symbol
  screenshots: ReleaseJournalScreenshot[];
  notes?: string;
};

export type ReleasePeak = {
  timestamp: string;
  price: number;
  ticksFromEntry?: number;
  secondsFromRelease?: number;
  notes?: string;
};

export type ReleaseJournalScreenshot = {
  type:
    | 'PRE_RELEASE'
    | 'RELEASE_NUMBERS'
    | 'RELEASE_IMPULSE'
    | 'PEAK_1'
    | 'MAE_BETWEEN_PEAKS'
    | 'PEAK_2'
    | 'HOLDING_END'
    | 'COMPOSITE'
    | 'OTHER';
  timestamp: string;
  path: string;
  notes?: string;
};

export type ReleaseJournalHeadline = {
  timestamp: string;
  text: string;
  source?: 'FINANCIALJUICE' | 'MANUAL' | 'OTHER';
  relevance: 'HIGH' | 'MEDIUM' | 'LOW';
  category?:
    | 'release_related'
    | 'fed_central_bank'
    | 'geopolitical'
    | 'inflation'
    | 'growth'
    | 'labor'
    | 'risk_sentiment'
    | 'other';
  possibleNewInformationEvent: boolean;
  likelyMarketEffect?:
    | 'reinforced_existing_move'
    | 'reversed_move'
    | 'introduced_conflicting_information'
    | 'no_visible_effect'
    | 'unknown';
};

export type ReleaseJournalSummary = {
  bestAsset?: string;
  secondBestAsset?: string;
  worstAsset?: string;
  bestHoldingStyle?:
    | 'SCALP_TO_PEAK_1'
    | 'HOLD_TO_PEAK_2'
    | 'CONFIRMATION_ENTRY_ONLY'
    | 'AVOID_HIGH_MAE'
    | 'NO_TRADE';
  keyHeadlineInterference?: boolean;
  finalTakeaway: string;
  learningNote?: string;
};

export type ReleaseExecutionReview = {
  summary?: string;
  trades: Array<{
    time?: string;
    symbol?: string;
    ticker?: string;
    side?: 'Long' | 'Short' | string;
    contracts?: number;
    entry?: number;
    exit?: number;
    duration_sec?: number;
    pnl?: number;
    fees?: number;
    account_id?: string;
    linked_trade_id?: string;
    release_match_confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | string;
    account_management_reason?: string;
    trade_type?: string;
    post_trade_state?: string;
    review?: string;
  }>;
  mistakes?: string[];
  corrections?: string[];
};

export type ReleaseDataQuality = {
  status: 'OK' | 'PARTIAL' | 'DATA_GAP';
  requiredSymbols?: string[];
  rowCounts?: Record<string, number>;
  missingSymbols?: string[];
  contracts?: Record<string, string>;
  aggregation?: 'SECOND1' | 'TICK' | string;
  backfill?: {
    requested?: boolean;
    ok?: boolean;
    rows?: number;
    file?: string;
    error?: string;
    missingSymbols?: string[];
  };
  notes?: string[];
};

export type ReleasePostReleaseInterview = {
  planVsActual?: string;
  executionIssues?: string;
  riskGuardContext?: string;
  accountManagement?: string;
  mistakes?: string;
  corrections?: string;
  nextReleaseChanges?: string;
  reviewedAt?: string;
};

// ── Phase 6: scorecard ⇄ behavior comparison ─────────────────────────────────
// The Release Journal records what HAPPENED (Phases 1-5). The macro_score system
// records what was EXPECTED (per-instrument bias/confidence). These types close
// the loop: register the expected behavior, compare it to the actual first/second
// leg, and emit advisory adjustments for the next release. All produced by the
// worker's expectedBehavior.ts / legAnalyzer.ts / behaviorComparison.ts /
// adjustmentEngine.ts and mirrored in the dashboard's JSDoc schema.

export type ExpectedBias = 'LONG' | 'SHORT' | 'NO_TRADE';
export type ExpectedConfidence = 'A' | 'B' | 'C' | 'NO_TRADE';
export type LegDir = 'UP' | 'DOWN' | 'FLAT';

// One instrument's expected behavior, parsed from the scorecard (alert symbols
// from the *_score.json scores[]; confirmation symbols from daily_prep).
export type ExpectedSymbol = {
  role: 'ALERT' | 'CONFIRMATION';
  expectedBias: ExpectedBias;
  expectedConfidence: ExpectedConfidence;
  score?: number;            // 0-100 scorecard score (alert symbols)
  narrative?: string;
  reasons?: string[];
  conflicts?: string[];
  missingFields?: string[];
};

// The whole expected-behavior block for a release (one templateId).
export type ReleaseExpected = {
  templateId: string;
  templateLabel?: string;
  releaseTimeET?: string;
  title?: string;
  regimeContext?: string;     // activeCorrelationRegime from daily_prep
  notes?: string[];           // strategic-plan notes from the daily_prep event
  perSymbol: Record<string, ExpectedSymbol>;
  best?: string;              // best alert symbol per the scorecard
  secondary?: string;
  warnings?: string[];
};

// A timed directional read at N seconds after T0 (release). `ticks` is the signed
// price move in ticks (+ = up), `dir` is UP/DOWN/FLAT.
export type TimedRead = { sec: number; ticks: number; dir: LegDir };

// The registered behavior of one instrument around the release.
export type LegAnalysis = {
  symbol: string;
  direction?: 'LONG' | 'SHORT' | 'NONE'; // scorecard bias used to measure (NONE = agnostic)
  hadData: boolean;
  snapshots: number;
  t0Price?: number;
  actualFirstLegDir: LegDir;   // dominant raw first-move direction (direction-agnostic)
  timedReads: TimedRead[];     // raw signed reads at [5,15,30,60]s from T0
  // True best/worst over the whole window in the measure direction — the numbers a
  // 3-30 min discretionary hold cares about (not the structured peak1/peak2).
  peakFavorableTicks?: number; // max favorable excursion (measure dir) over the window
  peakFavorableSec?: number;   // seconds after release of that peak
  maeToPeakTicks?: number;     // worst adverse excursion BEFORE the peak (pre-payoff heat)
  firstLeg?: {
    measureDir: 'LONG' | 'SHORT';
    mfeTicks: number;          // favorable excursion in measureDir to first peak
    maeTicks: number;          // adverse excursion in measureDir before first peak
    timeToFirstExtremeSec: number;
  };
  secondLeg?: {
    retraceTicks: number;          // pullback depth after the first peak
    pushDir: LegDir;               // direction of the second push
    secondExtremeTicks: number;    // favorable excursion in measureDir to second peak
    timeToSecondExtremeSec: number;
    continuation: boolean;         // extended past the first peak (vs reversed)
    secondLegBetter: boolean;      // second extreme beat the first
  };
};

export type BestLeg = 'FIRST_LEG' | 'SECOND_LEG' | 'NO_EDGE';
export type ScoreQuality = 'A' | 'B' | 'C' | 'NO_TRADE';
export type ExecutionQuality = 'clean' | 'conflicted' | 'late' | 'failed';

// Expected vs actual for one alert symbol.
export type SymbolComparison = {
  symbol: string;
  expectedBias: ExpectedBias;
  expectedConfidence: ExpectedConfidence;
  expectedBiasHit: boolean;
  actualFirstLegDir: LegDir;
  actualSecondLegDir: LegDir;
  bestLeg: BestLeg;
  scoreQuality: ScoreQuality;
  executionQuality: ExecutionQuality;
  note: string;
};

// Did the confirmation markets agree, and were any confirmation sources missing
// (no tick feed) — which caps confidence?
export type ConfirmationCheck = {
  agreement: 'CONFIRM' | 'CONFLICT' | 'MIXED' | 'UNKNOWN';
  agreeing: string[];
  conflicting: string[];
  missingSources: string[];   // confirmation symbols with no usable tick data
  note: string;
};

export type ReleaseComparison = {
  bySymbol: SymbolComparison[];
  confirmation: ConfirmationCheck;
  overall: {
    expectedBiasHit: boolean;
    bestLeg: BestLeg;
    scoreQuality: ScoreQuality;
    executionQuality: ExecutionQuality;
    bestSymbol?: string;
    bestSymbolActualVsExpected?: string;
  };
};

export type AdjustmentScope = 'template' | 'daily_prep' | 'holding_style';

// One advisory tweak for the scorecard/plan. OUTPUT-ONLY — written to
// macro_score/adjustments/<date>_<templateId>.json for the prep agent to review.
// The journal never edits the templates or daily-prep itself.
export type SuggestedAdjustment = {
  scope: AdjustmentScope;
  target: string;             // templateId / symbol / dotted template path
  change?: { field: string; from: unknown; to: unknown };
  note?: string;
  rationale: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

// The adjustments review file written to macro_score/adjustments/.
export type ReleaseAdjustmentsFile = {
  date: string;
  templateId: string;
  generatedAt: string;
  summary: string;
  suggestions: SuggestedAdjustment[];
};
