import type { DailyPerformance, ScoreBreakdown } from './types';

const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));

export const hydrationTarget = (day: DailyPerformance) =>
  day.heatDay ? (day.highSweat ? 4000 : 3500) : 3000;

export const hydrationScore = (day: DailyPerformance) =>
  clamp((day.waterMl / hydrationTarget(day)) * 100);

export const nutritionScore = (day: DailyPerformance) => {
  const keys = ['kefir', 'nuts', 'eggs', 'sardines', 'vegetables', 'fruit'] as const;
  return clamp((keys.filter(key => day.habits[key]).length / keys.length) * 100);
};

export const exerciseScore = (day: DailyPerformance) => {
  const count = day.snacks.length;
  if (count <= 4) return clamp((count / 4) * 100);
  if (count <= 6) return 100;
  return clamp(100 - (count - 6) * 10);
};

export const recoveryScore = (day: DailyPerformance) =>
  clamp(day.sleepQuality * 7 + (10 - day.stress) * 1.5 + day.energy * 1.5);

export const supplementScore = (day: DailyPerformance) => {
  const isWeekday = new Date(`${day.date}T12:00:00`).getDay() % 6 !== 0;
  const expected = ['creatine', 'multivitamin', 'collagen', 'matcha'] as const;
  const completed = expected.filter(key => day.habits[key]).length;
  const nicotinamidePoints = !isWeekday || day.habits.nicotinamide ? 1 : 0;
  return clamp(((completed + nicotinamidePoints) / (expected.length + 1)) * 100);
};

export const exposureScore = (day: DailyPerformance) => {
  if (day.sauna.completed || day.coldExposure) return 100;
  if (day.habits.sunExposure) return 75;
  return 50;
};

export const tradingReadinessScore = (day: DailyPerformance) => {
  const exercise = Math.min(day.snacks.length / 4, 1) * 100;
  const caffeine = day.caffeineStatus === 'ok' ? 100 : day.caffeineStatus === 'high' ? 55 : 30;
  return clamp(
    day.sleepQuality * 2.5 +
    hydrationScore(day) * 0.2 +
    (10 - day.stress) * 2 +
    day.energy * 2 +
    exercise * 0.05 +
    caffeine * 0.05 +
    nutritionScore(day) * 0.05
  );
};

export const calculateScores = (day: DailyPerformance): ScoreBreakdown => {
  const hydration = hydrationScore(day);
  const nutrition = nutritionScore(day);
  const exercise = exerciseScore(day);
  const recovery = recoveryScore(day);
  const supplements = supplementScore(day);
  const exposure = exposureScore(day);
  const tradingReadiness = tradingReadinessScore(day);

  return {
    hydration,
    nutrition,
    exercise,
    recovery,
    supplements,
    exposure,
    overall: clamp(
      hydration * 0.2 +
      recovery * 0.25 +
      nutrition * 0.2 +
      exercise * 0.2 +
      supplements * 0.1 +
      exposure * 0.05
    ),
    tradingReadiness,
    readinessStatus: tradingReadiness >= 75 ? 'green' : tradingReadiness >= 55 ? 'yellow' : 'red'
  };
};
