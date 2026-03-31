import type { Asset, Base, GameDefinition, SpawnedUnit } from "@/types/game";

/** Default simulated hours per tick when a scenario does not set `hours_per_tick`. */
export const DEFAULT_HOURS_PER_TICK = 1;

export function resolveHoursPerTick(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HOURS_PER_TICK;
  }
  return Math.min(168, Math.max(0.01, value));
}

export function spawnUnitsFromAssets(assets: Asset[], bases: Base[]): SpawnedUnit[] {
  const baseById = new Map(bases.map((base) => [base.id, base]));
  const units: SpawnedUnit[] = [];

  for (const asset of assets) {
    const base = baseById.get(asset.home_base);
    const spawnLat = base?.lat ?? 0;
    const spawnLng = base?.lng ?? 0;
    const quantity = Math.max(0, Math.floor(asset.quantity));

    for (let i = 0; i < quantity; i += 1) {
      units.push({
        id: `${asset.id}-${i + 1}`,
        asset_id: asset.id,
        label: `${asset.label} ${i + 1}`,
        sidc: asset.sidc,
        home_base: asset.home_base,
        current_base: asset.home_base,
        status: "GROUNDED",
        lat: spawnLat,
        lng: spawnLng,
        current_fuel: asset.max_fuel,
        max_fuel: asset.max_fuel,
        fuel_burn_rate: asset.fuel_burn_rate,
        speed: asset.speed,
        capacity: asset.capacity,
        role: asset.role,
        aoe_radius: asset.aoe_radius,
        transfer_rate: asset.transfer_rate,
        deployment_status: undefined,
        target_lat: undefined,
        target_lng: undefined,
        departure_tick: undefined,
        mission_type: undefined,
        completed_inject_ids: [],
        side: asset.side,
        sensor_range_km: asset.sensor_range_km,
        detection_strength: asset.detection_strength,
        combat_rating: asset.combat_rating,
      });
    }
  }

  return units;
}

export function applyInitialAirborne(
  units: SpawnedUnit[],
  placements: GameDefinition["initialAirborne"]
): SpawnedUnit[] {
  if (!placements || placements.length === 0) return units;
  const nextUnits: SpawnedUnit[] = units.map((unit): SpawnedUnit => {
    const [assetId, rawIndex] = unit.id.split("-");
    const unitIndex = Number(rawIndex);
    const placement = placements.find(
      (candidate) =>
        candidate.asset_id === assetId &&
        (candidate.unit_index ?? 1) === (Number.isFinite(unitIndex) ? unitIndex : 1)
    );
    if (!placement) return unit;
    return {
      ...unit,
      status: "AIRBORNE" as const,
      current_base: null,
      lat: placement.lat,
      lng: placement.lng,
      mission_type: placement.mission_type ?? unit.mission_type,
      target_lat:
        typeof placement.target_lat === "number"
          ? placement.target_lat
          : unit.target_lat,
      target_lng:
        typeof placement.target_lng === "number"
          ? placement.target_lng
          : unit.target_lng,
    };
  });
  return nextUnits;
}

export function applyFuelTick(
  units: SpawnedUnit[],
  bases: Base[],
  hoursPerTick: number = DEFAULT_HOURS_PER_TICK
): { units: SpawnedUnit[]; bases: Base[] } {
  const h = resolveHoursPerTick(hoursPerTick);
  const nextBases = bases.map((base) => ({ ...base }));
  const baseById = new Map(nextBases.map((base) => [base.id, base]));

  const nextUnits = units.map((unit) => {
    if (unit.status === "DESTROYED") {
      return unit;
    }
    if (unit.status === "AIRBORNE") {
      const burn = Math.max(0, unit.fuel_burn_rate) * h;
      return {
        ...unit,
        current_fuel: Math.max(0, unit.current_fuel - burn),
      };
    }

    if (unit.status !== "GROUNDED" || !unit.current_base) {
      return unit;
    }

    const base = baseById.get(unit.current_base);
    if (!base) return unit;

    const fuelNeeded = Math.max(0, unit.max_fuel - unit.current_fuel);
    if (fuelNeeded === 0 || base.fuel_reserves <= 0) return unit;

    const transfer = Math.min(fuelNeeded, base.fuel_reserves);
    base.fuel_reserves -= transfer;

    return {
      ...unit,
      current_fuel: unit.current_fuel + transfer,
    };
  });

  return { units: nextUnits, bases: nextBases };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceKm(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) *
      Math.cos(toRadians(toLat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function estimateFuelRequired(
  unit: Pick<SpawnedUnit, "lat" | "lng" | "fuel_burn_rate" | "speed">,
  targetLat: number,
  targetLng: number
): number {
  const distance = distanceKm(unit.lat, unit.lng, targetLat, targetLng);
  const burn = Math.max(0, unit.fuel_burn_rate);
  const speed = Math.max(0, unit.speed);
  if (speed > 0) {
    const hours = distance / speed;
    return Math.max(0, hours * burn);
  }
  return Math.max(0, distance * burn);
}

export function isWithinAoe(
  sourceLat: number,
  sourceLng: number,
  targetLat: number,
  targetLng: number,
  radiusKm: number
): boolean {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  return distanceKm(sourceLat, sourceLng, targetLat, targetLng) <= radiusKm;
}

export function applyMovementTick(
  units: SpawnedUnit[],
  hoursPerTick: number = DEFAULT_HOURS_PER_TICK
): SpawnedUnit[] {
  const h = resolveHoursPerTick(hoursPerTick);
  return units.map((unit) => {
    if (unit.status === "DESTROYED") return unit;
    if (unit.status !== "AIRBORNE") return unit;
    const route = unit.route ?? [];
    let routeIndex = unit.route_index ?? 0;
    let targetLat =
      typeof unit.target_lat === "number" ? unit.target_lat : undefined;
    let targetLng =
      typeof unit.target_lng === "number" ? unit.target_lng : undefined;

    if (
      route.length > 0 &&
      (typeof targetLat !== "number" || typeof targetLng !== "number")
    ) {
      const waypoint = route[Math.max(0, Math.min(route.length - 1, routeIndex))];
      targetLat = waypoint.lat;
      targetLng = waypoint.lng;
    }

    if (typeof targetLat !== "number" || typeof targetLng !== "number") {
      return unit;
    }

    const remaining = distanceKm(unit.lat, unit.lng, targetLat, targetLng);
    if (remaining <= 0) return unit;

    const stepKm = Math.max(0, unit.speed) * h;
    if (stepKm <= 0) return unit;

    if (stepKm >= remaining) {
      let nextIndex = routeIndex;
      let nextTargetLat = targetLat;
      let nextTargetLng = targetLng;
      if (route.length > 0) {
        nextIndex = (routeIndex + 1) % route.length;
        nextTargetLat = route[nextIndex].lat;
        nextTargetLng = route[nextIndex].lng;
      }
      return {
        ...unit,
        lat: targetLat,
        lng: targetLng,
        route_index: route.length > 0 ? nextIndex : unit.route_index,
        target_lat: nextTargetLat,
        target_lng: nextTargetLng,
      };
    }

    const ratio = stepKm / remaining;
    return {
      ...unit,
      lat: unit.lat + (targetLat - unit.lat) * ratio,
      lng: unit.lng + (targetLng - unit.lng) * ratio,
      target_lat: targetLat,
      target_lng: targetLng,
    };
  });
}
