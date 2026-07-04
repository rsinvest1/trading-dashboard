export type HabitKey =
  | 'lemonWater'
  | 'electrolytes'
  | 'matcha'
  | 'kefir'
  | 'nuts'
  | 'eggs'
  | 'sardines'
  | 'vegetables'
  | 'fruit'
  | 'creatine'
  | 'multivitamin'
  | 'nicotinamide'
  | 'collagen'
  | 'sunExposure';

export type SnackType = 'push' | 'pull' | 'legs' | 'core' | 'mobility';
export type Intensity = 'easy' | 'moderate' | 'hard';
export type CaffeineStatus = 'ok' | 'high' | 'late';

export interface ExerciseSnack {
  id: string;
  type: SnackType;
  intensity: Intensity;
}

export interface DailyPerformance {
  date: string;
  waterMl: number;
  heatDay: boolean;
  highSweat: boolean;
  coffeeCount: number;
  habits: Record<HabitKey, boolean>;
  snacks: ExerciseSnack[];
  sleepQuality: number;
  stress: number;
  energy: number;
  caffeineStatus: CaffeineStatus;
  sauna: {
    completed: boolean;
    duration: number;
    recoveryBenefit: number;
  };
  coldExposure: boolean;
}

export type PerformanceHistory = Record<string, DailyPerformance>;

export interface ScoreBreakdown {
  hydration: number;
  nutrition: number;
  exercise: number;
  recovery: number;
  supplements: number;
  exposure: number;
  overall: number;
  tradingReadiness: number;
  readinessStatus: 'green' | 'yellow' | 'red';
}
