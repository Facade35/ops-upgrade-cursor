"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import type { GameState } from "@/components/game-state-provider";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import {
  applyFuelTick,
  applyMovementTick,
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
  const firedEvents = state.events.filter((event) => event.tick === nextTick);
  const fuelStep = applyFuelTick(movedUnits, state.bases);
  const doctrineStep = applyActiveRefuels(fuelStep.units, state.activeRefuels);

  if (firedEvents.length === 0) {
    return {
      ...state,
      tick: nextTick,
      units: doctrineStep.units,
      bases: fuelStep.bases,
      activeRefuels: doctrineStep.activeRefuels,
      globalTension: deriveGlobalTension(state.resources, state.globalTension),
    };
  }

  let nextResources = state.resources;
  const nextInjects = [];
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

  return {
    ...state,
    tick: nextTick,
    resources: nextResources,
    units: doctrineStep.units,
    bases: fuelStep.bases,
    injects: [...nextInjects, ...state.injects].slice(0, MAX_INJECT_LOGS),
    activeRefuels: doctrineStep.activeRefuels,
    globalTension: deriveGlobalTension(nextResources, state.globalTension),
  };
}

export function useAdminTickEngine(persistEveryTicks = 50) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin";
  const { state, syncState, broadcastState } = useRemoteGameState();
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!isAdmin || !state.loadedFileName || state.paused) return;

    const interval = window.setInterval(() => {
      const next = computeNextTickState(stateRef.current);
      stateRef.current = next;
      syncState(next);
      broadcastState(next);
      if (next.tick > 0 && next.tick % persistEveryTicks === 0) {
        void persistSimulationState(next);
      }
    }, Math.max(100, 1000 / state.tickRate));

    return () => window.clearInterval(interval);
  }, [
    isAdmin,
    state.loadedFileName,
    state.paused,
    state.tickRate,
    persistEveryTicks,
    syncState,
    broadcastState,
  ]);
}
