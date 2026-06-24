import { useEffect, useState } from 'react';
import {
  X, FileText, BarChart3, Newspaper, Image as ImageIcon, Flag, AlertTriangle,
  Target, GitCompare, Lightbulb
} from 'lucide-react';
import {
  gradeTone, relevanceTone, importanceTone, normalizeReleaseJournal
} from '../utils/releaseJournalSchema';
import { useStore } from '../store/useStore';

// ── Small shared bits ───────────────────────────────────────────────────────
const TONE = {
  green:  'bg-accent-green/10 text-accent-green border-accent-green/30',
  yellow: 'bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30',
  red:    'bg-accent-red/10 text-accent-red border-accent-red/30',
  blue:   'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
  muted:  'bg-bg-hover text-text-secondary border-bg-border'
};

function Badge({ tone = 'muted', children, className = '', mono = false }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] rounded border ${TONE[tone]} ${mono ? 'font-mono' : ''} ${className}`}>
      {children}
    </span>
  );
}

// Times in the packages are ISO/UTC; the trader works on an ET clock.
function fmtET(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }) + ' ET';
}
function fmtDateET(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}
const fmtSec = (s) => (s == null ? '—' : `+${s}s`);
const fmtTicks = (t) => (t == null ? '—' : `${t}t`);
const fmtRR = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const fmtNum = (v) => (v === '' || v == null ? '—' : v);
const fmtMoney = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : '—');
function fmtTPlus(seconds) {
  if (!Number.isFinite(seconds)) return 'T+—';
  const s = Math.max(0, Math.round(seconds));
  return `T+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtPeak(p) {
  if (!p?.timestamp) return '—';
  const bits = [fmtET(p.timestamp)];
  if (Number.isFinite(p.secondsFromRelease)) bits.push(fmtTPlus(p.secondsFromRelease));
  if (p.ticksFromEntry != null) bits.push(fmtTicks(p.ticksFromEntry));
  return bits.join(' · ');
}

const directionTone = (d) =>
  d === 'LONG' ? 'green' : d === 'SHORT' ? 'red' : d === 'MIXED' ? 'yellow' : 'muted';

// Phase 6 tones
const biasTone = (b) => (b === 'LONG' ? 'green' : b === 'SHORT' ? 'red' : 'muted');
const legDirTone = (d) => (d === 'UP' ? 'green' : d === 'DOWN' ? 'red' : 'muted');
const hitTone = (b) => (b ? 'green' : 'red');
const qualityTone = (q) => (q === 'A' ? 'green' : q === 'B' ? 'yellow' : q === 'C' ? 'red' : 'muted');
const execTone = (e) => (e === 'clean' ? 'green' : e === 'failed' ? 'red' : 'yellow');
const confTone = (c) => (c === 'HIGH' ? 'red' : c === 'MEDIUM' ? 'yellow' : 'muted');
const agreementTone = (a) => (a === 'CONFIRM' ? 'green' : a === 'CONFLICT' ? 'red' : a === 'MIXED' ? 'yellow' : 'muted');
const BEST_LEG_LABEL = { FIRST_LEG: '1st leg', SECOND_LEG: '2nd leg', NO_EDGE: 'no edge' };
const SCOPE_LABEL = { template: 'Template', daily_prep: 'Daily prep', holding_style: 'Holding style' };

const SCREENSHOT_LABEL = {
  PRE_RELEASE: 'Pre-release', RELEASE_NUMBERS: 'Numbers', RELEASE_IMPULSE: 'Impulse',
  PEAK_1: 'Peak 1', MAE_BETWEEN_PEAKS: 'MAE between', PEAK_2: 'Peak 2',
  HOLDING_END: 'Holding end', COMPOSITE: 'Composite', OTHER: 'Other'
};

function Section({ icon: Icon, title, children, right }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="flex items-center gap-2 text-sm uppercase tracking-wider text-text-secondary">
          {Icon && <Icon size={14} />} {title}
        </h3>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Asset ranking ───────────────────────────────────────────────────────────
function AssetTable({ assets }) {
  // Best-first: rank by tradabilityScore, unscored assets sink.
  const ranked = [...assets].sort((a, b) =>
    (b.classification?.tradabilityScore ?? -1) - (a.classification?.tradabilityScore ?? -1));
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-text-muted text-left border-b border-bg-border">
            <th className="px-2 py-2 font-medium">Asset</th>
            <th className="px-2 py-2 font-medium">Role</th>
            <th className="px-2 py-2 font-medium">Dir</th>
            <th className="px-2 py-2 font-medium text-right">P1 ticks</th>
            <th className="px-2 py-2 font-medium text-right">→P1</th>
            <th className="px-2 py-2 font-medium text-right">MAE→P1</th>
            <th className="px-2 py-2 font-medium text-right">P2 ticks</th>
            <th className="px-2 py-2 font-medium text-right">MAE P1–P2</th>
            <th className="px-2 py-2 font-medium text-right">R/R P1·P2</th>
            <th className="px-2 py-2 font-medium">Grade</th>
            <th className="px-2 py-2 font-medium font-sans">Notes</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((a, i) => (
            <tr key={`${a.symbol}-${i}`} className="border-b border-bg-border/50 last:border-0 align-top">
              <td className="px-2 py-2 text-text-primary font-semibold">{a.symbol}</td>
              <td className="px-2 py-2 text-text-secondary">{a.role}</td>
              <td className="px-2 py-2"><Badge tone={directionTone(a.direction)}>{a.direction || 'NONE'}</Badge></td>
              <td className="px-2 py-2 text-right text-text-primary">{fmtTicks(a.peaks?.peak1?.ticksFromEntry)}</td>
              <td className="px-2 py-2 text-right text-text-muted">{fmtSec(a.peaks?.peak1?.secondsFromRelease)}</td>
              <td className="px-2 py-2 text-right text-text-secondary">{fmtTicks(a.excursions?.maeToPeak1Ticks)}</td>
              <td className="px-2 py-2 text-right text-text-primary">{fmtTicks(a.peaks?.peak2?.ticksFromEntry)}</td>
              <td className="px-2 py-2 text-right text-text-secondary">{fmtTicks(a.excursions?.maeBetweenPeaksTicks)}</td>
              <td className="px-2 py-2 text-right text-text-primary">
                {fmtRR(a.rr?.peak1Standard)}·{fmtRR(a.rr?.peak2Standard)}
              </td>
              <td className="px-2 py-2">
                {a.classification?.tradabilityGrade
                  ? <Badge tone={gradeTone(a.classification.tradabilityGrade)} mono>{a.classification.tradabilityGrade}</Badge>
                  : <span className="text-text-muted">—</span>}
              </td>
              <td className="px-2 py-2 font-sans text-text-muted max-w-[16rem]">
                <span className="line-clamp-2">{a.notes || ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Screenshot timeline (placeholders — Phase 1 has no captured images) ──────
function ScreenshotCard({ shot }) {
  return (
    <div className="shrink-0 w-32">
      <div className="h-20 rounded border border-dashed border-bg-border bg-bg-hover/50 flex flex-col items-center justify-center text-text-muted gap-1">
        <ImageIcon size={16} />
        <span className="text-[10px]">placeholder</span>
      </div>
      <div className="mt-1">
        <div className="text-[10px] font-medium text-text-secondary">{SCREENSHOT_LABEL[shot.type] || shot.type}</div>
        <div className="text-[9px] font-mono text-text-muted">{fmtET(shot.timestamp)}</div>
        {shot.notes && <div className="text-[9px] text-text-muted line-clamp-2 mt-0.5">{shot.notes}</div>}
      </div>
    </div>
  );
}

function ScreenshotTimeline({ assets }) {
  const withShots = assets.filter(a => a.screenshots?.length);
  if (!withShots.length) {
    return <div className="card p-4 text-xs text-text-muted">No screenshots in this package yet (added in Phase 3).</div>;
  }
  return (
    <div className="space-y-3">
      {withShots.map((a, i) => (
        <div key={`${a.symbol}-${i}`} className="card p-3">
          <div className="text-xs font-semibold text-text-primary mb-2 font-mono">{a.symbol}</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {a.screenshots.map((s, j) => <ScreenshotCard key={j} shot={s} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Headline timeline ───────────────────────────────────────────────────────
function HeadlineTimeline({ headlines }) {
  if (!headlines.length) {
    return <div className="card p-4 text-xs text-text-muted">No headlines captured for this release.</div>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-text-muted text-left border-b border-bg-border">
            <th className="px-2 py-2 font-medium font-mono">Time</th>
            <th className="px-2 py-2 font-medium">Headline</th>
            <th className="px-2 py-2 font-medium">Relevance</th>
            <th className="px-2 py-2 font-medium">Category</th>
            <th className="px-2 py-2 font-medium">New info?</th>
            <th className="px-2 py-2 font-medium">Likely effect</th>
          </tr>
        </thead>
        <tbody>
          {headlines.map((h, i) => (
            <tr key={i} className="border-b border-bg-border/50 last:border-0 align-top">
              <td className="px-2 py-2 font-mono text-text-muted whitespace-nowrap">{fmtET(h.timestamp)}</td>
              <td className="px-2 py-2 text-text-primary max-w-[22rem]">{h.text}</td>
              <td className="px-2 py-2"><Badge tone={relevanceTone(h.relevance)}>{h.relevance}</Badge></td>
              <td className="px-2 py-2 text-text-secondary">{(h.category || '').replace(/_/g, ' ') || '—'}</td>
              <td className="px-2 py-2">
                {h.possibleNewInformationEvent
                  ? <Badge tone="yellow">yes</Badge>
                  : <span className="text-text-muted">no</span>}
              </td>
              <td className="px-2 py-2 text-text-secondary">{(h.likelyMarketEffect || 'unknown').replace(/_/g, ' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Numbers panel ────────────────────────────────────────────────────────────
function NumbersPanel({ numbers }) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr className="text-text-muted text-left border-b border-bg-border">
              <th className="px-2 py-2 font-medium font-sans">Line</th>
              <th className="px-2 py-2 font-medium text-right">Actual</th>
              <th className="px-2 py-2 font-medium text-right">Forecast</th>
              <th className="px-2 py-2 font-medium text-right">Previous</th>
              <th className="px-2 py-2 font-medium text-right">Revision</th>
              <th className="px-2 py-2 font-medium text-right">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {numbers.lines.map((l, i) => {
              const surpTone = l.surprise == null ? 'text-text-muted'
                : l.surprise > 0 ? 'text-accent-green' : l.surprise < 0 ? 'text-accent-red' : 'text-text-muted';
              return (
                <tr key={i} className="border-b border-bg-border/50 last:border-0">
                  <td className="px-2 py-2 font-sans text-text-primary">{l.name}</td>
                  <td className="px-2 py-2 text-right text-text-primary font-semibold">{fmtNum(l.actual)}</td>
                  <td className="px-2 py-2 text-right text-text-secondary">{fmtNum(l.forecast)}</td>
                  <td className="px-2 py-2 text-right text-text-secondary">{fmtNum(l.previous)}</td>
                  <td className="px-2 py-2 text-right text-text-muted">{fmtNum(l.revision)}</td>
                  <td className={`px-2 py-2 text-right ${surpTone}`}>
                    {l.surprise == null ? '—' : (l.surprise > 0 ? `+${l.surprise}` : l.surprise)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(numbers.aggregateSurpriseScore != null || numbers.interpretation) && (
        <div className="p-3 border-t border-bg-border space-y-1.5">
          {numbers.aggregateSurpriseScore != null && (
            <div className="text-[11px] text-text-secondary">
              Aggregate surprise score:{' '}
              <span className={`font-mono ${numbers.aggregateSurpriseScore < 0 ? 'text-accent-red' : 'text-accent-green'}`}>
                {numbers.aggregateSurpriseScore}
              </span>
            </div>
          )}
          {numbers.interpretation && (
            <p className="text-xs text-text-primary leading-relaxed">{numbers.interpretation}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary panel ────────────────────────────────────────────────────────────
function SummaryPanel({ summary }) {
  const Row = ({ label, value, tone }) => (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-text-muted w-36 shrink-0">{label}</span>
      {tone
        ? <Badge tone={tone}>{value}</Badge>
        : <span className="text-sm text-text-primary">{value || '—'}</span>}
    </div>
  );
  return (
    <div className="card p-4 space-y-2.5">
      <Row label="Best asset" value={summary.bestAsset} />
      <Row label="Second best" value={summary.secondBestAsset} />
      <Row label="Worst asset" value={summary.worstAsset} />
      <Row label="Best holding style" value={(summary.bestHoldingStyle || '').replace(/_/g, ' ') || '—'} />
      <Row
        label="Headline interference"
        value={summary.keyHeadlineInterference ? 'YES' : 'no'}
        tone={summary.keyHeadlineInterference ? 'red' : 'muted'}
      />
      {summary.finalTakeaway && (
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Final takeaway</div>
          <p className="text-sm text-text-primary leading-relaxed">{summary.finalTakeaway}</p>
        </div>
      )}
      {summary.learningNote && (
        <div className="pt-1">
          <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1 flex items-center gap-1">
            <Flag size={11} /> Learning note
          </div>
          <p className="text-sm text-accent-yellow/90 leading-relaxed">{summary.learningNote}</p>
        </div>
      )}
    </div>
  );
}

// ── Phase 6: Expected (scorecard) ────────────────────────────────────────────
function ExpectedPanel({ expected }) {
  const syms = Object.entries(expected.perSymbol || {})
    .sort(([, a], [, b]) => (a.role === 'ALERT' ? 0 : 1) - (b.role === 'ALERT' ? 0 : 1));
  return (
    <div className="space-y-3">
      {(expected.regimeContext || (expected.notes && expected.notes.length > 0)) && (
        <div className="card p-3 space-y-2">
          {expected.regimeContext && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">Correlation regime</div>
              <p className="text-xs text-text-secondary leading-relaxed">{expected.regimeContext}</p>
            </div>
          )}
          {expected.notes?.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-0.5">Strategic plan notes</div>
              <ul className="text-xs text-text-secondary leading-relaxed list-disc pl-4 space-y-0.5">
                {expected.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-muted text-left border-b border-bg-border">
              <th className="px-2 py-2 font-medium font-mono">Symbol</th>
              <th className="px-2 py-2 font-medium">Role</th>
              <th className="px-2 py-2 font-medium">Expected bias</th>
              <th className="px-2 py-2 font-medium">Conf</th>
              <th className="px-2 py-2 font-medium text-right">Score</th>
              <th className="px-2 py-2 font-medium">Narrative / flags</th>
            </tr>
          </thead>
          <tbody>
            {syms.map(([sym, e]) => (
              <tr key={sym} className="border-b border-bg-border/50 last:border-0 align-top">
                <td className="px-2 py-2 font-mono text-text-primary font-semibold">
                  {sym}
                  {(sym === expected.best) && <span className="ml-1 text-[9px] text-accent-green">★best</span>}
                  {(sym === expected.secondary) && <span className="ml-1 text-[9px] text-text-muted">2nd</span>}
                </td>
                <td className="px-2 py-2 text-text-secondary">{e.role === 'ALERT' ? 'Alert' : 'Confirm'}</td>
                <td className="px-2 py-2"><Badge tone={biasTone(e.expectedBias)}>{e.expectedBias}</Badge></td>
                <td className="px-2 py-2 font-mono text-text-secondary">{e.expectedConfidence}</td>
                <td className="px-2 py-2 text-right font-mono text-text-primary">{e.score == null ? '—' : e.score}</td>
                <td className="px-2 py-2 text-text-secondary max-w-[22rem]">
                  <div className="line-clamp-2">{e.narrative || '—'}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(e.conflicts || []).map((c, i) => <Badge key={`c${i}`} tone="yellow">conflict</Badge>)}
                    {(e.missingFields || []).map((m, i) => <Badge key={`m${i}`} tone="red">missing: {m}</Badge>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {expected.warnings?.length > 0 && (
        <div className="text-[11px] text-accent-yellow">⚠ {expected.warnings.join(' · ')}</div>
      )}
    </div>
  );
}

// ── Phase 6: Expected vs actual ──────────────────────────────────────────────
function ComparisonPanel({ comparison, assets }) {
  const legBySym = {};
  for (const a of assets) if (a.legAnalysis) legBySym[a.symbol] = a.legAnalysis;
  const o = comparison.overall || {};
  const reads = (sym) => {
    const t = legBySym[sym]?.timedReads;
    if (!t || !t.length) return null;
    return t.map(r => `${r.sec}s ${r.ticks > 0 ? '+' : ''}${r.ticks}`).join(' · ');
  };
  return (
    <div className="space-y-3">
      {o.bestSymbolActualVsExpected && (
        <div className="card p-3 text-xs text-text-primary leading-relaxed">
          <span className="text-[10px] uppercase tracking-wider text-text-muted mr-2">Overall</span>
          {o.bestSymbolActualVsExpected}
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-text-muted text-left border-b border-bg-border">
              <th className="px-2 py-2 font-medium font-mono">Symbol</th>
              <th className="px-2 py-2 font-medium">Expected</th>
              <th className="px-2 py-2 font-medium">1st leg</th>
              <th className="px-2 py-2 font-medium">2nd leg</th>
              <th className="px-2 py-2 font-medium text-center">Hit</th>
              <th className="px-2 py-2 font-medium">Best leg</th>
              <th className="px-2 py-2 font-medium">Quality</th>
              <th className="px-2 py-2 font-medium">Execution</th>
            </tr>
          </thead>
          <tbody>
            {comparison.bySymbol.map((c, i) => (
              <tr key={`${c.symbol}-${i}`} className="border-b border-bg-border/50 last:border-0 align-top">
                <td className="px-2 py-2 font-mono text-text-primary font-semibold">
                  {c.symbol}
                  {reads(c.symbol) && <div className="text-[9px] text-text-muted font-mono mt-0.5">{reads(c.symbol)}</div>}
                </td>
                <td className="px-2 py-2"><Badge tone={biasTone(c.expectedBias)}>{c.expectedBias}</Badge> <span className="font-mono text-text-muted">{c.expectedConfidence}</span></td>
                <td className="px-2 py-2"><Badge tone={legDirTone(c.actualFirstLegDir)}>{c.actualFirstLegDir}</Badge></td>
                <td className="px-2 py-2"><Badge tone={legDirTone(c.actualSecondLegDir)}>{c.actualSecondLegDir}</Badge></td>
                <td className="px-2 py-2 text-center"><Badge tone={hitTone(c.expectedBiasHit)}>{c.expectedBiasHit ? '✓' : '✗'}</Badge></td>
                <td className="px-2 py-2 text-text-secondary">{BEST_LEG_LABEL[c.bestLeg] || c.bestLeg}</td>
                <td className="px-2 py-2"><Badge tone={qualityTone(c.scoreQuality)} mono>{c.scoreQuality}</Badge></td>
                <td className="px-2 py-2"><Badge tone={execTone(c.executionQuality)}>{c.executionQuality}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comparison.confirmation && (
        <div className="card p-3 text-xs flex items-start gap-2">
          <Badge tone={agreementTone(comparison.confirmation.agreement)}>{comparison.confirmation.agreement}</Badge>
          <span className="text-text-secondary leading-relaxed">{comparison.confirmation.note}</span>
        </div>
      )}
    </div>
  );
}

// ── Phase 6: Suggested adjustments ───────────────────────────────────────────
function AdjustmentsPanel({ adjustments }) {
  return (
    <div className="space-y-2">
      {adjustments.map((a, i) => (
        <div key={i} className="card p-3 flex items-start gap-3">
          <Badge tone={confTone(a.confidence)} mono>{a.confidence}</Badge>
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-text-secondary">
              <span className="text-text-muted">{SCOPE_LABEL[a.scope] || a.scope}</span> · {a.target}
            </div>
            <p className="text-xs text-text-primary leading-relaxed mt-0.5">{a.rationale}</p>
            {a.note && <p className="text-[11px] text-text-muted mt-0.5">{a.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutionReviewPanel({ executionReview }) {
  const trades = executionReview.trades || [];
  return (
    <div className="space-y-3">
      {executionReview.summary && (
        <div className="card p-3 text-xs text-text-primary leading-relaxed">
          {executionReview.summary}
        </div>
      )}
      {trades.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-text-muted text-left border-b border-bg-border">
                <th className="px-2 py-2 font-medium font-mono">Time</th>
                <th className="px-2 py-2 font-medium font-mono">Symbol</th>
                <th className="px-2 py-2 font-medium">Side</th>
                <th className="px-2 py-2 font-medium text-right">Qty</th>
                <th className="px-2 py-2 font-medium text-right">Entry</th>
                <th className="px-2 py-2 font-medium text-right">Exit</th>
                <th className="px-2 py-2 font-medium text-right">Duration</th>
                <th className="px-2 py-2 font-medium text-right">P/L</th>
                <th className="px-2 py-2 font-medium">Read</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={`${t.symbol}-${t.time}-${i}`} className="border-b border-bg-border/50 last:border-0 align-top">
                  <td className="px-2 py-2 font-mono text-text-muted whitespace-nowrap">{t.time || '—'}</td>
                  <td className="px-2 py-2 font-mono text-text-primary font-semibold">{t.symbol || t.ticker || '—'}</td>
                  <td className="px-2 py-2"><Badge tone={t.side === 'Long' ? 'green' : t.side === 'Short' ? 'red' : 'muted'}>{t.side || '—'}</Badge></td>
                  <td className="px-2 py-2 text-right font-mono text-text-secondary">{fmtNum(t.contracts)}</td>
                  <td className="px-2 py-2 text-right font-mono text-text-secondary">{fmtNum(t.entry)}</td>
                  <td className="px-2 py-2 text-right font-mono text-text-secondary">{fmtNum(t.exit)}</td>
                  <td className="px-2 py-2 text-right font-mono text-text-secondary">{t.duration_sec == null ? '—' : `${t.duration_sec}s`}</td>
                  <td className={`px-2 py-2 text-right font-mono ${(t.pnl || 0) >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{fmtMoney(t.pnl)}</td>
                  <td className="px-2 py-2 text-text-secondary max-w-[18rem]">
                    <div>{t.review || '—'}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.release_match_confidence && <Badge tone="green" mono>linked {t.release_match_confidence}</Badge>}
                      {t.trade_type === 'account_management' && <Badge tone="blue">account management</Badge>}
                      {t.account_management_reason && <span className="text-[10px] text-text-muted">{t.account_management_reason}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(executionReview.mistakes?.length > 0 || executionReview.corrections?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {executionReview.mistakes?.length > 0 && (
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Mistakes / risk flags</div>
              <ul className="text-xs text-text-secondary leading-relaxed list-disc pl-4 space-y-1">
                {executionReview.mistakes.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}
          {executionReview.corrections?.length > 0 && (
            <div className="card p-3">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-2">Corrections next time</div>
              <ul className="text-xs text-text-secondary leading-relaxed list-disc pl-4 space-y-1">
                {executionReview.corrections.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DataQualityPanel({ dataQuality }) {
  if (!dataQuality) return null;
  const status = dataQuality.status || 'OK';
  const tone = status === 'DATA_GAP' ? 'red' : status === 'PARTIAL' ? 'yellow' : 'green';
  const rowCounts = Object.entries(dataQuality.rowCounts || {});
  const contracts = Object.entries(dataQuality.contracts || {});
  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge tone={tone} mono>{status}</Badge>
        {dataQuality.aggregation && <Badge tone="muted" mono>{dataQuality.aggregation}</Badge>}
        {dataQuality.backfill?.requested && (
          <Badge tone={dataQuality.backfill.ok ? 'green' : 'yellow'}>backfill {dataQuality.backfill.ok ? 'ok' : 'needed'}</Badge>
        )}
      </div>
      {dataQuality.notes?.length > 0 && (
        <ul className="text-xs text-text-secondary leading-relaxed list-disc pl-4 space-y-1">
          {dataQuality.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      {(dataQuality.missingSymbols?.length > 0 || dataQuality.backfill?.error) && (
        <div className="text-xs text-accent-yellow">
          {dataQuality.missingSymbols?.length > 0 ? `Missing: ${dataQuality.missingSymbols.join(', ')}` : ''}
          {dataQuality.backfill?.error ? ` ${dataQuality.backfill.error}` : ''}
        </div>
      )}
      {(rowCounts.length > 0 || contracts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
          {rowCounts.length > 0 && (
            <div>
              <div className="text-text-muted mb-1 font-sans uppercase tracking-wider text-[10px]">Rows by symbol</div>
              <div className="flex flex-wrap gap-1.5">
                {rowCounts.map(([sym, n]) => <Badge key={sym} tone={n > 0 ? 'muted' : 'red'} mono>{sym}:{n}</Badge>)}
              </div>
            </div>
          )}
          {contracts.length > 0 && (
            <div>
              <div className="text-text-muted mb-1 font-sans uppercase tracking-wider text-[10px]">Contracts</div>
              <div className="flex flex-wrap gap-1.5">
                {contracts.map(([sym, c]) => <Badge key={sym} tone="blue" mono>{sym}:{c}</Badge>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PeakTimingPanel({ assets }) {
  const rows = assets.filter(a => a.peaks?.peak1?.timestamp || a.peaks?.retrace1?.timestamp || a.peaks?.peak2?.timestamp);
  if (!rows.length) return null;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-text-muted text-left border-b border-bg-border">
            <th className="px-2 py-2 font-medium font-mono">Asset</th>
            <th className="px-2 py-2 font-medium">Peak 1</th>
            <th className="px-2 py-2 font-medium">Retrace 1</th>
            <th className="px-2 py-2 font-medium">Peak 2</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={`${a.symbol}-${i}`} className="border-b border-bg-border/50 last:border-0">
              <td className="px-2 py-2 font-mono text-text-primary font-semibold">
                {a.symbol}{a.contract ? <div className="text-[9px] text-text-muted">{a.contract}</div> : null}
              </td>
              <td className="px-2 py-2 text-text-secondary">{fmtPeak(a.peaks?.peak1)}</td>
              <td className="px-2 py-2 text-text-secondary">{fmtPeak(a.peaks?.retrace1)}</td>
              <td className="px-2 py-2 text-text-secondary">{fmtPeak(a.peaks?.peak2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INTERVIEW_FIELDS = [
  ['planVsActual', 'Plan vs actual'],
  ['executionIssues', 'Execution issues'],
  ['riskGuardContext', 'Risk Guard context'],
  ['accountManagement', 'Account management'],
  ['mistakes', 'Mistakes detected'],
  ['corrections', 'Corrections next release'],
  ['nextReleaseChanges', 'Setup changes'],
];

function PostReleaseInterviewPanel({ journal }) {
  const updateReleaseJournal = useStore(s => s.updateReleaseJournal);
  const [draft, setDraft] = useState(journal.postReleaseInterview || {});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(journal.postReleaseInterview || {});
    setSaved(false);
  }, [journal.releaseId, journal.postReleaseInterview]);

  function save() {
    updateReleaseJournal(journal.releaseId, {
      postReleaseInterview: { ...draft, reviewedAt: new Date().toISOString() },
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="card p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {INTERVIEW_FIELDS.map(([key, label]) => (
          <label key={key} className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
            <textarea
              value={draft[key] || ''}
              onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
              rows={key === 'corrections' || key === 'nextReleaseChanges' ? 4 : 3}
              className="w-full bg-bg border border-bg-border rounded px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-green/50 resize-y"
            />
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-text-muted">
          {journal.postReleaseInterview?.reviewedAt ? `Last saved ${fmtET(journal.postReleaseInterview.reviewedAt)}` : 'Interview answers are saved into this journal only.'}
        </div>
        <button
          onClick={save}
          className="px-3 py-1.5 text-xs bg-accent-green text-bg rounded font-medium hover:bg-accent-green-soft"
        >
          {saved ? 'Saved' : 'Save interview'}
        </button>
      </div>
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────
export default function ReleaseReviewModal({ journal, onClose }) {
  const storedJournal = useStore(s => s.releaseJournals.find(x => x.releaseId === journal.releaseId));
  const j = normalizeReleaseJournal(storedJournal || journal);
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-card border border-bg-border rounded-lg w-full max-w-5xl max-h-[92vh] overflow-auto">
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-bg-border sticky top-0 bg-bg-card z-10">
          <div className="space-y-1.5 pr-4">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-semibold text-lg text-text-primary">{j.releaseName}</h2>
              <Badge tone={importanceTone(j.importance)} mono>{j.importance.replace('_', '+')}</Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-text-muted">
              <Badge tone="blue" mono>{j.releaseKey}</Badge>
              <span>{j.releaseTemplate.replace(/_/g, ' ')}</span>
              {j.region && <span>· {j.region}</span>}
              {j.scheduledTime && <span>· {fmtDateET(j.scheduledTime)} {fmtET(j.scheduledTime)}</span>}
            </div>
            {j.summary.finalTakeaway && (
              <p className="text-xs text-text-secondary max-w-3xl leading-relaxed pt-0.5">{j.summary.finalTakeaway}</p>
            )}
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {j.summary.keyHeadlineInterference && (
            <div className="flex items-start gap-2 text-xs text-accent-yellow bg-accent-yellow/10 border border-accent-yellow/30 rounded px-3 py-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>Headline interference flagged — a new-information headline may have changed pricing during the holding window (see headline timeline).</span>
            </div>
          )}

          {j.dataQuality && (
            <Section icon={AlertTriangle} title="Data quality">
              <DataQualityPanel dataQuality={j.dataQuality} />
            </Section>
          )}

          <Section icon={FileText} title="Release numbers">
            <NumbersPanel numbers={j.numbers} />
          </Section>

          <Section icon={BarChart3} title="Asset ranking" right={
            <span className="text-[10px] text-text-muted">{j.trackedAssets.length} tracked · best-first</span>
          }>
            <AssetTable assets={j.trackedAssets} />
          </Section>

          {j.trackedAssets.some(a => a.peaks?.peak1?.timestamp || a.peaks?.retrace1?.timestamp || a.peaks?.peak2?.timestamp) && (
            <Section icon={BarChart3} title="Peak timing">
              <PeakTimingPanel assets={j.trackedAssets} />
            </Section>
          )}

          {j.expected && (
            <Section icon={Target} title="Expected (scorecard)" right={
              j.templateId ? <span className="text-[10px] text-text-muted font-mono">{j.templateId}</span> : null
            }>
              <ExpectedPanel expected={j.expected} />
            </Section>
          )}

          {j.comparison && (
            <Section icon={GitCompare} title="Expected vs actual">
              <ComparisonPanel comparison={j.comparison} assets={j.trackedAssets} />
            </Section>
          )}

          {j.executionReview && (
            <Section icon={Flag} title="Execution review">
              <ExecutionReviewPanel executionReview={j.executionReview} />
            </Section>
          )}

          <Section icon={Flag} title="Post-release interview">
            <PostReleaseInterviewPanel journal={j} />
          </Section>

          {j.suggestedAdjustments?.length > 0 && (
            <Section icon={Lightbulb} title="Suggested adjustments" right={
              <span className="text-[10px] text-text-muted">{j.suggestedAdjustments.length} · output-only</span>
            }>
              <AdjustmentsPanel adjustments={j.suggestedAdjustments} />
            </Section>
          )}

          <Section icon={ImageIcon} title="Screenshot timeline">
            <ScreenshotTimeline assets={j.trackedAssets} />
          </Section>

          <Section icon={Newspaper} title="Headline timeline">
            <HeadlineTimeline headlines={j.headlines} />
          </Section>

          <Section icon={Flag} title="Summary">
            <SummaryPanel summary={j.summary} />
          </Section>
        </div>
      </div>
    </div>
  );
}
