import type { DailyPerformance, DrinkIngredient, HabitKey, PerformanceHistory } from './types';

const habitKeys: HabitKey[] = [
  'lemonWater', 'electrolytes', 'matcha', 'kefir', 'nuts', 'eggs', 'sardines',
  'vegetables', 'fruit', 'creatine', 'multivitamin', 'nicotinamide', 'collagen', 'sunExposure'
];

const drinkIngredients: DrinkIngredient[] = ['beetJuice', 'lemon', 'ginger', 'cayenne', 'honey'];

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
  coldExposure: false,
  performanceDrink: {
    ingredients: Object.fromEntries(drinkIngredients.map(key => [key, false])) as Record<DrinkIngredient, boolean>,
    beforeUsSession: false,
    beforeTraining: false,
    concentration: null,
    exerciseSnackQuality: null,
    tradingPlanExecution: null
  }
});

export const normalizeDay = (saved: Partial<DailyPerformance>, date: string): DailyPerformance => {
  const defaults = createEmptyDay(date);
  return {
    ...defaults,
    ...saved,
    date,
    habits: { ...defaults.habits, ...saved.habits },
    snacks: Array.isArray(saved.snacks) ? saved.snacks : [],
    sauna: { ...defaults.sauna, ...saved.sauna },
    performanceDrink: {
      ...defaults.performanceDrink,
      ...saved.performanceDrink,
      ingredients: {
        ...defaults.performanceDrink.ingredients,
        ...saved.performanceDrink?.ingredients
      }
    }
  };
};

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
    if (offset % 2 === 0) {
      day.performanceDrink.ingredients = {
        beetJuice: true,
        lemon: true,
        ginger: true,
        cayenne: true,
        honey: offset === 2
      };
      day.performanceDrink.beforeUsSession = true;
      day.performanceDrink.beforeTraining = offset === 4;
    }
    day.performanceDrink.concentration = offset % 2 === 0 ? 8 : 6;
    day.performanceDrink.exerciseSnackQuality = offset % 2 === 0 ? 8 : 7;
    day.performanceDrink.tradingPlanExecution = offset % 2 === 0 ? 9 : 7;
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
