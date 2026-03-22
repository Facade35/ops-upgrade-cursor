"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import type { GameState } from "@/components/game-state-provider";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { resolveFighterEngagements } from "@/lib/air-combat";
import {
  applyFuelTick,
  applyMovementTick,
  distanceKm,
  isWithinAoe,
} from "@/lib/simulation-units";
import { persistSimulationState } from "@/lib/supabase";

const MAX_INJECT_LOGS = 120;

function deriveGlobalTension(
  resources: GameState["resources"],
  fallback: number
): number {
  let globalKey: string | undefined;
  let tensionKey: string | undefined;
  for (const key of Object.keys(resources)) {
    const lower = key.toLowerCase();
    if (lower === "global tension") globalKey = key;
    else if (lower === "tension") tensionKey = key;
  }
  const key = globalKey ?? tensionKey;
  if (!key) return fallback;
  const raw = resources[key];
  if (typeof raw !== "number" || Number.isNaN(raw)) return fallback;
  const value = raw > 1 ? Math.round(raw) : Math.round(raw * 100);
  return Math.min(100, Math.max(0, value));
}

function applyEventInjects(
  resources: GameState["resources"],
  injects: GameState["resources"]
): GameState["resources"] {
  const next = { ...resources };
  const lowerToKey: Record<string, string> = {};
  for (const key of Object.keys(next)) {
    lowerToKey[key.toLowerCase()] = key;
  }
  for (const [resource, amount] of Object.entries(injects)) {
    const canonicalKey = lowerToKey[resource.toLowerCase()] ?? resource;
    next[canonicalKey] = (next[canonicalKey] ?? 0) + amount;
  }
  return next;
}

function applyActiveRefuels(
  units: GameState["units"],
  activeRefuels: GameState["activeRefuels"]
): { units: GameState["units"]; activeRefuels: GameState["activeRefuels"] } {
  if (!activeRefuels.length) return { units, activeRefuels };

  const nextUnits = units.map((unit) => ({ ...unit }));
  const unitById = new Map(nextUnits.map((unit) => [unit.id, unit]));
  const persisted: GameState["activeRefuels"] = [];

  for (const link of activeRefuels) {
    const tanker = unitById.get(link.tankerId);
    const receiver = unitById.get(link.receiverId);
    if (!tanker || !receiver || tanker.id === receiver.id) continue;
    if (tanker.status !== "AIRBORNE" || receiver.status !== "AIRBORNE") continue;
    if (tanker.role !== "TANKER") continue;

    const radius = Math.max(0, tanker.aoe_radius ?? 0);
    if (!isWithinAoe(tanker.lat, tanker.lng, receiver.lat, receiver.lng, radius)) {
      continue;
    }

    const rate = Math.max(0, tanker.transfer_rate ?? 0);
    const receiverNeed = Math.max(0, receiver.max_fuel - receiver.current_fuel);
    if (rate <= 0 || receiverNeed <= 0 || tanker.current_fuel <= 0) continue;

    const transferAmount = Math.min(rate, receiverNeed, tanker.current_fuel);
    if (transferAmount <= 0) continue;

    tanker.current_fuel = Math.max(0, tanker.current_fuel - transferAmount);
    receiver.current_fuel = Math.min(
      receiver.max_fuel,
      receiver.current_fuel + transferAmount
    );
    persisted.push(link);
  }

  return { units: nextUnits, activeRefuels: persisted };
}

function applyHostileMovementTick(
  hostileUnits: GameState["hostileUnits"]
): GameState["hostileUnits"] {
  return hostileUnits.map((unit) => {
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
    const stepKm = Math.max(0, unit.speed);
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

function applyHostileFuelTick(
  hostileUnits: GameState["hostileUnits"]
): GameState["hostileUnits"] {
  return hostileUnits.map((unit) => {
    if (unit.status !== "AIRBORNE") return unit;
    return {
      ...unit,
      current_fuel: Math.max(0, unit.current_fuel - unit.fuel_burn_rate),
    };
  });
}

function spawnHostileUnitsForGroup(
  state: GameState,
  groupId: string
): GameState["hostileUnits"] {
  const group = state.hostileGroups.find((candidate) => candidate.id === groupId);
  if (!group) return state.hostileUnits;
  const existing = state.hostileUnits.some((unit) => unit.group_id === group.id);
  if (existing) return state.hostileUnits;
  const base = state.hostileBases.find((candidate) => candidate.id === group.home_base);
  const spawnLat = base?.lat ?? 0;
  const spawnLng = base?.lng ?? 0;
  const firstWaypoint = group.route?.[0];
  const nextUnits = [...state.hostileUnits];
  const quantity = Math.max(1, group.quantity);

  for (let i = 0; i < quantity; i += 1) {
    nextUnits.push({
      id: `${group.id}-${i + 1}`,
      group_id: group.id,
      label: `${group.label} ${i + 1}`,
      side: group.side,
      status: "AIRBORNE",
      role: group.role,
      sidc: group.sidc,
      home_base: group.home_base,
      lat: spawnLat,
      lng: spawnLng,
      target_lat: firstWaypoint?.lat,
      target_lng: firstWaypoint?.lng,
      route: group.route,
      route_index: firstWaypoint ? 0 : undefined,
      current_fuel: group.max_fuel,
      max_fuel: group.max_fuel,
      fuel_burn_rate: group.fuel_burn_rate,
      speed: group.speed,
      aoe_radius: group.aoe_radius,
      sensor_range_km: group.sensor_range_km,
      engagement_range_km: group.engagement_range_km,
      combat_rating: group.combat_rating,
      signature: group.signature,
    });
  }
  return nextUnits;
}

function applyRetaskToRedAssets(
  state: GameState,
  targetLat: number,
  targetLng: number,
  groupIds?: string[]
): Pick<GameState, "hostileUnits" | "hostileGroups"> {
  const groupScope = new Set((groupIds ?? []).filter((id) => id.length > 0));
  const retaskAllGroups = groupScope.size === 0;
  const appliesToGroup = (groupId: string) =>
    retaskAllGroups || groupScope.has(groupId);

  const hostileUnits = state.hostileUnits.map((unit) => {
    if (unit.status !== "AIRBORNE") return unit;
    if (!appliesToGroup(unit.group_id)) return unit;
    return {
      ...unit,
      target_lat: targetLat,
      target_lng: targetLng,
      route: [{ lat: targetLat, lng: targetLng }],
      route_index: 0,
    };
  });

  const hostileGroups = state.hostileGroups.map((group) => {
    if (!appliesToGroup(group.id)) return group;
    return {
      ...group,
      route: [{ lat: targetLat, lng: targetLng }],
    };
  });

  return { hostileUnits, hostileGroups };
}

function applyEventActions(
  state: GameState,
  firedEvents: GameState["events"],
  tick: number,
  now: number
): { state: GameState; logs: GameState["injects"] } {
  if (!firedEvents.some((event) => (event.actions ?? []).length > 0)) {
    return { state, logs: [] };
  }
  let nextState = state;
  const logs: GameState["injects"] = [];

  for (const event of firedEvents) {
    for (const action of event.actions ?? []) {
      if (action.type === "SPAWN_HOSTILE_GROUP") {
        const hostileUnits = spawnHostileUnitsForGroup(nextState, action.group_id);
        if (hostileUnits !== nextState.hostileUnits) {
          nextState = { ...nextState, hostileUnits };
          logs.push({
            id: `${now}-spawn-${action.group_id}-${Math.random().toString(36).slice(2, 8)}`,
            tick,
            resource: "intel",
            amount: 1,
            note: `Hostile group ${action.group_id} launched`,
            at: new Date(now).toISOString(),
          });
        }
      } else if (action.type === "ACTIVATE_ZONE") {
        const noFlyZones = nextState.noFlyZones.map((zone) =>
          zone.id === action.zone_id
            ? { ...zone, active: action.active ?? true }
            : zone
        );
        nextState = { ...nextState, noFlyZones };
        logs.push({
          id: `${now}-zone-${action.zone_id}-${Math.random().toString(36).slice(2, 8)}`,
          tick,
          resource: "intel",
          amount: 1,
          note: `No-fly zone ${action.zone_id} activated`,
          at: new Date(now).toISOString(),
        });
      } else if (action.type === "CREATE_NFZ") {
        const exists = nextState.noFlyZones.some((zone) => zone.id === action.zone.id);
        const noFlyZones = exists
          ? nextState.noFlyZones.map((zone) =>
              zone.id === action.zone.id ? action.zone : zone
            )
          : [...nextState.noFlyZones, action.zone];
        nextState = { ...nextState, noFlyZones };
        logs.push({
          id: `${now}-zone-create-${action.zone.id}-${Math.random().toString(36).slice(2, 8)}`,
          tick,
          resource: "intel",
          amount: 1,
          note: `No-fly zone ${action.zone.label} created`,
          at: new Date(now).toISOString(),
        });
      } else if (action.type === "CREATE_DROP_ZONE") {
        nextState = {
          ...nextState,
          globePoints: [...nextState.globePoints, action.point],
        };
        logs.push({
          id: `${now}-drop-${Math.random().toString(36).slice(2, 8)}`,
          tick,
          resource: "intel",
          amount: 1,
          note: `Drop zone ${action.point.label ?? "created"}`,
          at: new Date(now).toISOString(),
        });
      } else if (action.type === "RETASK_RED_ASSETS") {
        const retask = applyRetaskToRedAssets(
          nextState,
          action.target_lat,
          action.target_lng,
          action.group_ids
        );
        nextState = {
          ...nextState,
          hostileUnits: retask.hostileUnits,
          hostileGroups: retask.hostileGroups,
        };
        logs.push({
          id: `${now}-retask-${Math.random().toString(36).slice(2, 8)}`,
          tick,
          resource: "intel",
          amount: 1,
          note: "Red assets retasked to new location",
          at: new Date(now).toISOString(),
        });
      }
    }
  }

  return { state: nextState, logs };
}

function enforceNoFlyZones(
  hostileUnits: GameState["hostileUnits"],
  zones: GameState["noFlyZones"],
  tick: number,
  now: number
): { hostileUnits: GameState["hostileUnits"]; logs: GameState["injects"] } {
  const activeZones = zones.filter((zone) => zone.active);
  if (activeZones.length === 0) return { hostileUnits, logs: [] };

  const logs: GameState["injects"] = [];
  const nextUnits = hostileUnits.map((unit) => {
    if (unit.status !== "AIRBORNE") return unit;
    let nextUnit = { ...unit };
    let inViolation = false;

    for (const zone of activeZones) {
      if (!zone.applies_to.includes(unit.side)) continue;
      const inside = isWithinAoe(
        zone.center_lat,
        zone.center_lng,
        unit.lat,
        unit.lng,
        zone.radius_km
      );
      if (!inside) continue;
      inViolation = true;

      if (zone.violation_policy === "WARN_THEN_DESTROY") {
        if (typeof nextUnit.first_warning_tick !== "number") {
          nextUnit.first_warning_tick = tick;
          logs.push({
            id: `${now}-warn-${unit.id}-${zone.id}-${Math.random().toString(36).slice(2, 8)}`,
            tick,
            resource: "intel",
            amount: 1,
            note: `${unit.label} warned for violating ${zone.label}`,
            at: new Date(now).toISOString(),
          });
          continue;
        }
        const graceTicks = Math.max(0, zone.warning_grace_ticks ?? 2);
        if (tick - nextUnit.first_warning_tick >= graceTicks) {
          nextUnit = {
            ...nextUnit,
            status: "DESTROYED",
          };
          logs.push({
            id: `${now}-destroy-${unit.id}-${zone.id}-${Math.random().toString(36).slice(2, 8)}`,
            tick,
            resource: "intel",
            amount: 1,
            note: `${unit.label} destroyed after no-fly zone violation`,
            at: new Date(now).toISOString(),
          });
          break;
        }
      }
    }

    if (!inViolation) {
      nextUnit.first_warning_tick = undefined;
    }
    return nextUnit;
  });

  return { hostileUnits: nextUnits, logs };
}

function rebuildKnownTracks(
  units: GameState["units"],
  hostileUnits: GameState["hostileUnits"],
  tick: number
): GameState["knownTracks"] {
  const detectorUnits = units.filter(
    (unit) =>
      unit.status === "AIRBORNE" &&
      (unit.mission_type === "ISR" || unit.mission_type === "Strike")
  );
  if (detectorUnits.length === 0) return [];

  const tracks: GameState["knownTracks"] = [];
  for (const hostile of hostileUnits) {
    if (hostile.status !== "AIRBORNE") continue;
    let detectedByUnitId: string | null = null;
    let confidence = 0;

    for (const detector of detectorUnits) {
      const range = Math.max(
        0,
        detector.sensor_range_km ?? detector.aoe_radius ?? 0
      );
      if (range <= 0) continue;
      if (!isWithinAoe(detector.lat, detector.lng, hostile.lat, hostile.lng, range)) {
        continue;
      }
      const baseConfidence = detector.detection_strength ?? 70;
      const stealthPenalty = hostile.signature ?? 35;
      confidence = Math.max(30, Math.min(100, baseConfidence - stealthPenalty + 30));
      detectedByUnitId = detector.id;
      break;
    }

    if (!detectedByUnitId) continue;
    tracks.push({
      id: `track-${hostile.id}`,
      truth_unit_id: hostile.id,
      label: `Track ${hostile.label}`,
      lat: hostile.lat,
      lng: hostile.lng,
      side: hostile.side,
      classification: "HOSTILE_AIR",
      last_seen_tick: tick,
      detected_by_unit_id: detectedByUnitId,
      confidence,
    });
  }
  return tracks;
}

function computeNextTickState(state: GameState): GameState {
  const now = Date.now();
  const nextTick = state.tick + 1;
  const launchedUnits = state.units.map((unit) => {
    if (
      unit.status === "GROUNDED" &&
      unit.deployment_status === "APPROVED" &&
      typeof unit.departure_tick === "number" &&
      unit.departure_tick <= nextTick &&
      typeof unit.target_lat === "number" &&
      typeof unit.target_lng === "number"
    ) {
      return {
        ...unit,
        status: "AIRBORNE" as const,
        current_base: null,
      };
    }
    return unit;
  });

  const movedUnits = applyMovementTick(launchedUnits);
  const movedHostileUnits = applyHostileMovementTick(state.hostileUnits);
  const firedEvents = state.events.filter((event) => event.tick === nextTick);
  const fuelStep = applyFuelTick(movedUnits, state.bases);
  const fueledHostileUnits = applyHostileFuelTick(movedHostileUnits);
  const doctrineStep = applyActiveRefuels(fuelStep.units, state.activeRefuels);
  let workingState: GameState = {
    ...state,
    tick: nextTick,
    units: doctrineStep.units,
    hostileUnits: fueledHostileUnits,
    bases: fuelStep.bases,
    activeRefuels: doctrineStep.activeRefuels,
  };

  let nextResources = workingState.resources;
  const nextInjects: GameState["injects"] = [];
  for (const event of firedEvents) {
    nextResources = applyEventInjects(nextResources, event.injects);
    for (const [resource, amount] of Object.entries(event.injects)) {
      nextInjects.push({
        id: `${now}-${event.id ?? resource}-${Math.random().toString(36).slice(2, 8)}`,
        tick: nextTick,
        resource,
        amount,
        note: event.note,
        at: new Date(now).toISOString(),
      });
    }
  }

  workingState = {
    ...workingState,
    resources: nextResources,
  };
  const eventActionStep = applyEventActions(workingState, firedEvents, nextTick, now);
  workingState = eventActionStep.state;

  const nfzStep = enforceNoFlyZones(
    workingState.hostileUnits,
    workingState.noFlyZones,
    nextTick,
    now
  );
  const airCombatStep = resolveFighterEngagements(
    workingState.units,
    nfzStep.hostileUnits,
    nextTick,
    now
  );
  const knownTracks = rebuildKnownTracks(
    airCombatStep.units,
    airCombatStep.hostileUnits,
    nextTick
  );

  return {
    ...workingState,
    units: airCombatStep.units,
    hostileUnits: airCombatStep.hostileUnits,
    knownTracks,
    injects: [
      ...airCombatStep.logs,
      ...nfzStep.logs,
      ...eventActionStep.logs,
      ...nextInjects,
      ...state.injects,
    ].slice(0, MAX_INJECT_LOGS),
    globalTension: deriveGlobalTension(nextResources, state.globalTension),
  };
}

export function useAdminTickEngine(persistEveryTicks = 50) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin";
  const { state, syncState, broadcastState, injectResponses } = useRemoteGameState();
  const stateRef = useRef(state);
  const intervalSeqRef = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    if (!isAdmin || !state.loadedFileName || state.paused) return;

    const intervalSeq = ++intervalSeqRef.current;
    const interval = window.setInterval(() => {
      const prev = stateRef.current;
      const beforeTick = prev.tick;
      const beforeInjectTopId = prev.injects[0]?.id ?? null;
      const next = computeNextTickState(prev);
      const afterInjectTopId = next.injects[0]?.id ?? null;
      const injectChanged =
        next.injects.length !== prev.injects.length ||
        beforeInjectTopId !== afterInjectTopId;
      stateRef.current = next;
      syncState(next);
      broadcastState(next);
      if (injectChanged) {
        const nextWithResponses = {
          ...next,
          injectResponses,
        } as GameState;
        void persistSimulationState(nextWithResponses);
      }
      if (next.tick > 0 && next.tick % persistEveryTicks === 0) {
        const nextWithResponses = {
          ...next,
          injectResponses,
        } as GameState;
        void persistSimulationState(nextWithResponses);
      }
    }, Math.max(100, 1000 / state.tickRate));

    return () => {
      window.clearInterval(interval);
    };
  }, [
    isAdmin,
    state.loadedFileName,
    state.paused,
    state.tickRate,
    injectResponses,
    persistEveryTicks,
    syncState,
    broadcastState,
  ]);
}
