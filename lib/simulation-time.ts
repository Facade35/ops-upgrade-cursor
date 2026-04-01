import { resolveHoursPerTick } from "@/lib/simulation-units";

/** Normalize user-provided ISO-like string; returns null if invalid. */
export function normalizeScenarioStartTime(raw: string | undefined): string | null {
  if (raw == null || typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(raw.trim());
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export function computeSimulatedTimeMs(
  startIso: string | null | undefined,
  tick: number,
  hoursPerTick: number
): number | null {
  if (startIso == null || startIso === "") return null;
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return null;
  const h = resolveHoursPerTick(hoursPerTick);
  return startMs + tick * h * 60 * 60 * 1000;
}

/** Zulu (UTC) string for HUD badges and sidebars. */
export function formatSimulationTimeUtc(isoMs: number | null): string {
  if (isoMs == null) return "—";
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoMs));
  return `${formatted} Z`;
}

export function getSimulationTimeDisplay(
  simulationStartTimeIso: string | null | undefined,
  tick: number,
  hoursPerTick: number
): string {
  const ms = computeSimulatedTimeMs(simulationStartTimeIso ?? null, tick, hoursPerTick);
  return formatSimulationTimeUtc(ms);
}

export function getSimulationIntervalMinutes(hoursPerTick: number): number {
  return resolveHoursPerTick(hoursPerTick) * 60;
}

export function simulationTimeIsoToTick(
  simulationStartTimeIso: string | null | undefined,
  simulationTimeIso: string,
  hoursPerTick: number
): number | null {
  if (!simulationStartTimeIso) return null;
  const startMs = Date.parse(simulationStartTimeIso);
  const inputMs = Date.parse(simulationTimeIso);
  if (Number.isNaN(startMs) || Number.isNaN(inputMs) || inputMs < startMs) return null;
  const intervalMs = resolveHoursPerTick(hoursPerTick) * 60 * 60 * 1000;
  const delta = inputMs - startMs;
  const ticks = delta / intervalMs;
  if (!Number.isFinite(ticks) || ticks < 0) return null;
  const rounded = Math.round(ticks);
  if (Math.abs(ticks - rounded) > 1e-6) return null;
  return rounded;
}

export function isSimulationTimeIsoAligned(
  simulationStartTimeIso: string | null | undefined,
  simulationTimeIso: string,
  hoursPerTick: number
): boolean {
  return simulationTimeIsoToTick(
    simulationStartTimeIso,
    simulationTimeIso,
    hoursPerTick
  ) !== null;
}
