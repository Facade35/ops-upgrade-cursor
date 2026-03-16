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
import type {
  DeploymentMissionType,
  DeploymentRequest,
  GameDefinition,
} from "@/types/game";
import type { GameState } from "@/components/game-state-provider";
import { spawnUnitsFromAssets } from "@/lib/simulation-units";

// ─── Constants ───────────────────────────────────────────────────────────────

export const SIMULATION_CHANNEL = "glp_simulation_sync";
const STORAGE_KEY = "glp_session";

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
      error: s.error,
    };
  }
}

// ─── Inject response types ────────────────────────────────────────────────────

export interface InjectResponseRecord {
  status: "pending";
  responseType: "MFR" | "COA";
  content: string;
  submittedAt: string;
}

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
  const [state, setState] = useState<GameState>(defaultState);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [injectResponses, setInjectResponses] = useState<
    Record<string, InjectResponseRecord>
  >({});

  // Always up-to-date ref so callbacks don't close over stale state
  const stateRef = useRef<GameState>(state);
  stateRef.current = state;

  const channelRef = useRef<BroadcastChannel | null>(null);

  // ── Utilities ─────────────────────────────────────────────────────────────

  const setStateAndPersist = useCallback(
    (updater: (s: GameState) => GameState) => {
      setState((prev) => {
        const next = updater(prev);
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

  /** Serialize + postMessage on glp_simulation_sync (same-browser fast path). */
  const broadcastState = useCallback((s: GameState) => {
    if (!channelRef.current) return;
    channelRef.current.postMessage({
      type: "STATE_UPDATE",
      payload: serializeState(s),
    });
  }, []);

  const broadcastHardReset = useCallback(() => {
    if (!channelRef.current) return;
    channelRef.current.postMessage({ type: "HARD_RESET" });
  }, []);

  /** Replace local state with an incoming broadcast payload. */
  const syncState = useCallback((incoming: GameState) => {
    setState(incoming);
  }, []);

  /**
   * Register a message listener on the shared channel.
   * Returns a cleanup function suitable for useEffect's return.
   */
  const subscribeToBroadcast = useCallback(
    (cb: (s: GameState) => void): (() => void) => {
      const ch = channelRef.current;
      if (!ch) return () => {};
      const handler = (e: MessageEvent) => {
        const msg = e.data as { type: string; payload: GameState };
        if (msg.type === "STATE_UPDATE") cb(msg.payload);
      };
      ch.addEventListener("message", handler);
      return () => ch.removeEventListener("message", handler);
    },
    []
  );

  // ── Mount: BroadcastChannel + localStorage hydration ──────────────────────
  // The STATE_UPDATE listener lives here — at channel-creation time — so it is
  // active on BOTH /admin and /dashboard immediately on mount.
  // (React fires child useEffects before parent useEffects; if a page tried to
  //  call subscribeToBroadcast the channel would still be null at that point.)

  useEffect(() => {
    const ch = new BroadcastChannel(SIMULATION_CHANNEL);
    channelRef.current = ch;

    // Apply any incoming same-browser broadcast immediately for every role.
    // BroadcastChannel never fires for the sender's own tab, so the admin
    // window cannot overwrite itself with its own broadcasts.
    const handleBroadcast = (e: MessageEvent) => {
      const msg = e.data as { type: string; payload: unknown };
      if (msg.type === "STATE_UPDATE") {
        setState(msg.payload as GameState);
      } else if (msg.type === "SIM_STATUS") {
        const payload = msg.payload as { status?: string };
        if (payload.status === "STOPPED") {
          setState((prev) => ({ ...prev, paused: true, status: "STOPPED" }));
          console.info("[STATE SYNC] Received STOPPED status broadcast.");
        }
      } else if (msg.type === "HARD_RESET") {
        applyHardResetLocal();
        console.info("[STATE SYNC] Received HARD_RESET broadcast.");
      } else if (msg.type === "RESPONSE_SUBMITTED") {
        const r = msg.payload as {
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
      } else if (msg.type === "DEPLOYMENT_REQUEST") {
        const payload = msg.payload as DeploymentRequest;
        if (payload?.id) {
          setState((prev) => {
            const exists = prev.deploymentRequests.some((r) => r.id === payload.id);
            if (exists) return prev;
            return {
              ...prev,
              deploymentRequests: [payload, ...prev.deploymentRequests],
            };
          });
        }
      }
    };
    ch.addEventListener("message", handleBroadcast);

    // Hydrate from localStorage on first load (both admin refresh and cadet cold-load)
    const saved = loadSession();
    if (saved) setState(saved);

    return () => {
      ch.removeEventListener("message", handleBroadcast);
      ch.close();
      channelRef.current = null;
    };
  }, [applyHardResetLocal]);

  // ── SSE: cross-window, cross-device authoritative sync ────────────────────
  // BroadcastChannel only reaches tabs within the same browser on the same
  // machine. EventSource connects to the server's tick stream so every window
  // on every device on the network receives the authoritative state in
  // real-time — including the admin's own display after each control action.
  //
  // The server never fires for paused or empty state — it always reflects the
  // true simulation store, so we apply it unconditionally when it carries a
  // loaded scenario. If the server has nothing loaded (e.g. after a restart)
  // we preserve local state rather than blanking the UI.

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/stream");

      es.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as GameState;
          setState((prev) => {
            // Server has an active scenario → always authoritative
            if (data.loadedFileName) {
              saveSession(data);
              return data;
            }
            // Server has no scenario (e.g. cold start / restart) →
            // keep local state so the admin doesn't lose their view.
            if (prev.loadedFileName) return prev;
            return data;
          });
        } catch {
          // ignore malformed SSE frames
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        // Native EventSource auto-reconnects, but we also schedule a manual
        // retry so a server restart is recovered quickly.
        retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, []);

  // ── Public actions ────────────────────────────────────────────────────────
  // Every admin action follows the same pattern:
  //   1. Optimistic local setState → instant UI feedback on the admin tab.
  //   2. POST to the server API → server updates its store + SSE fans out to
  //      every connected window (other browsers, other devices, other tabs).

  const loadDefinition = useCallback(
    async (
      definition: GameDefinition,
      fileName: string,
      initialTickRate?: number
    ) => {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition, fileName, initialTickRate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, error: data.error ?? "Upload failed" }));
        console.error("[ERROR] Upload failed.", data.error ?? "Upload failed");
        return;
      }

      // Optimistic local update — SSE delivers the authoritative state shortly after.
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
      };

      stateRef.current = next;
      setState(next);
      saveSession(next);
    },
    []
  );

  const setTickRate = useCallback(
    (tickRate: number) => {
      setStateAndPersist((s) => ({ ...s, tickRate }));
      fetch("/api/admin/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickRate }),
      }).catch(() => {
        console.error("[ERROR] Failed to update tick rate.");
      });
    },
    [setStateAndPersist]
  );

  const setGlobalTension = useCallback(
    (value: number) => {
      setStateAndPersist((s) => {
        const clamped = Math.min(100, Math.max(0, Math.round(value)));
        const nextResources = { ...s.resources };
        let globalKey: string | undefined;
        let tensionKey: string | undefined;
        for (const key of Object.keys(nextResources)) {
          const lower = key.toLowerCase();
          if (lower === "global tension") globalKey = key;
          else if (lower === "tension") tensionKey = key;
        }
        const primaryKey = globalKey ?? tensionKey ?? "Global Tension";
        nextResources[primaryKey] = clamped;
        if (tensionKey && tensionKey !== primaryKey)
          nextResources[tensionKey] = clamped;
        return { ...s, resources: nextResources, globalTension: clamped };
      });
      fetch("/api/admin/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalTension: value }),
      }).catch(() => {
        console.error("[ERROR] Failed to update global tension.");
      });
    },
    [setStateAndPersist]
  );

  const togglePaused = useCallback(() => {
    const next = !stateRef.current.paused;
    setStateAndPersist((s) => ({ ...s, paused: next, status: next ? s.status : "RUNNING" }));
    fetch("/api/admin/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: next }),
    }).catch(() => {
      console.error("[ERROR] Failed to update pause state.");
    });
  }, [setStateAndPersist]);

  const stopSimulation = useCallback(() => {
    applyHardResetLocal();
    broadcastHardReset();
    fetch("/api/admin/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stop: true }),
    }).catch(() => {
      console.error("[ERROR] Failed to stop simulation.");
    });
  }, [applyHardResetLocal, broadcastHardReset]);

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
      // Broadcast to all other same-browser tabs (admin sees it immediately)
      channelRef.current?.postMessage({
        type: "RESPONSE_SUBMITTED",
        payload: { triggerId, responseType, content, submittedAt },
      });
    },
    []
  );

  const submitDeploymentRequest = useCallback(
    async (request: {
      unitId: string;
      targetLat: number;
      targetLng: number;
      departureTick: number;
      missionType: DeploymentMissionType;
    }) => {
      try {
        const res = await fetch("/api/admin/deployments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "request",
            unitId: request.unitId,
            targetLat: request.targetLat,
            targetLng: request.targetLng,
            departureTick: request.departureTick,
            missionType: request.missionType,
          }),
        });
        if (!res.ok) return false;
        const data = (await res.json().catch(() => ({}))) as {
          state?: GameState;
          request?: DeploymentRequest;
        };
        if (data.state) setState(data.state);
        if (data.request) {
          channelRef.current?.postMessage({
            type: "DEPLOYMENT_REQUEST",
            payload: data.request,
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const decideDeploymentRequest = useCallback(
    async (requestId: string, decision: "approve" | "deny") => {
      try {
        const res = await fetch("/api/admin/deployments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: decision,
            requestId,
          }),
        });
        if (!res.ok) return false;
        const data = (await res.json().catch(() => ({}))) as {
          state?: GameState;
        };
        if (data.state) setState(data.state);
        channelRef.current?.postMessage({
          type: "DEPLOYMENT_DECISION",
          payload: { requestId, decision },
        });
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const initiateRefuel = useCallback(async (unitId: string) => {
    try {
      const res = await fetch("/api/admin/doctrine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "initiate_refuel",
          unitId,
        }),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => ({}))) as {
        state?: GameState;
      };
      if (data.state) setState(data.state);
      return true;
    } catch {
      return false;
    }
  }, []);

  const executeMission = useCallback(async (unitId: string) => {
    try {
      const res = await fetch("/api/admin/doctrine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "execute_mission",
          unitId,
        }),
      });
      if (!res.ok) return false;
      const data = (await res.json().catch(() => ({}))) as {
        state?: GameState;
      };
      if (data.state) setState(data.state);
      return true;
    } catch {
      return false;
    }
  }, []);

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
