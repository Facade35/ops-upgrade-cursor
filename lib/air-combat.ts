import type { HostileUnit, InjectLog, SpawnedUnit } from "@/types/game";
import { distanceKm } from "@/lib/simulation-units";

interface EngagementCandidate {
  blueId: string;
  redId: string;
  distance: number;
  blueCanShoot: boolean;
  redCanShoot: boolean;
}

function buildFightScore(
  combatRating: number,
  speed: number,
  aoeRadius: number
): number {
  // Weighted so combat quality is dominant, with speed/range still meaningful.
  return combatRating * 2 + speed * 25 + aoeRadius * 0.3;
}

function winnerFromMutualFight(
  blue: SpawnedUnit,
  red: HostileUnit
): "BLUE" | "RED" {
  const blueScore = buildFightScore(
    Math.max(0, blue.combat_rating ?? 50),
    Math.max(0, blue.speed),
    Math.max(0, blue.aoe_radius ?? 0)
  );
  const redScore = buildFightScore(
    Math.max(0, red.combat_rating ?? 50),
    Math.max(0, red.speed),
    Math.max(0, red.aoe_radius ?? 0)
  );
  if (blueScore !== redScore) return blueScore > redScore ? "BLUE" : "RED";

  const blueRating = Math.max(0, blue.combat_rating ?? 50);
  const redRating = Math.max(0, red.combat_rating ?? 50);
  if (blueRating !== redRating) return blueRating > redRating ? "BLUE" : "RED";
  if (blue.speed !== red.speed) return blue.speed > red.speed ? "BLUE" : "RED";
  const blueAoe = Math.max(0, blue.aoe_radius ?? 0);
  const redAoe = Math.max(0, red.aoe_radius ?? 0);
  if (blueAoe !== redAoe) return blueAoe > redAoe ? "BLUE" : "RED";
  return blue.id <= red.id ? "BLUE" : "RED";
}

export function resolveFighterEngagements(
  units: SpawnedUnit[],
  hostileUnits: HostileUnit[],
  tick: number,
  now: number
): {
  units: SpawnedUnit[];
  hostileUnits: HostileUnit[];
  logs: InjectLog[];
} {
  const blueFighters = units.filter(
    (unit) =>
      unit.status === "AIRBORNE" &&
      unit.role === "FIGHTER" &&
      Math.max(0, unit.aoe_radius ?? 0) > 0
  );
  const redFighters = hostileUnits.filter(
    (unit) =>
      unit.status === "AIRBORNE" &&
      unit.role === "FIGHTER" &&
      Math.max(0, unit.aoe_radius ?? 0) > 0
  );
  if (blueFighters.length === 0 || redFighters.length === 0) {
    return { units, hostileUnits, logs: [] };
  }

  const candidates: EngagementCandidate[] = [];
  for (const blue of blueFighters) {
    for (const red of redFighters) {
      const distance = distanceKm(blue.lat, blue.lng, red.lat, red.lng);
      const blueCanShoot = distance <= Math.max(0, blue.aoe_radius ?? 0);
      const redCanShoot = distance <= Math.max(0, red.aoe_radius ?? 0);
      if (!blueCanShoot && !redCanShoot) continue;
      candidates.push({
        blueId: blue.id,
        redId: red.id,
        distance,
        blueCanShoot,
        redCanShoot,
      });
    }
  }
  if (candidates.length === 0) {
    return { units, hostileUnits, logs: [] };
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.blueId !== b.blueId) return a.blueId.localeCompare(b.blueId);
    return a.redId.localeCompare(b.redId);
  });

  const nextUnits = units.map((unit) => ({ ...unit }));
  const nextHostiles = hostileUnits.map((unit) => ({ ...unit }));
  const blueById = new Map(nextUnits.map((unit) => [unit.id, unit]));
  const redById = new Map(nextHostiles.map((unit) => [unit.id, unit]));
  const usedBlue = new Set<string>();
  const usedRed = new Set<string>();
  const logs: InjectLog[] = [];

  for (const candidate of candidates) {
    if (usedBlue.has(candidate.blueId) || usedRed.has(candidate.redId)) continue;
    const blue = blueById.get(candidate.blueId);
    const red = redById.get(candidate.redId);
    if (!blue || !red) continue;
    if (blue.status !== "AIRBORNE" || red.status !== "AIRBORNE") continue;

    let winner: "BLUE" | "RED";
    if (candidate.blueCanShoot && !candidate.redCanShoot) {
      winner = "BLUE";
    } else if (candidate.redCanShoot && !candidate.blueCanShoot) {
      winner = "RED";
    } else {
      winner = winnerFromMutualFight(blue, red);
    }

    usedBlue.add(blue.id);
    usedRed.add(red.id);
    if (winner === "BLUE") {
      red.status = "DESTROYED";
      logs.push({
        id: `${now}-dogfight-kill-${blue.id}-${red.id}`,
        tick,
        resource: "intel",
        amount: 1,
        note: `${blue.label} destroyed ${red.label} in air combat`,
        at: new Date(now).toISOString(),
      });
    } else {
      blue.status = "DESTROYED";
      blue.current_base = null;
      logs.push({
        id: `${now}-dogfight-loss-${red.id}-${blue.id}`,
        tick,
        resource: "intel",
        amount: 1,
        note: `${red.label} destroyed ${blue.label} in air combat`,
        at: new Date(now).toISOString(),
      });
    }
  }
  return {
    units: nextUnits,
    hostileUnits: nextHostiles,
    logs,
  };
}
