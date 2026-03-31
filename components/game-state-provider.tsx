"use client";

import { createContext, type ReactNode, useContext, useEffect, useMemo, useReducer } from "react";

import type {
  DeploymentRequest,
  GameDefinition,
  HostileBase,
  HostileGroupDefinition,
  HostileUnit,
  InjectLog,
  InjectTrigger,
  KnownTrack,
  NoFlyZone,
  ResourceMap,
  SpawnedUnit,
} from "@/types/game";
import { normalizeScenarioStartTime } from "@/lib/simulation-time";
import { clampSimulationTickRate } from "@/lib/simulation-tick-rate";
import {
  applyFuelTick,
  applyInitialAirborne,
  resolveHoursPerTick,
  spawnUnitsFromAssets,
} from "@/lib/simulation-units";

export interface GameState {
  resources: ResourceMap;
  bases: GameDefinition["bases"];
  assets: GameDefinition["assets"];
  units: SpawnedUnit[];
  events: GameDefinition["events"];
  injects: InjectLog[];
  injectTriggers: InjectTrigger[];
  hostileBases: HostileBase[];
  hostileGroups: HostileGroupDefinition[];
  hostileUnits: HostileUnit[];
  knownTracks: KnownTrack[];
  noFlyZones: NoFlyZone[];
  tick: number;
  tickRate: number;
  /** Simulated hours per game tick (fuel and movement scale with this). */
  hoursPerTick: number;
  /** ISO 8601 UTC scenario start; simulated clock advances with tick × hoursPerTick. */
  simulationStartTimeIso: string | null;
  paused: boolean;
  status: "RUNNING" | "STOPPED" | "UNINITIALIZED";
  loadedFileName: string | null;
  error: string | null;
  globalTension: number;
  globePoints: GameDefinition["globePoints"];
  scenarioTitle?: string | null;
  deploymentRequests: DeploymentRequest[];
  activeRefuels: Array<{ tankerId: string; receiverId: string }>;
  // Additional transient maps (e.g., injectResponses) may be attached when persisted
  injectResponses?: Record<string, unknown>;
}

type Action =
  | { type: "LOAD_DEFINITION"; payload: { definition: GameDefinition; fileName: string; initialTickRate?: number } }
  | { type: "SET_TICK_RATE"; payload: number }
  | { type: "SET_GLOBAL_TENSION"; payload: number }
  | { type: "TOGGLE_PAUSED" }
  | { type: "STOP_SIMULATION" }
  | { type: "ADVANCE_TICK"; payload: number }
  | { type: "SET_ERROR"; payload: string | null };

interface GameStateContextType {
  state: GameState;
  loadDefinition: (definition: GameDefinition, fileName: string, initialTickRate?: number) => void;
  setTickRate: (tickRate: number) => void;
  setGlobalTension: (value: number) => void;
  togglePaused: () => void;
  stopSimulation: () => void;
  setError: (message: string | null) => void;
}

const MAX_INJECT_LOGS = 120;

const initialState: GameState = {
  resources: {},
  bases: [],
  assets: [],
  units: [],
  events: [],
  injects: [],
  injectTriggers: [],
  hostileBases: [],
  hostileGroups: [],
  hostileUnits: [],
  knownTracks: [],
  noFlyZones: [],
  tick: 0,
  tickRate: 1,
  hoursPerTick: 1,
  simulationStartTimeIso: null,
  paused: false,
  status: "UNINITIALIZED",
  loadedFileName: null,
  error: null,
  globalTension: 20,
  globePoints: [],
  scenarioTitle: null,
  deploymentRequests: [],
  activeRefuels: [],
};

function deriveGlobalTension(resources: ResourceMap, fallback: number): number {
  const entries = Object.entries(resources);
  let globalKey: string | undefined;
  let tensionKey: string | undefined;

  for (const [key] of entries) {
    const lower = key.toLowerCase();
    if (lower === "global tension") {
      globalKey = key;
    } else if (lower === "tension") {
      tensionKey = key;
    }
  }

  const key = globalKey ?? tensionKey;
  if (!key) return fallback;

  const raw = resources[key];
  if (typeof raw !== "number" || Number.isNaN(raw)) return fallback;

  const value = raw > 1 ? Math.round(raw) : Math.round(raw * 100);
  return Math.min(100, Math.max(0, value));
}

function applyEventInjects(resources: ResourceMap, injects: ResourceMap) {
  const next = { ...resources };
  for (const [resource, amount] of Object.entries(injects)) {
    next[resource] = (next[resource] ?? 0) + amount;
  }
  return next;
}

function withTriggerIds(triggers: InjectTrigger[] | undefined): InjectTrigger[] {
  return (triggers ?? []).map((trigger, index) => ({
    ...trigger,
    id:
      typeof trigger.id === "string" && trigger.id.trim().length > 0
        ? trigger.id
        : `inject-trigger-${index + 1}`,
  }));
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "LOAD_DEFINITION": {
      const spawnedUnits = spawnUnitsFromAssets(
        action.payload.definition.assets,
        action.payload.definition.bases
      );
      const next = {
        ...state,
        resources: action.payload.definition.resources,
        bases: action.payload.definition.bases,
        assets: action.payload.definition.assets,
        units: applyInitialAirborne(
          spawnedUnits,
          action.payload.definition.initialAirborne
        ),
        events: action.payload.definition.events,
        injects: [],
        injectTriggers: withTriggerIds(action.payload.definition.injectTriggers),
        hostileBases: action.payload.definition.hostileBases ?? [],
        hostileGroups: action.payload.definition.hostileGroups ?? [],
        hostileUnits: [],
        knownTracks: [],
        noFlyZones: action.payload.definition.noFlyZones ?? [],
        tick: 0,
        paused: false,
        status: "RUNNING" as const,
        loadedFileName: action.payload.fileName,
        error: null,
        globePoints: action.payload.definition.globePoints ?? [],
        scenarioTitle: action.payload.definition.scenarioTitle ?? null,
        deploymentRequests: [],
      };
      if (typeof action.payload.initialTickRate === "number" && action.payload.initialTickRate > 0) {
        next.tickRate = clampSimulationTickRate(action.payload.initialTickRate);
      }
      next.hoursPerTick = resolveHoursPerTick(action.payload.definition.hours_per_tick);
      next.simulationStartTimeIso = normalizeScenarioStartTime(
        action.payload.definition.scenario_start_time
      );
      next.globalTension = deriveGlobalTension(next.resources, next.globalTension);
      return next;
    }
    case "SET_GLOBAL_TENSION": {
      const clamped = Math.min(100, Math.max(0, Math.round(action.payload)));
      const resources: ResourceMap = { ...state.resources };
      const keys = Object.keys(resources);

      let globalKey: string | undefined;
      let tensionKey: string | undefined;

      for (const key of keys) {
        const lower = key.toLowerCase();
        if (lower === "global tension") {
          globalKey = key;
        } else if (lower === "tension") {
          tensionKey = key;
        }
      }

      const primaryKey = globalKey ?? tensionKey ?? "Global Tension";
      resources[primaryKey] = clamped;
      if (tensionKey && tensionKey !== primaryKey) {
        resources[tensionKey] = clamped;
      }

      return {
        ...state,
        resources,
        globalTension: clamped,
      };
    }
    case "SET_TICK_RATE":
      return {
        ...state,
        tickRate: clampSimulationTickRate(action.payload),
      };
    case "TOGGLE_PAUSED":
      return {
        ...state,
        paused: !state.paused,
        status: state.paused ? "RUNNING" : state.status,
      };
    case "STOP_SIMULATION":
      return {
        ...initialState,
        tickRate: state.tickRate,
        hoursPerTick: state.hoursPerTick,
        paused: true,
        status: "UNINITIALIZED",
        globalTension: 20,
        deploymentRequests: [],
      };
    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
      };
    case "ADVANCE_TICK": {
      const nextTick = state.tick + 1;
      const h = resolveHoursPerTick(state.hoursPerTick);
      const firedEvents = state.events.filter((event) => event.tick === nextTick);

      if (firedEvents.length === 0) {
        const fuelStep = applyFuelTick(state.units, state.bases, h);
        return {
          ...state,
          tick: nextTick,
          units: fuelStep.units,
          bases: fuelStep.bases,
          globalTension: deriveGlobalTension(state.resources, state.globalTension),
        };
      }

      const nextInjects: InjectLog[] = [];
      let nextResources = state.resources;

      for (const event of firedEvents) {
        nextResources = applyEventInjects(nextResources, event.injects);
        for (const [resource, amount] of Object.entries(event.injects)) {
          nextInjects.push({
            id: `${action.payload}-${event.id ?? resource}-${Math.random().toString(36).slice(2, 8)}`,
            tick: nextTick,
            resource,
            amount,
            note: event.note,
            at: new Date(action.payload).toISOString(),
          });
        }
      }

      const fuelStep = applyFuelTick(state.units, state.bases, h);
      return {
        ...state,
        tick: nextTick,
        resources: nextResources,
        units: fuelStep.units,
        bases: fuelStep.bases,
        injects: [...nextInjects, ...state.injects].slice(0, MAX_INJECT_LOGS),
        globalTension: deriveGlobalTension(nextResources, state.globalTension),
      };
    }
    default:
      return state;
  }
}

export const GameStateContext = createContext<GameStateContextType | null>(null);

export function GameStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (state.paused) {
      return;
    }
    const interval = window.setInterval(() => {
      dispatch({ type: "ADVANCE_TICK", payload: Date.now() });
    }, Math.max(100, 1000 / state.tickRate));

    return () => window.clearInterval(interval);
  }, [state.paused, state.tickRate]);

  const value = useMemo<GameStateContextType>(
    () => ({
      state,
      loadDefinition: (definition, fileName, initialTickRate) =>
        dispatch({ type: "LOAD_DEFINITION", payload: { definition, fileName, initialTickRate } }),
      setTickRate: (tickRate) => dispatch({ type: "SET_TICK_RATE", payload: tickRate }),
      setGlobalTension: (value) => dispatch({ type: "SET_GLOBAL_TENSION", payload: value }),
      togglePaused: () => dispatch({ type: "TOGGLE_PAUSED" }),
      stopSimulation: () => dispatch({ type: "STOP_SIMULATION" }),
      setError: (message) => dispatch({ type: "SET_ERROR", payload: message }),
    }),
    [state]
  );

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

export function useGameStateLocal() {
  const context = useContext(GameStateContext);
  if (!context) {
    throw new Error("useGameState must be used within a GameStateProvider.");
  }
  return context;
}
