"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import type {
  DeploymentMissionType,
  DeploymentRequest,
  GameDefinition,
  InjectTrigger,
} from "@/types/game";
import type { GameState } from "@/components/game-state-provider";
import {
  distanceKm,
  estimateFuelRequired,
  isWithinAoe,
  spawnUnitsFromAssets,
} from "@/lib/simulation-units";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  clearSimulationState,
  fetchSimulationState,
  persistSimulationState,
  simulationChannel,
} from "@/lib/supabase";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SIMULATION_CHANNEL = "glp_simulation_sync";
const STORAGE_KEY = "glp_session";
const BASELINE_STORAGE_KEY = "glp_definition_baseline";
const MAX_INJECT_LOGS = 120;

// ─── Default state ───────────────────────────────────────────────────────────

const defaultState: GameState = {
  resources: {},
  bases: [],
  assets: [],
  units: [],
  events: [],
  injects: [],
  injectTriggers: [],
  tick: 0,
  tickRate: 1,
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

export function buildHardResetState(): GameState {
  return {
    ...defaultState,
    assets: [],
    injectTriggers: [],
    bases: [],
    tick: 0,
    status: "UNINITIALIZED",
    globalTension: 20,
    paused: true,
    activeRefuels: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Persistence ─────────────────────────────────────────────────────────────

function saveSession(state: GameState): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        scenarioTitle: state.scenarioTitle,
        loadedFileName: state.loadedFileName,
        tick: state.tick,
        tickRate: state.tickRate,
        paused: state.paused,
        status: state.status,
        globalTension: state.globalTension,
        resources: state.resources,
        bases: state.bases,
        assets: state.assets,
        units: state.units,
        events: state.events,
        injectTriggers: state.injectTriggers,
        globePoints: state.globePoints,
        injects: state.injects,
        deploymentRequests: state.deploymentRequests,
        activeRefuels: state.activeRefuels,
      })
    );
  } catch {
    // SSR or storage quota exceeded — silently skip
  }
}

function loadSession(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (!parsed.loadedFileName) return null;
    const bases = Array.isArray(parsed.bases) ? parsed.bases : [];
    const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
    const deploymentRequests = Array.isArray(parsed.deploymentRequests)
      ? (parsed.deploymentRequests as DeploymentRequest[])
      : [];
    const units =
      Array.isArray(parsed.units) && parsed.units.length > 0
        ? parsed.units
        : spawnUnitsFromAssets(assets, bases);
    return { ...defaultState, ...parsed, bases, assets, units, deploymentRequests };
  } catch {
    return null;
  }
}

function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // SSR/private mode storage errors are non-fatal
  }
}

function saveBaseline(state: GameState): void {
  try {
    localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(serializeState(state)));
  } catch {
    // Ignore browser storage errors.
  }
}

// ─── Serialise state for BroadcastChannel ────────────────────────────────────
// Strips any non-cloneable objects (e.g. Three.js refs attached by react-globe.gl).

export function serializeState(s: GameState): GameState {
  try {
    return JSON.parse(JSON.stringify(s)) as GameState;
  } catch {
    return {
      ...defaultState,
      tick: s.tick,
      tickRate: s.tickRate,
      paused: s.paused,
      status: s.status,
      globalTension: s.globalTension,
      resources: s.resources,
      scenarioTitle: s.scenarioTitle,
      loadedFileName: s.loadedFileName,
      bases: s.bases,
      assets: s.assets,
      units: s.units,
      injectTriggers: s.injectTriggers,
      globePoints: s.globePoints.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        label: p.label,
        type: p.type,
        tick: p.tick,
      })),
      events: s.events,
      injects: s.injects,
      deploymentRequests: s.deploymentRequests,
      activeRefuels: s.activeRefuels,
      error: s.error,
    };
  }
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

function updateTensionKey(
  resources: GameState["resources"],
  clamped: number
): GameState["resources"] {
  const next = { ...resources };
  let globalKey: string | undefined;
  let tensionKey: string | undefined;
  for (const key of Object.keys(next)) {
    const lower = key.toLowerCase();
    if (lower === "global tension") globalKey = key;
    else if (lower === "tension") tensionKey = key;
  }
  const primaryKey = globalKey ?? tensionKey ?? "Global Tension";
  next[primaryKey] = clamped;
  if (tensionKey && tensionKey !== primaryKey) next[tensionKey] = clamped;
  return next;
}

function buildInjectTriggerKey(trigger: InjectTrigger): string {
  const lat = typeof trigger.lat === "number" ? trigger.lat.toFixed(4) : "na";
  const lng = typeof trigger.lng === "number" ? trigger.lng.toFixed(4) : "na";
  return `${trigger.tick}:${trigger.title ?? "inject"}:${lat}:${lng}`;
}

function findTransportInjectOnStation(
  state: GameState,
  unitId: string
): { trigger: InjectTrigger; unitIndex: number } | null {
  const unitIndex = state.units.findIndex((unit) => unit.id === unitId);
  if (unitIndex < 0) return null;
  const unit = state.units[unitIndex];
  if (unit.role !== "TRANSPORT" || unit.status !== "AIRBORNE") return null;
  const radius = Math.max(0, unit.aoe_radius ?? 0);
  if (radius <= 0) return null;

  const completed = new Set(unit.completed_inject_ids ?? []);
  for (const trigger of state.injectTriggers) {
    if (
      trigger.tick > state.tick ||
      trigger.map_visible === false ||
      typeof trigger.lat !== "number" ||
      typeof trigger.lng !== "number"
    ) {
      continue;
    }
    const triggerKey = buildInjectTriggerKey(trigger);
    if (completed.has(triggerKey)) continue;
    if (isWithinAoe(unit.lat, unit.lng, trigger.lat, trigger.lng, radius)) {
      return { trigger, unitIndex };
    }
  }
  return null;
}

// ─── Inject response types ────────────────────────────────────────────────────

export interface InjectResponseRecord {
  status: "pending";
  responseType: "MFR" | "COA";
  content: string;
  submittedAt: string;
}

type PersistedStateWithResponses = GameState & {
  injectResponses?: Record<string, InjectResponseRecord>;
};

// ─── Context type ─────────────────────────────────────────────────────────────

export interface RemoteGameStateContextType {
  state: GameState;
  selectedUnitId: string | null;
  setSelectedUnitId: (unitId: string | null) => void;
  /** Admin: push current state to all other same-browser tabs via BroadcastChannel */
  broadcastState: (s: GameState) => void;
  /** Admin: send an immediate hard reset signal to all other tabs */
  broadcastHardReset: () => void;
  /** Dashboard: accept an incoming STATE_UPDATE payload and overwrite local state */
  syncState: (incoming: GameState) => void;
  /**
   * Register a listener for STATE_UPDATE BroadcastChannel messages.
   * Returns a cleanup function — use as the return value of useEffect.
   */
  subscribeToBroadcast: (cb: (s: GameState) => void) => () => void;
  loadDefinition: (
    definition: GameDefinition,
    fileName: string,
    initialTickRate?: number
  ) => void;
  setTickRate: (tickRate: number) => void;
  setGlobalTension: (value: number) => void;
  togglePaused: () => void;
  stopSimulation: () => void;
  setError: (message: string | null) => void;
  /** Explicit setters used for deterministic hard-reset handling on client views. */
  setAssets: (assets: GameState["assets"]) => void;
  setInjects: (injects: GameState["injects"]) => void;
  setBases: (bases: GameState["bases"]) => void;
  setCurrentTick: (tick: number) => void;
  updateInjectEventTick: (id: string, tick: number) => Promise<boolean>;
  triggerInjectEventNow: (id: string) => Promise<boolean>;
  /** Cadet response submissions keyed by triggerId ("tick-title") */
  injectResponses: Record<string, InjectResponseRecord>;
  /** Cadet: submit a response to an inject trigger; broadcasts to all tabs */
  submitInjectResponse: (
    triggerId: string,
    responseType: "MFR" | "COA",
    content: string
  ) => void;
  submitDeploymentRequest: (request: {
    unitId: string;
    targetLat: number;
    targetLng: number;
    departureTick: number;
    missionType: DeploymentMissionType;
  }) => Promise<boolean>;
  decideDeploymentRequest: (
    requestId: string,
    decision: "approve" | "deny"
  ) => Promise<boolean>;
  initiateRefuel: (unitId: string) => Promise<boolean>;
  executeMission: (unitId: string) => Promise<boolean>;
}

export const RemoteGameStateContext =
  createContext<RemoteGameStateContextType | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function RemoteGameStateProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAdminPath = pathname === "/admin";
  const [state, setState] = useState<GameState>(defaultState);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [injectResponses, setInjectResponses] = useState<
    Record<string, InjectResponseRecord>
  >({});

  // Always up-to-date ref so callbacks don't close over stale state
  const stateRef = useRef<GameState>(state);
  stateRef.current = state;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const externalBroadcastListenersRef = useRef(new Set<(s: GameState) => void>());

  // ── Utilities ─────────────────────────────────────────────────────────────

  const setStateAndPersist = useCallback(
    (updater: (s: GameState) => GameState) => {
      setState((prev) => {
        const next = updater(prev);
        stateRef.current = next;
        saveSession(next);
        return next;
      });
    },
    []
  );

  const applyHardResetLocal = useCallback(() => {
    const next = buildHardResetState();
    clearSession();
    stateRef.current = next;
    setSelectedUnitId(null);
    setInjectResponses({});
    setState(next);
  }, []);

  const sendBroadcast = useCallback(
    async (event: string, payload: unknown) => {
      if (!channelRef.current) return;
      await channelRef.current.send({
        type: "broadcast",
        event,
        payload,
      });
    },
    []
  );

  const persistAndPublish = useCallback(
    async (next: GameState, event = "tick_update") => {
      const snapshot = serializeState(next);
      const snapshotWithResponses = {
        ...snapshot,
        injectResponses,
      } as PersistedStateWithResponses;
      stateRef.current = snapshot;
      setState(snapshot);
      saveSession(snapshot);
      await Promise.allSettled([
        persistSimulationState(snapshotWithResponses),
        sendBroadcast(event, snapshot),
      ]);
    },
    [injectResponses, sendBroadcast]
  );

  const broadcastState = useCallback(
    (s: GameState) => {
      void sendBroadcast("tick_update", serializeState(s));
    },
    [sendBroadcast]
  );

  const broadcastHardReset = useCallback(() => {
    const next = buildHardResetState();
    applyHardResetLocal();
    void Promise.allSettled([
      clearSimulationState(),
      persistSimulationState({
        ...next,
        injectResponses: {},
      } as PersistedStateWithResponses),
      sendBroadcast("hard_reset", next),
    ]);
  }, [applyHardResetLocal, sendBroadcast]);

  /** Replace local state with an incoming broadcast payload. */
  const syncState = useCallback((incoming: GameState) => {
    const current = stateRef.current;
    const isSameScenario = incoming.loadedFileName === current.loadedFileName;
    const isStaleRunningTick =
      incoming.status === "RUNNING" &&
      current.status === "RUNNING" &&
      isSameScenario &&
      incoming.tick < current.tick;

    if (isStaleRunningTick) return;
    const next = serializeState(incoming);
    stateRef.current = next;
    saveSession(next);
    setState(next);
  }, []);

  /**
   * Register a message listener on the shared channel.
   * Returns a cleanup function suitable for useEffect's return.
   */
  const subscribeToBroadcast = useCallback(
    (cb: (s: GameState) => void): (() => void) => {
      externalBroadcastListenersRef.current.add(cb);
      return () => externalBroadcastListenersRef.current.delete(cb);
    },
    []
  );

  // ── Mount: Supabase Realtime + local fallback hydration ───────────────────

  useEffect(() => {
    const savedSession = loadSession();
    if (savedSession) {
      stateRef.current = savedSession;
      setState(savedSession);
    }

    let mounted = true;
    const ch = simulationChannel("simulation")
      .on("broadcast", { event: "tick_update" }, ({ payload }) => {
        const incoming = payload as GameState;
        if (!incoming || typeof incoming !== "object") return;
        const shouldIgnoreAdminEcho =
          isAdminPath &&
          stateRef.current.status === "RUNNING" &&
          !stateRef.current.paused &&
          incoming.status === "RUNNING";
        if (shouldIgnoreAdminEcho) return;
        syncState(incoming);
        externalBroadcastListenersRef.current.forEach((cb) => cb(incoming));
      })
      .on("broadcast", { event: "hard_reset" }, ({ payload }) => {
        const incoming = payload as GameState | null;
        if (incoming) {
          syncState(incoming);
        } else {
          applyHardResetLocal();
        }
      })
      .on("broadcast", { event: "response_submitted" }, ({ payload }) => {
        const r = payload as {
          triggerId: string;
          responseType: "MFR" | "COA";
          content: string;
          submittedAt: string;
        };
        setInjectResponses((prev) => ({
          ...prev,
          [r.triggerId]: {
            status: "pending",
            responseType: r.responseType,
            content: r.content,
            submittedAt: r.submittedAt,
          },
        }));
      })
      .on("broadcast", { event: "deployment_request" }, ({ payload }) => {
        const request = payload as DeploymentRequest;
        if (request?.id) {
          setStateAndPersist((prev) => {
            const exists = prev.deploymentRequests.some((r) => r.id === request.id);
            if (exists) return prev;
            return {
              ...prev,
              deploymentRequests: [request, ...prev.deploymentRequests],
            };
          });
        }
      });

    channelRef.current = ch;
    ch.subscribe();

    void fetchSimulationState()
      .then((dbState) => {
        if (!mounted || !dbState || !dbState.loadedFileName) return;
        const hydrated = serializeState(dbState);
        stateRef.current = hydrated;
        saveSession(hydrated);
        setState(hydrated);
      })
      .catch(() => {
        // Supabase unavailable; local fallback state remains active.
      });

    return () => {
      mounted = false;
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [applyHardResetLocal, isAdminPath, setStateAndPersist, syncState]);

  // ── Public actions ────────────────────────────────────────────────────────

  const loadDefinition = useCallback(
    async (
      definition: GameDefinition,
      fileName: string,
      initialTickRate?: number
    ) => {
      const next: GameState = {
        ...defaultState,
        scenarioTitle: definition.scenarioTitle ?? null,
        loadedFileName: fileName,
        resources: definition.resources,
        bases: definition.bases,
        assets: definition.assets,
        units: spawnUnitsFromAssets(definition.assets, definition.bases),
        events: definition.events,
        injectTriggers: definition.injectTriggers ?? [],
        globePoints: definition.globePoints ?? [],
        globalTension: deriveGlobalTension(
          definition.resources,
          defaultState.globalTension
        ),
        tickRate:
          typeof initialTickRate === "number" && initialTickRate >= 1
            ? Math.min(10, Math.max(1, Math.round(initialTickRate)))
            : 1,
        tick: 0,
        paused: false,
        status: "RUNNING",
        deploymentRequests: [],
        activeRefuels: [],
      };

      saveBaseline(next);
      await persistAndPublish(next, "tick_update");
    },
    [persistAndPublish]
  );

  const setTickRate = useCallback(
    (tickRate: number) => {
      setStateAndPersist((s) => {
        const clampedRate = Math.min(10, Math.max(1, Math.round(tickRate)));
        const next = { ...s, tickRate: clampedRate };
        void persistSimulationState({
          ...next,
          injectResponses,
        } as PersistedStateWithResponses);
        void sendBroadcast("tick_update", next);
        return next;
      });
    },
    [injectResponses, sendBroadcast, setStateAndPersist]
  );

  const setGlobalTension = useCallback(
    (value: number) => {
      setStateAndPersist((s) => {
        const clamped = Math.min(100, Math.max(0, Math.round(value)));
        const next = {
          ...s,
          resources: updateTensionKey(s.resources, clamped),
          globalTension: clamped,
        };
        void persistSimulationState({
          ...next,
          injectResponses,
        } as PersistedStateWithResponses);
        void sendBroadcast("tick_update", next);
        return next;
      });
    },
    [injectResponses, sendBroadcast, setStateAndPersist]
  );

  const togglePaused = useCallback(() => {
    setStateAndPersist((s) => {
      const nextPaused = !s.paused;
      const next = {
        ...s,
        paused: nextPaused,
        status: (nextPaused ? "STOPPED" : "RUNNING") as GameState["status"],
      };
      void persistSimulationState({
        ...next,
        injectResponses,
      } as PersistedStateWithResponses);
      void sendBroadcast("tick_update", next);
      return next;
    });
  }, [injectResponses, sendBroadcast, setStateAndPersist]);

  const stopSimulation = useCallback(async () => {
    const next = buildHardResetState();

    stateRef.current = next;
    saveSession(next);
    setState(next);
    setInjectResponses({});
    await Promise.allSettled([
      clearSimulationState(),
      persistSimulationState({
        ...next,
        injectResponses: {},
      } as PersistedStateWithResponses),
      sendBroadcast("hard_reset", next),
    ]);
  }, [sendBroadcast]);

  const setError = useCallback((message: string | null) => {
    setState((s) => ({ ...s, error: message }));
  }, []);

  const setAssets = useCallback((assets: GameState["assets"]) => {
    setState((s) => ({ ...s, assets }));
  }, []);

  const setInjects = useCallback((injects: GameState["injects"]) => {
    setState((s) => ({ ...s, injects }));
  }, []);

  const setBases = useCallback((bases: GameState["bases"]) => {
    setState((s) => ({ ...s, bases }));
  }, []);

  const setCurrentTick = useCallback((tick: number) => {
    const nextTick = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
    setState((s) => ({ ...s, tick: nextTick }));
  }, []);

  const updateInjectEventTick = useCallback(
    async (id: string, tick: number) => {
      if (!id || !Number.isInteger(tick) || tick < 1) return false;
      const next = {
        ...stateRef.current,
        events: stateRef.current.events.map((event) =>
          event.id === id ? { ...event, tick } : event
        ),
      };
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const triggerInjectEventNow = useCallback(
    async (id: string) => {
      const event = stateRef.current.events.find((e) => e.id === id);
      if (!event) return false;

      const now = Date.now();
      const currentTick = stateRef.current.tick;
      const nextResources = applyEventInjects(stateRef.current.resources, event.injects);
      const logs = Object.entries(event.injects).map(([resource, amount]) => ({
        id: `manual-${now}-${event.id ?? resource}-${Math.random().toString(36).slice(2, 8)}`,
        tick: currentTick,
        resource,
        amount,
        note: event.note,
        at: new Date(now).toISOString(),
      }));
      const next = {
        ...stateRef.current,
        resources: nextResources,
        injects: [...logs, ...stateRef.current.injects].slice(0, MAX_INJECT_LOGS),
        globalTension: deriveGlobalTension(
          nextResources,
          stateRef.current.globalTension
        ),
      };
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const submitInjectResponse = useCallback(
    (triggerId: string, responseType: "MFR" | "COA", content: string) => {
      const submittedAt = new Date().toISOString();
      const record: InjectResponseRecord = {
        status: "pending",
        responseType,
        content,
        submittedAt,
      };
      setInjectResponses((prev) => ({ ...prev, [triggerId]: record }));
      const nextForPersistence = {
        ...stateRef.current,
        injectResponses: {
          ...((stateRef.current as GameState & { injectResponses?: unknown }).injectResponses as
            | Record<string, InjectResponseRecord>
            | undefined),
          [triggerId]: record,
        },
      } as GameState;
      void persistSimulationState(nextForPersistence);
      void sendBroadcast("response_submitted", {
        triggerId,
        responseType,
        content,
        submittedAt,
      });
    },
    [sendBroadcast]
  );

  const submitDeploymentRequest = useCallback(
    async (request: {
      unitId: string;
      targetLat: number;
      targetLng: number;
      departureTick: number;
      missionType: DeploymentMissionType;
    }) => {
      const current = stateRef.current;
      if (
        !request.unitId ||
        !Number.isFinite(request.targetLat) ||
        !Number.isFinite(request.targetLng) ||
        !Number.isFinite(request.departureTick)
      ) {
        return false;
      }

      const departureTick = Math.max(1, Math.floor(request.departureTick));
      const unit = current.units.find((u) => u.id === request.unitId);
      if (!unit || unit.status !== "GROUNDED") return false;

      const alreadyPending = current.deploymentRequests.some(
        (req) => req.unit_id === request.unitId && req.status === "PENDING_APPROVAL"
      );
      if (alreadyPending) return false;

      const deployment: DeploymentRequest = {
        id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        unit_id: unit.id,
        asset_id: unit.asset_id,
        unit_label: unit.label,
        mission_type: request.missionType,
        target_lat: request.targetLat,
        target_lng: request.targetLng,
        departure_tick: departureTick,
        estimated_fuel_required: estimateFuelRequired(
          unit,
          request.targetLat,
          request.targetLng
        ),
        requested_by: "CADET",
        requested_at: new Date().toISOString(),
        status: "PENDING_APPROVAL",
      };

      const next: GameState = {
        ...current,
        units: current.units.map((u) =>
          u.id === request.unitId
            ? {
                ...u,
                status: "PENDING_APPROVAL",
                deployment_status: "PENDING_APPROVAL",
                mission_type: request.missionType,
              }
            : u
        ),
        deploymentRequests: [deployment, ...current.deploymentRequests],
      };
      await persistAndPublish(next, "tick_update");
      void sendBroadcast("deployment_request", deployment);
      return true;
    },
    [persistAndPublish, sendBroadcast]
  );

  const decideDeploymentRequest = useCallback(
    async (requestId: string, decision: "approve" | "deny") => {
      const req = stateRef.current.deploymentRequests.find((r) => r.id === requestId);
      if (!req || req.status !== "PENDING_APPROVAL") return false;

      const decidedAt = new Date().toISOString();
      const nextRequests = stateRef.current.deploymentRequests.map((r) =>
        r.id === requestId
          ? {
              ...r,
              status:
                decision === "approve"
                  ? ("APPROVED" as const)
                  : ("DENIED" as const),
              decided_at: decidedAt,
              decided_by: "ADMIN" as const,
            }
          : r
      );

      const nextUnits = stateRef.current.units.map((u) => {
        if (u.id !== req.unit_id) return u;
        if (decision === "approve") {
          return {
            ...u,
            status: "GROUNDED" as const,
            deployment_status: "APPROVED" as const,
            mission_type: req.mission_type,
            target_lat: req.target_lat,
            target_lng: req.target_lng,
            departure_tick: req.departure_tick,
          };
        }
        return {
          ...u,
          status: "GROUNDED" as const,
          deployment_status: undefined,
          mission_type: undefined,
        };
      });

      const next = {
        ...stateRef.current,
        units: nextUnits,
        deploymentRequests: nextRequests,
      };
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const initiateRefuel = useCallback(
    async (receiverId: string) => {
      const receiver = stateRef.current.units.find((unit) => unit.id === receiverId);
      if (!receiver || receiver.status !== "AIRBORNE") return false;

      const candidateTankers = stateRef.current.units.filter((unit) => {
        if (
          unit.id === receiver.id ||
          unit.status !== "AIRBORNE" ||
          unit.role !== "TANKER"
        ) {
          return false;
        }
        const radius = Math.max(0, unit.aoe_radius ?? 0);
        if (
          radius <= 0 ||
          (unit.transfer_rate ?? 0) <= 0 ||
          unit.current_fuel <= 0
        ) {
          return false;
        }
        return isWithinAoe(unit.lat, unit.lng, receiver.lat, receiver.lng, radius);
      });

      if (candidateTankers.length === 0) return false;
      const tanker = candidateTankers.reduce((closest, current) => {
        const closestDistance = distanceKm(
          closest.lat,
          closest.lng,
          receiver.lat,
          receiver.lng
        );
        const currentDistance = distanceKm(
          current.lat,
          current.lng,
          receiver.lat,
          receiver.lng
        );
        return currentDistance < closestDistance ? current : closest;
      });

      const nextRefuels = stateRef.current.activeRefuels.filter(
        (link) =>
          link.receiverId !== receiver.id &&
          !(link.receiverId === receiver.id && link.tankerId === tanker.id)
      );
      nextRefuels.unshift({ tankerId: tanker.id, receiverId: receiver.id });

      const next = {
        ...stateRef.current,
        activeRefuels: nextRefuels,
      };
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const executeMission = useCallback(
    async (unitId: string) => {
      const result = findTransportInjectOnStation(stateRef.current, unitId);
      if (!result) return false;

      const { trigger, unitIndex } = result;
      const unit = stateRef.current.units[unitIndex];
      const triggerKey = buildInjectTriggerKey(trigger);
      const completedIds = Array.isArray(unit.completed_inject_ids)
        ? unit.completed_inject_ids
        : [];
      if (completedIds.includes(triggerKey)) return false;

      const now = Date.now();
      const note = `${unit.label} on station for ${trigger.title ?? "active inject"}`;
      const missionLog = {
        id: `mission-${now}-${unit.id}-${Math.random().toString(36).slice(2, 8)}`,
        tick: stateRef.current.tick,
        resource: "mission",
        amount: 1,
        note,
        at: new Date(now).toISOString(),
      };

      const nextUnits = stateRef.current.units.map((u) =>
        u.id === unit.id
          ? {
              ...u,
              completed_inject_ids: [...completedIds, triggerKey],
            }
          : u
      );

      const next = {
        ...stateRef.current,
        units: nextUnits,
        injects: [missionLog, ...stateRef.current.injects].slice(0, MAX_INJECT_LOGS),
      };
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo<RemoteGameStateContextType>(
    () => ({
      state,
      selectedUnitId,
      setSelectedUnitId,
      broadcastState,
      broadcastHardReset,
      syncState,
      subscribeToBroadcast,
      loadDefinition,
      setTickRate,
      setGlobalTension,
      togglePaused,
      stopSimulation,
      setError,
      setAssets,
      setInjects,
      setBases,
      setCurrentTick,
      updateInjectEventTick,
      triggerInjectEventNow,
      injectResponses,
      submitInjectResponse,
      submitDeploymentRequest,
      decideDeploymentRequest,
      initiateRefuel,
      executeMission,
    }),
    [
      state,
      selectedUnitId,
      setSelectedUnitId,
      broadcastState,
      broadcastHardReset,
      syncState,
      subscribeToBroadcast,
      loadDefinition,
      setTickRate,
      setGlobalTension,
      togglePaused,
      stopSimulation,
      setError,
      setAssets,
      setInjects,
      setBases,
      setCurrentTick,
      updateInjectEventTick,
      triggerInjectEventNow,
      injectResponses,
      submitInjectResponse,
      submitDeploymentRequest,
      decideDeploymentRequest,
      initiateRefuel,
      executeMission,
    ]
  );

  return (
    <RemoteGameStateContext.Provider value={value}>
      {children}
    </RemoteGameStateContext.Provider>
  );
}

export function useRemoteGameState() {
  const ctx = useContext(RemoteGameStateContext);
  if (!ctx)
    throw new Error(
      "useRemoteGameState must be used within RemoteGameStateProvider."
    );
  return ctx;
}
