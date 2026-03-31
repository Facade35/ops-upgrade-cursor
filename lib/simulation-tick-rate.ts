/** Ticks per second of real time (simulation clock speed). */

export const MIN_SIMULATION_TICK_RATE = 0.01;
export const MAX_SIMULATION_TICK_RATE = 10;

export function clampSimulationTickRate(rate: number): number {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return 1;
  }
  return Math.min(MAX_SIMULATION_TICK_RATE, Math.max(MIN_SIMULATION_TICK_RATE, rate));
}

/** Human-readable ticks/sec for UI (supports fractional rates). */
export function formatTickRateForDisplay(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  if (rate < 1) return rate.toFixed(2);
  if (rate < 10 && !Number.isInteger(rate)) return rate.toFixed(1);
  return String(Math.round(rate * 100) / 100);
}
