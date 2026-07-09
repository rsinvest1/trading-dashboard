import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  History,
  Moon,
  RotateCcw,
  ShieldCheck,
  Snowflake,
  Utensils,
  Zap
} from 'lucide-react';
import { usePerformanceData } from '../../hooks/performance/usePerformanceData';
import { calculateScores, hydrationTarget } from '../../lib/performance/scoring';
import type { DailyPerformance, DrinkIngredient, HabitKey, Intensity, SnackType } from '../../lib/performance/types';
import { Card, Progress, RangeField } from './PerformancePrimitives';

const habitGroups: Array<{ title: string; icon: typeof Utensils; items: Array<[HabitKey, string]> }> = [
  {
    title: 'Nutrição',
    icon: Utensils,
    items: [
      ['kefir', 'Kefir'], ['nuts', 'Frutos secos'], ['eggs', 'Ovos'], ['sardines', 'Sardinhas'],
      ['vegetables', 'Vegetais'], ['fruit', 'Fruta']
    ]
  },
  {
    title: 'Rotina',
    icon: ShieldCheck,
    items: [
      ['lemonWater', 'Água com limão'], ['matcha', 'Matcha · manhã'], ['creatine', 'Creatina 5 g'],
      ['multivitamin', 'Multi · refeição'], ['nicotinamide', 'Nicotinamida · Seg–Sex'], ['collagen', 'Colagénio · noite'],
      ['sunExposure', 'Exposição solar']
    ]
  }
];

const snackLabels: Record<SnackType, string> = {
  push: 'Empurrar',
  pull: 'Puxar',
  legs: 'Pernas',
  core: 'Core',
  mobility: 'Mobilidade'
};

const intensityLabels: Record<Intensity, string> = {
  easy: 'Leve',
  moderate: 'Moderado',
  hard: 'Intenso'
};

const drinkIngredientLabels: Record<DrinkIngredient, string> = {
  beetJuice: 'Sumo de beterraba',
  lemon: 'Limão',
  ginger: 'Gengibre',
  cayenne: 'Caiena',
  honey: 'Mel · opcional'
};

const readinessCopy = {
  green: { label: 'VERDE', text: 'Risco normal', classes: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30' },
  yellow: { label: 'AMARELO', text: 'Reduzir risco · evitar overtrading', classes: 'bg-amber-400/15 text-amber-300 border-amber-400/30' },
  red: { label: 'VERMELHO', text: 'Sem aumentar size · proteger capital', classes: 'bg-red-400/15 text-red-300 border-red-400/30' }
};

const readinessPhaseCopy = {
  morning: 'Manhã · só cobra o essencial',
  usSession: 'Sessão US · adaptado às 13:00',
  endOfDay: 'Fim do dia · revisão completa'
};

const shortDate = (date: string) =>
  new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00`));

const scoreColor = (score: number) =>
  score >= 75 ? 'text-emerald-300' : score >= 55 ? 'text-amber-300' : 'text-red-300';

function DaySwitcher({
  selectedDate,
  setSelectedDate
}: {
  selectedDate: string;
  setSelectedDate: (date: string) => void;
}) {
  const move = (offset: number) => {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + offset);
    const next = date.toLocaleDateString('en-CA');
    if (next <= new Date().toLocaleDateString('en-CA')) setSelectedDate(next);
  };

  const isToday = selectedDate === new Date().toLocaleDateString('en-CA');
  return (
    <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
      <button aria-label="Dia anterior" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800" onClick={() => move(-1)}>
        <ChevronLeft size={17} />
      </button>
      <button className="min-w-28 px-2 text-xs font-semibold capitalize text-slate-200" onClick={() => setSelectedDate(new Date().toLocaleDateString('en-CA'))}>
        {isToday ? 'Hoje' : shortDate(selectedDate)}
      </button>
      <button aria-label="Dia seguinte" disabled={isToday} className="rounded-lg p-2 text-slate-400 enabled:hover:bg-slate-800 disabled:opacity-30" onClick={() => move(1)}>
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

function HabitGrid({
  title,
  icon: Icon,
  items,
  day,
  toggleHabit
}: {
  title: string;
  icon: typeof Utensils;
  items: Array<[HabitKey, string]>;
  day: DailyPerformance;
  toggleHabit: (key: HabitKey) => void;
}) {
  return (
    <Card title={title} action={<Icon size={17} className="text-emerald-300" />}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map(([key, label]) => {
          const done = day.habits[key];
          return (
            <button
              key={key}
              aria-pressed={done}
              onClick={() => toggleHabit(key)}
              className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs font-medium transition ${
                done
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700'
              }`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${done ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800'}`}>
                {done && <Check size={13} strokeWidth={3} />}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      {title === 'Nutrição' && (
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Rotação: espinafres · tomate · pimentos · courgette · cogumelos · leguminosas · salmão · frango
        </p>
      )}
    </Card>
  );
}

const hasPerformanceDrink = (day: DailyPerformance) =>
  Object.values(day.performanceDrink.ingredients).some(Boolean);

function DrinkRating({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        {label}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-1 text-xs font-semibold tabular-nums text-slate-200 hover:text-slate-400"
        >
          {value === null ? '—' : `${value}/10`}
        </button>
      </span>
      <input
        className="h-7 w-full cursor-pointer accent-fuchsia-400"
        type="range"
        min="0"
        max="10"
        value={value ?? 0}
        onChange={event => onChange(Number(event.target.value) || null)}
      />
    </label>
  );
}

function PerformanceDrinkImpact({ history }: { history: Record<string, DailyPerformance> }) {
  const days = useMemo(
    () => Object.values(history).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
    [history]
  );
  const withDrink = days.filter(hasPerformanceDrink);
  const withoutDrink = days.filter(day => !hasPerformanceDrink(day));
  const average = (values: Array<number | null>) => {
    const rated = values.filter((value): value is number => value !== null);
    return rated.length ? rated.reduce((sum, value) => sum + value, 0) / rated.length : null;
  };
  const metrics = [
    ['Energia', (day: DailyPerformance) => day.energy],
    ['Concentração', (day: DailyPerformance) => day.performanceDrink.concentration],
    ['Exercise snacks', (day: DailyPerformance) => day.performanceDrink.exerciseSnackQuality],
    ['Plano de trading', (day: DailyPerformance) => day.performanceDrink.tradingPlanExecution]
  ] as const;

  return (
    <Card title="Impacto · últimos 30 dias" action={<History size={17} className="text-fuchsia-300" />}>
      <div className="mb-3 flex gap-2 text-[10px]">
        <span className="rounded-full bg-fuchsia-400/10 px-2.5 py-1 text-fuchsia-200">Com bebida {withDrink.length}</span>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-slate-400">Sem bebida {withoutDrink.length}</span>
      </div>
      <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto] gap-3 px-3 text-[9px] uppercase tracking-wider text-slate-600">
        <span>Métrica</span><span>Com</span><span>Sem</span><span className="text-right">Δ</span>
      </div>
      <div className="space-y-2">
        {metrics.map(([label, getter]) => {
          const withAverage = average(withDrink.map(getter));
          const withoutAverage = average(withoutDrink.map(getter));
          const delta = withAverage !== null && withoutAverage !== null ? withAverage - withoutAverage : null;
          return (
            <div key={label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-xl bg-slate-950/50 px-3 py-2">
              <span className="text-[11px] text-slate-400">{label}</span>
              <span className="text-xs tabular-nums text-fuchsia-200">{withAverage === null ? '—' : withAverage.toFixed(1)}</span>
              <span className="text-xs tabular-nums text-slate-500">{withoutAverage === null ? '—' : withoutAverage.toFixed(1)}</span>
              <span className={`min-w-9 text-right text-xs font-semibold tabular-nums ${delta === null ? 'text-slate-600' : delta > 0 ? 'text-emerald-300' : delta < 0 ? 'text-red-300' : 'text-slate-400'}`}>
                {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
        Compara médias, não prova causalidade. Quanto mais dias registares, mais útil fica o sinal.
      </p>
    </Card>
  );
}

function WeeklyReview({ history }: { history: Record<string, DailyPerformance> }) {
  const days = useMemo(
    () => Object.values(history).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7),
    [history]
  );
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const scores = days.map(calculateScores);
  const rotation = [
    ['Kefir', 'kefir'], ['Frutos secos', 'nuts'], ['Ovos', 'eggs'],
    ['Sardinhas', 'sardines'], ['Vegetais', 'vegetables']
  ] as const;
  const metrics = [
    ['Hidratação', `${average(scores.map(score => score.hydration))}%`],
    ['Sono médio', `${(average(days.map(day => day.sleepQuality * 10)) / 10).toFixed(1)}/10`],
    ['Exercise snacks', String(days.reduce((sum, day) => sum + day.snacks.length, 0))],
    ['Sauna', String(days.filter(day => day.sauna.completed).length)],
    ['Exposição ao frio', String(days.filter(day => day.coldExposure).length)],
    ['Nutrição', `${average(scores.map(score => score.nutrition))}%`],
    ['Suplementos', `${average(scores.map(score => score.supplements))}%`],
    ['Readiness', `${average(scores.map(score => score.tradingReadiness))}%`]
  ];

  return (
    <Card title="Revisão semanal" action={<History size={17} className="text-sky-300" />}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-950/50 p-3">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
        <span className="mr-1 self-center text-[10px] font-semibold uppercase tracking-wider text-slate-500">Frequência</span>
        {rotation.map(([label, key]) => (
          <span key={key} className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] text-slate-300">
            {label} {days.filter(day => day.habits[key]).length}/{days.length}
          </span>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {[...days].reverse().map((day, index) => {
          const score = calculateScores(day).overall;
          return (
            <button key={day.date} title={`${shortDate(day.date)}: ${score}%`} className="text-center">
              <div className="mb-1 h-16 overflow-hidden rounded-md bg-slate-800">
                <div
                  className={`mt-auto w-full ${score >= 75 ? 'bg-emerald-400' : score >= 55 ? 'bg-amber-400' : 'bg-red-400'}`}
                  style={{ height: `${score}%`, transform: `translateY(${100 - score}%)` }}
                />
              </div>
              <span className="text-[10px] uppercase text-slate-500">
                {index === days.length - 1 ? 'Hoje' : shortDate(day.date).slice(0, 3)}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export default function PerformanceDashboard() {
  const {
    history,
    day,
    selectedDate,
    setSelectedDate,
    updateDay,
    toggleHabit,
    addSnack,
    removeSnack,
    resetToday
  } = usePerformanceData();
  const [snackType, setSnackType] = useState<SnackType>('push');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const scores = calculateScores(day);
  const target = hydrationTarget(day);
  const readiness = readinessCopy[scores.readinessStatus];
  const hardSnackWarning = day.snacks.filter(snack => snack.intensity === 'hard').length >= 3;
  const showElectrolyteHint = (day.heatDay || day.highSweat) && !day.habits.electrolytes;
  const isToday = selectedDate === new Date().toLocaleDateString('en-CA');

  return (
    <div className="min-h-full bg-[#070b11] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-[#070b11]/90 px-3 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link aria-label="Voltar ao trading dashboard" to="/" className="rounded-xl border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-slate-100">
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-400">Performance cockpit</p>
              <h1 className="truncate text-base font-semibold sm:text-lg">Ricardo · Check-in diário</h1>
            </div>
          </div>
          <DaySwitcher selectedDate={selectedDate} setSelectedDate={setSelectedDate} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-3 p-3 pb-24 sm:space-y-4 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className={`border ${readiness.classes}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] opacity-70">Readiness · sessão US</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <strong className="text-4xl font-bold tabular-nums">{scores.tradingReadiness}</strong>
                  <span className="text-xs font-bold">{readiness.label}</span>
                </div>
                <p className="mt-1 text-xs">{readiness.text}</p>
                <p className="mt-2 text-[10px] font-medium opacity-75">{readinessPhaseCopy[scores.readinessPhase]}</p>
              </div>
              <Activity size={22} />
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Score diário</p>
                <p className={`mt-1 text-3xl font-bold tabular-nums ${scoreColor(scores.overall)}`}>{scores.overall}%</p>
              </div>
              <div className="grid flex-1 grid-cols-3 gap-x-3 gap-y-2">
                {[
                  ['Água', scores.hydration], ['Recuperação', scores.recovery], ['Nutrição', scores.nutrition],
                  ['Exercício', scores.exercise], ['Suplementos', scores.supplements], ['Exposição', scores.exposure]
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span className="truncate">{label}</span>
                      <span>{value}%</span>
                    </div>
                    <Progress value={value as number} />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Hidratação" action={<Droplets size={18} className="text-sky-300" />}>
            <div className="flex items-end justify-between">
              <div>
                <strong className="text-3xl font-semibold tabular-nums">{(day.waterMl / 1000).toFixed(2)} L</strong>
                <span className="ml-2 text-xs text-slate-500">/ {(target / 1000).toFixed(1)} L</span>
              </div>
              <span className="text-sm font-semibold text-sky-300">{scores.hydration}%</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Meta base 2.5 L · calor/suor 3.0 L · calor + suor 3.5 L.
            </p>
            <div className="mt-3"><Progress value={scores.hydration} color="bg-sky-400" /></div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[250, 500, 750].map(amount => (
                <button key={amount} onClick={() => updateDay({ waterMl: day.waterMl + amount })} className="rounded-xl bg-sky-400/10 py-3 text-xs font-semibold text-sky-300 hover:bg-sky-400/20">
                  +{amount} ml
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button aria-pressed={day.heatDay} onClick={() => updateDay({ heatDay: !day.heatDay })} className={`rounded-xl border px-3 py-2.5 text-xs ${day.heatDay ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-slate-800 text-slate-400'}`}>
                Dia quente ≥35°C
              </button>
              <button aria-pressed={day.highSweat} onClick={() => updateDay({ highSweat: !day.highSweat })} className={`rounded-xl border px-3 py-2.5 text-xs ${day.highSweat ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-slate-800 text-slate-400'}`}>
                Suor elevado
              </button>
            </div>
            {showElectrolyteHint && (
              <button onClick={() => toggleHabit('electrolytes')} className="mt-3 w-full rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-left text-[11px] text-amber-200">
                Eletrólitos podem ser úteis hoje. Toca para registar — sem excesso de sal.
              </button>
            )}
          </Card>

          <Card title="Readiness às 13:00" action={<Moon size={18} className="text-violet-300" />}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <RangeField label="Sono" value={day.sleepQuality} onChange={value => updateDay({ sleepQuality: value })} />
              <RangeField label="Energia" value={day.energy} onChange={value => updateDay({ energy: value })} />
              <RangeField label="Stress" value={day.stress} onChange={value => updateDay({ stress: value })} />
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-slate-400">
                  <span>Café</span><strong className="text-slate-100">{day.coffeeCount}</strong>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => updateDay({ coffeeCount: Math.max(0, day.coffeeCount - 1) })} className="rounded-lg bg-slate-800 py-2 text-sm">−</button>
                  <button onClick={() => updateDay({ coffeeCount: day.coffeeCount + 1 })} className="rounded-lg bg-slate-800 py-2 text-sm">+</button>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(['ok', 'high', 'late'] as const).map(status => (
                <button
                  key={status}
                  onClick={() => updateDay({ caffeineStatus: status })}
                  className={`rounded-xl border py-2 text-[11px] ${day.caffeineStatus === status ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-slate-800 text-slate-500'}`}
                >
                  <Coffee size={13} className="mr-1 inline" />
                  {status === 'ok' ? 'Controlada' : status === 'high' ? 'Elevada' : 'Tardia'}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {habitGroups.map(group => (
            <HabitGrid key={group.title} {...group} day={day} toggleHabit={toggleHabit} />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Performance Drink" action={<Zap size={18} className="text-fuchsia-300" />}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(Object.keys(drinkIngredientLabels) as DrinkIngredient[]).map(ingredient => {
                const selected = day.performanceDrink.ingredients[ingredient];
                return (
                  <button
                    key={ingredient}
                    aria-pressed={selected}
                    onClick={() => updateDay({
                      performanceDrink: {
                        ...day.performanceDrink,
                        ingredients: {
                          ...day.performanceDrink.ingredients,
                          [ingredient]: !selected
                        }
                      }
                    })}
                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-left text-xs ${
                      selected
                        ? 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400'
                    }`}
                  >
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${selected ? 'bg-fuchsia-400 text-slate-950' : 'bg-slate-800'}`}>
                      {selected && <Check size={13} strokeWidth={3} />}
                    </span>
                    {drinkIngredientLabels[ingredient]}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ['beforeUsSession', 'Antes da sessão US'],
                ['beforeTraining', 'Antes do treino']
              ].map(([key, label]) => {
                const timingKey = key as 'beforeUsSession' | 'beforeTraining';
                const selected = day.performanceDrink[timingKey];
                return (
                  <button
                    key={key}
                    aria-pressed={selected}
                    disabled={!hasPerformanceDrink(day)}
                    onClick={() => updateDay({
                      performanceDrink: { ...day.performanceDrink, [timingKey]: !selected }
                    })}
                    className={`rounded-xl border px-3 py-2.5 text-xs disabled:opacity-35 ${
                      selected ? 'border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-200' : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3">
              <DrinkRating
                label="Concentração"
                value={day.performanceDrink.concentration}
                onChange={concentration => updateDay({
                  performanceDrink: { ...day.performanceDrink, concentration }
                })}
              />
              <DrinkRating
                label="Qualidade dos snacks"
                value={day.performanceDrink.exerciseSnackQuality}
                onChange={exerciseSnackQuality => updateDay({
                  performanceDrink: { ...day.performanceDrink, exerciseSnackQuality }
                })}
              />
              <DrinkRating
                label="Execução do plano"
                value={day.performanceDrink.tradingPlanExecution}
                onChange={tradingPlanExecution => updateDay({
                  performanceDrink: { ...day.performanceDrink, tradingPlanExecution }
                })}
              />
            </div>
          </Card>

          <PerformanceDrinkImpact history={history} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <Card title={`Exercise snacks · ${day.snacks.length}/4–6`} action={<Dumbbell size={18} className="text-orange-300" />}>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(snackLabels) as SnackType[]).map(type => (
                <button key={type} onClick={() => setSnackType(type)} className={`rounded-lg px-1 py-2 text-[10px] ${snackType === type ? 'bg-orange-400/15 text-orange-200 ring-1 ring-orange-400/40' : 'bg-slate-800 text-slate-400'}`}>
                  {snackLabels[type]}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {(Object.keys(intensityLabels) as Intensity[]).map(level => (
                <button key={level} onClick={() => setIntensity(level)} className={`rounded-lg px-2 py-2 text-[10px] ${intensity === level ? 'bg-slate-700 text-white' : 'bg-slate-800 text-slate-500'}`}>
                  {intensityLabels[level]}
                </button>
              ))}
              <button onClick={() => addSnack(snackType, intensity)} className="rounded-lg bg-orange-400 py-2 text-xs font-bold text-slate-950">+ Registar</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {day.snacks.map(snack => (
                <button key={snack.id} title="Tocar para remover" onClick={() => removeSnack(snack.id)} className="rounded-full border border-slate-700 px-2.5 py-1 text-[10px] text-slate-300">
                  {snackLabels[snack.type]} · {intensityLabels[snack.intensity]} ×
                </button>
              ))}
            </div>
            {hardSnackWarning && (
              <p className="mt-3 rounded-xl bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
                3+ snacks intensos: prioriza recuperação antes de acrescentar intensidade.
              </p>
            )}
          </Card>

          <Card title="Sauna & frio" action={<div className="flex gap-2"><Flame size={17} className="text-orange-300" /><Snowflake size={17} className="text-sky-300" /></div>}>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => updateDay({ sauna: { ...day.sauna, completed: !day.sauna.completed } })} className={`rounded-xl border p-3 text-left ${day.sauna.completed ? 'border-orange-400/40 bg-orange-400/10 text-orange-200' : 'border-slate-800 text-slate-400'}`}>
                <span className="block text-xs font-semibold">Sauna</span>
                <span className="text-[10px] opacity-70">Gaia · {day.sauna.duration} min</span>
              </button>
              <button onClick={() => updateDay({ coldExposure: !day.coldExposure })} className={`rounded-xl border p-3 text-left ${day.coldExposure ? 'border-sky-400/40 bg-sky-400/10 text-sky-200' : 'border-slate-800 text-slate-400'}`}>
                <span className="block text-xs font-semibold">Exposição ao frio</span>
                <span className="text-[10px] opacity-70">Sessão concluída</span>
              </button>
            </div>
            {day.sauna.completed && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <RangeField label={`Duração (${day.sauna.duration} min)`} value={Math.round(day.sauna.duration / 3)} onChange={value => updateDay({ sauna: { ...day.sauna, duration: value * 3 } })} />
                <RangeField label="Benefício percebido" value={day.sauna.recoveryBenefit} onChange={value => updateDay({ sauna: { ...day.sauna, recoveryBenefit: value } })} />
                <p className="col-span-2 rounded-xl bg-sky-400/10 px-3 py-2 text-[11px] text-sky-200">Reidrata depois da sauna.</p>
              </div>
            )}
            {day.coldExposure && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Se hipertrofia for o objetivo, evita frio imediatamente após treino de força.
              </p>
            )}
          </Card>
        </div>

        <WeeklyReview history={history} />

        {isToday && (
          <div className="flex justify-center pt-2">
            <button onClick={() => window.confirm('Limpar o check-in de hoje?') && resetToday()} className="flex items-center gap-2 rounded-xl border border-slate-800 px-4 py-2.5 text-xs text-slate-500 hover:border-red-400/40 hover:text-red-300">
              <RotateCcw size={14} /> Limpar dia
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
