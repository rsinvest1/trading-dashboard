import { useEffect, useMemo, useState } from 'react';
import { createEmptyDay, createSeedHistory } from '../../lib/performance/seed';
import type {
  DailyPerformance,
  ExerciseSnack,
  HabitKey,
  Intensity,
  PerformanceHistory,
  SnackType
} from '../../lib/performance/types';

const STORAGE_KEY = 'rsinvest-performance-v1';
const todayKey = () => new Date().toLocaleDateString('en-CA');

const loadHistory = (): PerformanceHistory => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as PerformanceHistory;
  } catch {
    // A fresh local dashboard is safer than blocking check-ins on invalid saved data.
  }
  return createSeedHistory();
};

export function usePerformanceData() {
  const [history, setHistory] = useState<PerformanceHistory>(loadHistory);
  const [selectedDate, setSelectedDate] = useState(todayKey);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const day = useMemo(
    () => history[selectedDate] ?? createEmptyDay(selectedDate),
    [history, selectedDate]
  );

  const updateDay = (update: Partial<DailyPerformance> | ((current: DailyPerformance) => DailyPerformance)) => {
    setHistory(current => {
      const currentDay = current[selectedDate] ?? createEmptyDay(selectedDate);
      const nextDay = typeof update === 'function' ? update(currentDay) : { ...currentDay, ...update };
      return { ...current, [selectedDate]: nextDay };
    });
  };

  const toggleHabit = (key: HabitKey) => {
    updateDay(current => ({
      ...current,
      habits: { ...current.habits, [key]: !current.habits[key] }
    }));
  };

  const addSnack = (type: SnackType, intensity: Intensity) => {
    const snack: ExerciseSnack = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      intensity
    };
    updateDay(current => ({ ...current, snacks: [...current.snacks, snack] }));
  };

  const removeSnack = (id: string) => {
    updateDay(current => ({ ...current, snacks: current.snacks.filter(snack => snack.id !== id) }));
  };

  const resetToday = () => {
    const date = todayKey();
    setHistory(current => ({ ...current, [date]: createEmptyDay(date) }));
    setSelectedDate(date);
  };

  return {
    history,
    day,
    selectedDate,
    setSelectedDate,
    updateDay,
    toggleHabit,
    addSnack,
    removeSnack,
    resetToday
  };
}
