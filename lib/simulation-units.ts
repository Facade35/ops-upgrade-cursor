import type { Asset, Base, SpawnedUnit } from "@/types/game";

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
      });
    }
  }

  return units;
}

export function applyFuelTick(
  units: SpawnedUnit[],
  bases: Base[]
): { units: SpawnedUnit[]; bases: Base[] } {
  const nextBases = bases.map((base) => ({ ...base }));
  const baseById = new Map(nextBases.map((base) => [base.id, base]));

  const nextUnits = units.map((unit) => {
    if (unit.status === "AIRBORNE") {
      return {
        ...unit,
        current_fuel: Math.max(0, unit.current_fuel - unit.fuel_burn_rate),
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
  unit: Pick<SpawnedUnit, "lat" | "lng" | "fuel_burn_rate">,
  targetLat: number,
  targetLng: number
): number {
  const distance = distanceKm(unit.lat, unit.lng, targetLat, targetLng);
  return Math.max(0, distance * Math.max(0, unit.fuel_burn_rate));
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

export function applyMovementTick(units: SpawnedUnit[]): SpawnedUnit[] {
  return units.map((unit) => {
    if (unit.status !== "AIRBORNE") return unit;
    if (typeof unit.target_lat !== "number" || typeof unit.target_lng !== "number") {
      return unit;
    }

    const remaining = distanceKm(unit.lat, unit.lng, unit.target_lat, unit.target_lng);
    if (remaining <= 0) return unit;

    const stepKm = Math.max(0, unit.speed);
    if (stepKm <= 0) return unit;

    if (stepKm >= remaining) {
      return {
        ...unit,
        lat: unit.target_lat,
        lng: unit.target_lng,
      };
    }

    const ratio = stepKm / remaining;
    return {
      ...unit,
      lat: unit.lat + (unit.target_lat - unit.lat) * ratio,
      lng: unit.lng + (unit.target_lng - unit.lng) * ratio,
    };
  });
}
