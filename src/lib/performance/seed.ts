import type { DailyPerformance, HabitKey, PerformanceHistory } from './types';

const habitKeys: HabitKey[] = [
  'lemonWater', 'electrolytes', 'matcha', 'kefir', 'nuts', 'eggs', 'sardines',
  'vegetables', 'fruit', 'creatine', 'multivitamin', 'nicotinamide', 'collagen', 'sunExposure'
];

const dateKey = (date: Date) => date.toLocaleDateString('en-CA');

export const createEmptyDay = (date = dateKey(new Date())): DailyPerformance => ({
  date,
  waterMl: 0,
  heatDay: false,
  highSweat: false,
  coffeeCount: 0,
  habits: Object.fromEntries(habitKeys.map(key => [key, false])) as Record<HabitKey, boolean>,
  snacks: [],
  sleepQuality: 7,
  stress: 4,
  energy: 7,
  caffeineStatus: 'ok',
  sauna: { completed: false, duration: 15, recoveryBenefit: 7 },
  coldExposure: false
});

export const createSeedHistory = (): PerformanceHistory => {
  const history: PerformanceHistory = {};

  for (let offset = 6; offset >= 1; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const day = createEmptyDay(dateKey(date));
    const weekday = date.getDay() % 6 !== 0;

    day.waterMl = offset % 3 === 0 ? 2700 : 3200 + (offset % 2) * 300;
    day.heatDay = offset < 4;
    day.highSweat = offset === 2;
    day.coffeeCount = offset % 2 ? 1 : 2;
    day.sleepQuality = 6 + (offset % 4);
    day.stress = 3 + (offset % 4);
    day.energy = 6 + (offset % 3);
    day.habits = {
      ...day.habits,
      lemonWater: true,
      matcha: offset !== 4,
      kefir: true,
      nuts: true,
      eggs: offset !== 3,
      sardines: offset % 3 !== 0,
      vegetables: true,
      fruit: offset !== 5,
      creatine: true,
      multivitamin: offset !== 2,
      nicotinamide: weekday,
      collagen: offset !== 4,
      sunExposure: offset % 2 === 0
    };
    day.snacks = Array.from({ length: 3 + (offset % 4) }, (_, index) => ({
      id: `${day.date}-${index}`,
      type: (['push', 'pull', 'legs', 'core', 'mobility'] as const)[index % 5],
      intensity: index === 2 && offset % 2 === 0 ? 'hard' as const : 'moderate' as const
    }));
    day.sauna.completed = offset === 2 || offset === 5;
    day.coldExposure = offset === 1 || offset === 4;
    history[day.date] = day;
  }

  const today = createEmptyDay();
  today.waterMl = 1250;
  today.habits.lemonWater = true;
  today.habits.matcha = true;
  today.habits.kefir = true;
  today.habits.nuts = true;
  today.habits.creatine = true;
  today.snacks = [
    { id: `${today.date}-seed`, type: 'push', intensity: 'moderate' }
  ];
  history[today.date] = today;
  return history;
};
