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
  EvalContext,
  EventAction,
  GameDefinition,
  HostileGroupDefinition,
  HostileUnit,
  InjectKind,
  InjectResponseRequirement,
  InjectProposal,
  InjectTrigger,
  NoFlyZone,
  EvaluationGrade,
  GradingStrictness,
  Side,
} from "@/types/game";
import type { GameState } from "@/components/game-state-provider";
import {
  applyInitialAirborne,
  distanceKm,
  estimateFuelRequired,
  isPlayerTaskableUnit,
  isWithinAoe,
  resolveHoursPerTick,
  spawnUnitsFromAssets,
} from "@/lib/simulation-units";
import { normalizeScenarioStartTime, simulationTimeIsoToTick } from "@/lib/simulation-time";
import { clampSimulationTickRate } from "@/lib/simulation-tick-rate";
import { isExplicitAirSidc } from "@/lib/sidc-symbol-set";
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

function createEntityId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Default state ───────────────────────────────────────────────────────────

const defaultState: GameState = {
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

export function buildHardResetState(): GameState {
  return {
    ...defaultState,
    assets: [],
    injectTriggers: [],
    bases: [],
    hostileBases: [],
    hostileGroups: [],
    hostileUnits: [],
    knownTracks: [],
    noFlyZones: [],
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
        hoursPerTick: state.hoursPerTick,
        simulationStartTimeIso: state.simulationStartTimeIso,
        paused: state.paused,
        status: state.status,
        globalTension: state.globalTension,
        resources: state.resources,
        bases: state.bases,
        assets: state.assets,
        units: state.units,
        events: state.events,
        injectTriggers: state.injectTriggers,
        hostileBases: state.hostileBases,
        hostileGroups: state.hostileGroups,
        hostileUnits: state.hostileUnits,
        knownTracks: state.knownTracks,
        noFlyZones: state.noFlyZones,
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
      hoursPerTick: s.hoursPerTick ?? 1,
      simulationStartTimeIso: s.simulationStartTimeIso ?? null,
      paused: s.paused,
      status: s.status,
      globalTension: s.globalTension,
      resources: s.resources,
      scenarioTitle: s.scenarioTitle,
      loadedFileName: s.loadedFileName,
      bases: s.bases,
      assets: s.assets,
      units: s.units,
      hostileBases: s.hostileBases,
      hostileGroups: s.hostileGroups,
      hostileUnits: s.hostileUnits,
      knownTracks: s.knownTracks,
      noFlyZones: s.noFlyZones,
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

function withTriggerIds(triggers: InjectTrigger[] | undefined): InjectTrigger[] {
  return (triggers ?? []).map((trigger, index) => ({
    ...trigger,
    strictness: trigger.strictness ?? "BALANCED",
    id:
      typeof trigger.id === "string" && trigger.id.trim().length > 0
        ? trigger.id
        : `inject-trigger-${index + 1}`,
  }));
}

function buildInjectTriggerKey(trigger: InjectTrigger): string {
  if (typeof trigger.id === "string" && trigger.id.trim().length > 0) {
    return trigger.id;
  }
  const lat = typeof trigger.lat === "number" ? trigger.lat.toFixed(4) : "na";
  const lng = typeof trigger.lng === "number" ? trigger.lng.toFixed(4) : "na";
  return `${trigger.tick}:${trigger.title ?? "inject"}:${lat}:${lng}`;
}

const DEFAULT_ALLOWED_TYPES = ["INTEL", "OPS", "ADMIN"];
const DEFAULT_ALLOWED_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const DEFAULT_REQUIRED_RESPONSES: InjectResponseRequirement[] = ["MFR", "COA", "NONE"];

function normalizeForMatch(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function deriveTopRisks(state: GameState): string[] {
  const risks: string[] = [];
  const overdueRequired = state.injectTriggers.filter((trigger) => {
    if (trigger.tick > state.tick) return false;
    if (trigger.required_response !== "MFR" && trigger.required_response !== "COA") {
      return false;
    }
    return typeof trigger.deadline_tick === "number" && trigger.deadline_tick <= state.tick;
  }).length;
  if (overdueRequired > 0) {
    risks.push(`${overdueRequired} response task(s) are past due.`);
  }
  if (state.globalTension >= 70) {
    risks.push(`Global tension is elevated at ${state.globalTension}.`);
  }
  const lowFuelAirborne = state.units
    .filter((unit) => unit.status === "AIRBORNE" && unit.max_fuel > 0)
    .filter((unit) => unit.current_fuel / unit.max_fuel <= 0.35);
  if (lowFuelAirborne.length > 0) {
    risks.push(`${lowFuelAirborne.length} airborne unit(s) are below 35% fuel.`);
  }
  if (risks.length === 0) {
    risks.push("No immediate mission-critical risk flags detected.");
  }
  return risks.slice(0, 3);
}

function buildRelevantAssets(
  state: GameState,
  trigger: InjectTrigger | undefined,
  responseType: "MFR" | "COA",
  content: string
): EvalContext["relevantAssets"] {
  const taskableAssets = state.assets.filter((a) => a.player_taskable !== false);
  if (taskableAssets.length === 0) return [];
  const roleWeights: Record<string, number> = {
    FIGHTER: 1,
    ISR: 1,
    TRANSPORT: 1,
    TANKER: 1,
  };
  if (responseType === "COA") {
    roleWeights.TRANSPORT += 2;
    roleWeights.FIGHTER += 1;
  }
  if (trigger?.type === "INTEL") {
    roleWeights.ISR += 2;
    roleWeights.FIGHTER += 1;
  }
  if (trigger?.type === "OPS") {
    roleWeights.TRANSPORT += 2;
    roleWeights.TANKER += 1;
  }

  const keywordCorpus = normalizeForMatch(
    `${content} ${trigger?.title ?? ""} ${trigger?.content ?? ""}`
  );
  const scored = taskableAssets.map((asset) => {
    const units = state.units.filter((unit) => unit.asset_id === asset.id);
    const airborne = units.filter((unit) => unit.status === "AIRBORNE").length;
    const grounded = units.filter((unit) => unit.status === "GROUNDED").length;
    const avgFuelRatio =
      units.length > 0
        ? units.reduce(
            (sum, unit) => sum + (unit.max_fuel > 0 ? unit.current_fuel / unit.max_fuel : 0),
            0
          ) / units.length
        : undefined;
    const nearestDistanceKm =
      typeof trigger?.lat === "number" && typeof trigger?.lng === "number" && units.length > 0
        ? Math.min(...units.map((unit) => distanceKm(unit.lat, unit.lng, trigger.lat!, trigger.lng!)))
        : undefined;
    const assetNeedle = normalizeForMatch(`${asset.id} ${asset.label}`);
    const mentionScore = assetNeedle.length > 0 && keywordCorpus.includes(assetNeedle) ? 3 : 0;
    const roleScore = asset.role ? roleWeights[asset.role] ?? 0 : 0;
    const proximityScore =
      typeof nearestDistanceKm === "number"
        ? Math.max(0, 3 - nearestDistanceKm / 600)
        : 0;
    const score = roleScore + mentionScore + proximityScore + (airborne > 0 ? 0.5 : 0);
    const nearestUnit = units[0];

    return {
      score,
      nearestDistanceKm,
      summary: {
        id: asset.id,
        label: asset.label,
        role: asset.role,
        quantity: asset.quantity,
        airborne,
        grounded,
        avgFuelRatio:
          typeof avgFuelRatio === "number" ? Math.round(avgFuelRatio * 100) / 100 : undefined,
        nearestDistanceKm:
          typeof nearestDistanceKm === "number"
            ? Math.round(nearestDistanceKm * 10) / 10
            : undefined,
        roughLocation: nearestUnit
          ? `${nearestUnit.lat.toFixed(2)}, ${nearestUnit.lng.toFixed(2)}`
          : undefined,
      },
    };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDist = a.nearestDistanceKm ?? Number.POSITIVE_INFINITY;
      const bDist = b.nearestDistanceKm ?? Number.POSITIVE_INFINITY;
      return aDist - bDist;
    })
    .slice(0, 6)
    .map((entry) => entry.summary);
}

function buildEvalContext(
  state: GameState,
  triggerId: string,
  responseType: "MFR" | "COA",
  content: string
): EvalContext {
  const trigger = state.injectTriggers.find(
    (candidate) =>
      candidate.id === triggerId || buildInjectTriggerKey(candidate) === triggerId
  );
  const releasedInjects = state.injectTriggers
    .filter((candidate) => candidate.tick <= state.tick)
    .sort((a, b) => b.tick - a.tick);
  const allowedTypes = uniqueStrings(
    releasedInjects.map((candidate) => candidate.type ?? "")
  );
  const allowedPriorities = uniqueStrings(
    releasedInjects.map((candidate) => candidate.priority ?? "")
  );

  return {
    currentTrigger: trigger
      ? {
          id: triggerId,
          tick: trigger.tick,
          title: trigger.title,
          type: trigger.type,
          priority: trigger.priority,
          required_response: trigger.required_response,
          deadline_tick: trigger.deadline_tick,
          lat: trigger.lat,
          lng: trigger.lng,
        }
      : undefined,
    missionSnapshot: {
      tick: state.tick,
      globalTension: state.globalTension,
      topRisks: deriveTopRisks(state),
    },
    relevantAssets: buildRelevantAssets(state, trigger, responseType, content),
    recentInjects: releasedInjects.slice(0, 4).map((recent) => ({
      id:
        typeof recent.id === "string" && recent.id.trim().length > 0
          ? recent.id
          : buildInjectTriggerKey(recent),
      tick: recent.tick,
      title: recent.title,
      type: recent.type,
      priority: recent.priority,
    })),
    constraints: {
      allowedTypes: allowedTypes.length > 0 ? allowedTypes : DEFAULT_ALLOWED_TYPES,
      allowedPriorities:
        allowedPriorities.length > 0 ? allowedPriorities : DEFAULT_ALLOWED_PRIORITIES,
      allowedRequiredResponses: DEFAULT_REQUIRED_RESPONSES,
      tickWindow: {
        min: state.tick + 1,
        max: state.tick + 40,
      },
      deadlineWindow: {
        min: state.tick + 2,
        max: state.tick + 80,
      },
    },
  };
}

function spawnHostileUnitsForGroup(
  state: GameState,
  groupId: string
): HostileUnit[] {
  const group = state.hostileGroups.find((candidate) => candidate.id === groupId);
  if (!group) return state.hostileUnits;
  const base = state.hostileBases.find((candidate) => candidate.id === group.home_base);
  const spawnLat = base?.lat ?? 0;
  const spawnLng = base?.lng ?? 0;
  const existingForGroup = state.hostileUnits.filter(
    (unit) => unit.group_id === group.id
  );
  if (existingForGroup.length > 0) return state.hostileUnits;

  const nextUnits = [...state.hostileUnits];
  const hostileMobility = isExplicitAirSidc(group.sidc) ? "AIRBORNE" : "SURFACE";
  for (let i = 0; i < Math.max(1, group.quantity); i += 1) {
    const waypoint = group.route?.[0];
    nextUnits.push({
      id: `${group.id}-${i + 1}`,
      group_id: group.id,
      label: `${group.label} ${i + 1}`,
      side: group.side,
      status: hostileMobility,
      role: group.role,
      sidc: group.sidc,
      home_base: group.home_base,
      lat: spawnLat,
      lng: spawnLng,
      target_lat: waypoint?.lat,
      target_lng: waypoint?.lng,
      route: group.route,
      route_index: waypoint ? 0 : undefined,
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
  const groupScope = new Set(
    (groupIds ?? []).filter((id) => typeof id === "string" && id.length > 0)
  );
  const retaskAllGroups = groupScope.size === 0;
  const appliesToGroup = (groupId: string) =>
    retaskAllGroups || groupScope.has(groupId);

  const hostileUnits = state.hostileUnits.map((unit) => {
    if (unit.status !== "AIRBORNE" && unit.status !== "SURFACE") return unit;
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

function applyEventActions(state: GameState, eventId: string): GameState {
  const event = state.events.find((candidate) => candidate.id === eventId);
  if (!event || !event.actions || event.actions.length === 0) return state;

  let nextState = state;
  for (const action of event.actions) {
    if (action.type === "SPAWN_HOSTILE_GROUP") {
      const hostileUnits = spawnHostileUnitsForGroup(nextState, action.group_id);
      nextState = { ...nextState, hostileUnits };
      continue;
    }
    if (action.type === "ACTIVATE_ZONE") {
      const noFlyZones: NoFlyZone[] = nextState.noFlyZones.map((zone) =>
        zone.id === action.zone_id
          ? { ...zone, active: action.active ?? true }
          : zone
      );
      nextState = { ...nextState, noFlyZones };
      continue;
    }
    if (action.type === "CREATE_NFZ") {
      const exists = nextState.noFlyZones.some((zone) => zone.id === action.zone.id);
      const noFlyZones = exists
        ? nextState.noFlyZones.map((zone) =>
            zone.id === action.zone.id ? action.zone : zone
          )
        : [...nextState.noFlyZones, action.zone];
      nextState = { ...nextState, noFlyZones };
      continue;
    }
    if (action.type === "CREATE_DROP_ZONE") {
      const globePoints = [...nextState.globePoints, action.point];
      nextState = { ...nextState, globePoints };
      continue;
    }
    if (action.type === "RETASK_RED_ASSETS") {
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
    }
  }
  return nextState;
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
  status:
    | "pending"
    | "graded"
    | "approved"
    | "resubmit_required"
    | "error"
    | "expired";
  responseType: "MFR" | "COA";
  content: string;
  submittedAt: string;
  strictness?: GradingStrictness;
  grade?: EvaluationGrade;
  injectProposal?: InjectProposal;
  error?: string;
}

export interface CreateAdminInjectInput {
  injectKind: InjectKind;
  title: string;
  content?: string;
  tick: number;
  type?: string;
  priority?: string;
  requiredResponse?: InjectResponseRequirement;
  deadlineTick?: number;
  lat?: number;
  lng?: number;
  mapVisible?: boolean;
  sidc?: string;
  executeNow?: boolean;
  targetLat?: number;
  targetLng?: number;
  targetGroupIds?: string[];
  nfzRadiusKm?: number;
  nfzAppliesTo?: Side[];
  warningGraceTicks?: number;
  dropZoneRadiusKm?: number;
  spawnGroup?: {
    id?: string;
    label?: string;
    home_base?: string;
    quantity?: number;
    role?: HostileGroupDefinition["role"];
    sidc?: string;
    max_fuel?: number;
    fuel_burn_rate?: number;
    speed?: number;
    aoe_radius?: number;
    sensor_range_km?: number;
    engagement_range_km?: number;
    combat_rating?: number;
    signature?: number;
    route?: Array<{ lat: number; lng: number }>;
  };
}

type PersistedStateWithResponses = GameState & {
  injectResponses?: Record<string, InjectResponseRecord>;
};

function normalizeInjectResponses(
  value: unknown
): Record<string, InjectResponseRecord> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const entries = Object.entries(source).filter(([, record]) => {
    if (!record || typeof record !== "object") return false;
    const candidate = record as Partial<InjectResponseRecord>;
    return (
      (candidate.responseType === "MFR" || candidate.responseType === "COA") &&
      typeof candidate.content === "string" &&
      typeof candidate.submittedAt === "string"
    );
  });
  return Object.fromEntries(entries) as Record<string, InjectResponseRecord>;
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
  setTriggerStrictness: (id: string, strictness: GradingStrictness) => void;
  updateInjectEventTick: (id: string, tick: number) => Promise<boolean>;
  triggerInjectEventNow: (id: string) => Promise<boolean>;
  createAdminInject: (input: CreateAdminInjectInput) => Promise<boolean>;
  /** Cadet response submissions keyed by triggerId ("tick-title") */
  injectResponses: Record<string, InjectResponseRecord>;
  /** Cadet: submit a response to an inject trigger; broadcasts to all tabs */
  submitInjectResponse: (
    triggerId: string,
    responseType: "MFR" | "COA",
    content: string,
    strictness?: GradingStrictness
  ) => void;
  gradeInjectResponse: (
    triggerId: string,
    payload: {
      responseType: "MFR" | "COA";
      content: string;
      strictness?: GradingStrictness;
      missedDeadline?: boolean;
    }
  ) => Promise<void>;
  setInjectResponseStatus: (
    triggerId: string,
    status: InjectResponseRecord["status"]
  ) => void;
  submitDeploymentRequest: (request: {
    orderLabel?: string;
    unitAssignments: Array<{
      unitId: string;
      missionType: DeploymentMissionType;
    }>;
    targetLat: number;
    targetLng: number;
    patrolLatA?: number;
    patrolLngA?: number;
    patrolLatB?: number;
    patrolLngB?: number;
    returnBaseId: string;
    patrolReturnTimeIso?: string;
    sameSpeed: boolean;
    departureTimeIso: string;
  }) => Promise<boolean>;
  decideDeploymentRequest: (
    requestId: string,
    decision: "approve" | "deny",
    denialReason?: string
  ) => Promise<boolean>;
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
  const gradingInFlightRef = useRef(new Set<string>());

  const channelRef = useRef<RealtimeChannel | null>(null);
  const externalBroadcastListenersRef = useRef(new Set<(s: GameState) => void>());

  // ── Utilities ─────────────────────────────────────────────────────────────

  const persistResponses = useCallback(
    (nextResponses: Record<string, InjectResponseRecord>) => {
      const nextForPersistence = {
        ...stateRef.current,
        injectResponses: nextResponses,
      } as GameState;
      void persistSimulationState(nextForPersistence);
    },
    []
  );

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
      setInjectResponses(
        normalizeInjectResponses(
          (savedSession as PersistedStateWithResponses).injectResponses
        )
      );
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
      .on("broadcast", { event: "grading_complete" }, ({ payload }) => {
        const g = payload as {
          triggerId: string;
          grade?: EvaluationGrade;
          injectProposal?: InjectProposal;
          status?: InjectResponseRecord["status"];
        };
        if (!g?.triggerId) return;
        setInjectResponses((prev) => {
          const current = prev[g.triggerId];
          if (!current) return prev;
          const next: InjectResponseRecord = {
            ...current,
            status: g.status ?? "graded",
            grade: g.grade ?? current.grade,
            injectProposal: g.injectProposal ?? current.injectProposal,
            error: undefined,
          };
          const nextMap = { ...prev, [g.triggerId]: next };
          persistResponses(nextMap);
          return nextMap;
        });
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
        const dbWithResponses = dbState as PersistedStateWithResponses;
        const hydrated = serializeState(dbWithResponses);
        stateRef.current = hydrated;
        saveSession(hydrated);
        setState(hydrated);
        setInjectResponses(normalizeInjectResponses(dbWithResponses.injectResponses));
      })
      .catch(() => {
        // Supabase unavailable; local fallback state remains active.
      });

    return () => {
      mounted = false;
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [applyHardResetLocal, isAdminPath, persistResponses, setStateAndPersist, syncState]);

  // ── Public actions ────────────────────────────────────────────────────────

  const loadDefinition = useCallback(
    async (
      definition: GameDefinition,
      fileName: string,
      initialTickRate?: number
    ) => {
      const spawnedUnits = spawnUnitsFromAssets(definition.assets, definition.bases);
      const next: GameState = {
        ...defaultState,
        scenarioTitle: definition.scenarioTitle ?? null,
        loadedFileName: fileName,
        resources: definition.resources,
        bases: definition.bases,
        assets: definition.assets,
        units: applyInitialAirborne(spawnedUnits, definition.initialAirborne),
        events: definition.events,
        injectTriggers: withTriggerIds(definition.injectTriggers),
        hostileBases: definition.hostileBases ?? [],
        hostileGroups: definition.hostileGroups ?? [],
        hostileUnits: [],
        knownTracks: [],
        noFlyZones: definition.noFlyZones ?? [],
        globePoints: definition.globePoints ?? [],
        globalTension: deriveGlobalTension(
          definition.resources,
          defaultState.globalTension
        ),
        tickRate:
          typeof initialTickRate === "number" && initialTickRate > 0
            ? clampSimulationTickRate(initialTickRate)
            : 1,
        hoursPerTick: resolveHoursPerTick(definition.hours_per_tick),
        simulationStartTimeIso: normalizeScenarioStartTime(definition.scenario_start_time),
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
        const clampedRate = clampSimulationTickRate(tickRate);
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

  const setTriggerStrictness = useCallback(
    (id: string, strictness: GradingStrictness) => {
      if (!id) return;
      setStateAndPersist((s) => ({
        ...s,
        injectTriggers: (s.injectTriggers ?? []).map((t) =>
          t.id === id ? { ...t, strictness } : t
        ),
      }));
    },
    [setStateAndPersist]
  );

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
      const nextWithInjects = {
        ...stateRef.current,
        resources: nextResources,
        injects: [...logs, ...stateRef.current.injects].slice(0, MAX_INJECT_LOGS),
        globalTension: deriveGlobalTension(
          nextResources,
          stateRef.current.globalTension
        ),
      };
      const next = applyEventActions(nextWithInjects, id);
      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const createAdminInject = useCallback(
    async (input: CreateAdminInjectInput) => {
      const title = input.title?.trim();
      if (!title) return false;
      const requestedTick = Number.isFinite(input.tick)
        ? Math.max(1, Math.floor(input.tick))
        : stateRef.current.tick;
      const executeNow =
        input.executeNow === true || requestedTick <= stateRef.current.tick;
      const tick = executeNow ? stateRef.current.tick : requestedTick;
      const triggerId = createEntityId("inject");

      const requiredResponse =
        input.requiredResponse === "MFR" || input.requiredResponse === "COA"
          ? input.requiredResponse
          : undefined;
      const defaultType =
        input.injectKind === "INFO_UPDATE" ? "INTEL" : "OPS";
      const trigger: InjectTrigger = {
        id: triggerId,
        tick,
        title,
        content: input.content?.trim() || undefined,
        type: input.type?.trim() || defaultType,
        priority: input.priority?.trim() || undefined,
        required_response: requiredResponse,
        deadline_tick:
          typeof input.deadlineTick === "number" && Number.isFinite(input.deadlineTick)
            ? Math.max(tick, Math.floor(input.deadlineTick))
            : undefined,
        map_visible: input.mapVisible ?? true,
        sidc: input.sidc?.trim() || undefined,
        inject_kind: input.injectKind,
      };
      if (typeof input.lat === "number" && typeof input.lng === "number") {
        trigger.lat = input.lat;
        trigger.lng = input.lng;
      }

      let next: GameState = {
        ...stateRef.current,
        injectTriggers: [...stateRef.current.injectTriggers, trigger].sort(
          (a, b) => a.tick - b.tick
        ),
      };

      const now = Date.now();
      const intelLog = {
        id: createEntityId("injectlog"),
        tick: next.tick,
        resource: "intel",
        amount: 1,
        note: title,
        at: new Date(now).toISOString(),
      };

      const eventNote = input.content?.trim() || title;

      if (input.injectKind === "TASK_RED_ASSET") {
        if (!Number.isFinite(input.targetLat) || !Number.isFinite(input.targetLng)) {
          return false;
        }
        const targetLat = Number(input.targetLat);
        const targetLng = Number(input.targetLng);
        const retaskAction: EventAction = {
          type: "RETASK_RED_ASSETS",
          target_lat: targetLat,
          target_lng: targetLng,
          group_ids: input.targetGroupIds,
        };
        trigger.action_payload = {
          target_lat: targetLat,
          target_lng: targetLng,
          target_group_ids: input.targetGroupIds ?? [],
        };
        if (executeNow) {
          const retask = applyRetaskToRedAssets(
            next,
            targetLat,
            targetLng,
            input.targetGroupIds
          );
          next = {
            ...next,
            hostileUnits: retask.hostileUnits,
            hostileGroups: retask.hostileGroups,
            injects: [intelLog, ...next.injects].slice(0, MAX_INJECT_LOGS),
          };
        } else {
          next = {
            ...next,
            events: [
              ...next.events,
              {
                id: createEntityId("event"),
                tick,
                note: eventNote,
                injects: {},
                actions: [retaskAction],
              },
            ].sort((a, b) => a.tick - b.tick),
          };
        }
      } else if (input.injectKind === "CREATE_NFZ") {
        if (
          !Number.isFinite(input.lat) ||
          !Number.isFinite(input.lng) ||
          !Number.isFinite(input.nfzRadiusKm)
        ) {
          return false;
        }
        const zoneLat = Number(input.lat);
        const zoneLng = Number(input.lng);
        const zoneRadius = Number(input.nfzRadiusKm);
        const zone: NoFlyZone = {
          id: createEntityId("nfz"),
          label: title,
          shape: "CIRCLE",
          center_lat: zoneLat,
          center_lng: zoneLng,
          radius_km: Math.max(1, zoneRadius),
          active: true,
          applies_to:
            Array.isArray(input.nfzAppliesTo) && input.nfzAppliesTo.length > 0
              ? input.nfzAppliesTo
              : ["RED"],
          violation_policy: "WARN_THEN_DESTROY",
          warning_grace_ticks:
            typeof input.warningGraceTicks === "number"
              ? Math.max(0, Math.floor(input.warningGraceTicks))
              : 2,
        };
        trigger.action_payload = {
          zone_id: zone.id,
          radius_km: zone.radius_km,
          applies_to: zone.applies_to,
        };
        if (executeNow) {
          next = {
            ...next,
            noFlyZones: [...next.noFlyZones, zone],
            injects: [intelLog, ...next.injects].slice(0, MAX_INJECT_LOGS),
          };
        } else {
          next = {
            ...next,
            events: [
              ...next.events,
              {
                id: createEntityId("event"),
                tick,
                note: eventNote,
                injects: {},
                actions: [{ type: "CREATE_NFZ", zone } as EventAction],
              },
            ].sort((a, b) => a.tick - b.tick),
          };
        }
      } else if (input.injectKind === "CREATE_DROP_ZONE") {
        if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) return false;
        const dropLat = Number(input.lat);
        const dropLng = Number(input.lng);
        const point = {
          lat: dropLat,
          lng: dropLng,
          tick,
          label: title,
          type: "DROP_ZONE",
          radius_km:
            typeof input.dropZoneRadiusKm === "number"
              ? Math.max(1, input.dropZoneRadiusKm)
              : undefined,
        };
        trigger.action_payload = {
          radius_km: point.radius_km,
        };
        if (executeNow) {
          next = {
            ...next,
            globePoints: [...next.globePoints, point],
            injects: [intelLog, ...next.injects].slice(0, MAX_INJECT_LOGS),
          };
        } else {
          next = {
            ...next,
            events: [
              ...next.events,
              {
                id: createEntityId("event"),
                tick,
                note: eventNote,
                injects: {},
                actions: [{ type: "CREATE_DROP_ZONE", point } as EventAction],
              },
            ].sort((a, b) => a.tick - b.tick),
          };
        }
      } else if (input.injectKind === "SPAWN_HOSTILE_GROUP") {
        if (stateRef.current.hostileBases.length === 0) return false;
        const requestedHomeBase = input.spawnGroup?.home_base?.trim();
        const resolvedHomeBase = stateRef.current.hostileBases.some(
          (base) => base.id === requestedHomeBase
        )
          ? requestedHomeBase
          : stateRef.current.hostileBases[0]?.id;
        if (!resolvedHomeBase) return false;

        const spawnGroupId = input.spawnGroup?.id?.trim() || createEntityId("redgrp");
        const spawnGroup: HostileGroupDefinition = {
          id: spawnGroupId,
          label: input.spawnGroup?.label?.trim() || title,
          side: "RED",
          home_base: resolvedHomeBase,
          quantity: Math.max(1, Math.min(12, Math.floor(input.spawnGroup?.quantity ?? 2))),
          role: input.spawnGroup?.role ?? "FIGHTER",
          sidc:
            input.spawnGroup?.sidc?.trim() || "130601000011010000000000000000",
          max_fuel: Math.max(2000, Math.floor(input.spawnGroup?.max_fuel ?? 15000)),
          fuel_burn_rate: Math.max(1, Math.floor(input.spawnGroup?.fuel_burn_rate ?? 12)),
          speed: Math.max(0.2, Math.min(6, input.spawnGroup?.speed ?? 1.5)),
          aoe_radius:
            typeof input.spawnGroup?.aoe_radius === "number"
              ? Math.max(1, input.spawnGroup.aoe_radius)
              : 80,
          sensor_range_km:
            typeof input.spawnGroup?.sensor_range_km === "number"
              ? Math.max(10, input.spawnGroup.sensor_range_km)
              : 180,
          engagement_range_km:
            typeof input.spawnGroup?.engagement_range_km === "number"
              ? Math.max(5, input.spawnGroup.engagement_range_km)
              : 45,
          combat_rating:
            typeof input.spawnGroup?.combat_rating === "number"
              ? Math.max(1, Math.min(100, Math.floor(input.spawnGroup.combat_rating)))
              : 60,
          signature:
            typeof input.spawnGroup?.signature === "number"
              ? Math.max(1, Math.min(100, Math.floor(input.spawnGroup.signature)))
              : 45,
          route: Array.isArray(input.spawnGroup?.route)
            ? input.spawnGroup.route
                .filter(
                  (point) =>
                    typeof point.lat === "number" &&
                    Number.isFinite(point.lat) &&
                    typeof point.lng === "number" &&
                    Number.isFinite(point.lng)
                )
                .slice(0, 5)
            : undefined,
        };

        const hostileGroups = next.hostileGroups.some((group) => group.id === spawnGroup.id)
          ? next.hostileGroups.map((group) =>
              group.id === spawnGroup.id ? { ...group, ...spawnGroup } : group
            )
          : [...next.hostileGroups, spawnGroup];
        trigger.action_payload = {
          group_id: spawnGroup.id,
          home_base: spawnGroup.home_base,
          quantity: spawnGroup.quantity,
          role: spawnGroup.role,
        };

        if (executeNow) {
          const withGroup = { ...next, hostileGroups };
          const hostileUnits = spawnHostileUnitsForGroup(withGroup, spawnGroup.id);
          next = {
            ...withGroup,
            hostileUnits,
            injects: [intelLog, ...withGroup.injects].slice(0, MAX_INJECT_LOGS),
          };
        } else {
          next = {
            ...next,
            hostileGroups,
            events: [
              ...next.events,
              {
                id: createEntityId("event"),
                tick,
                note: eventNote,
                injects: {},
                actions: [
                  {
                    type: "SPAWN_HOSTILE_GROUP",
                    group_id: spawnGroup.id,
                  } as EventAction,
                ],
              },
            ].sort((a, b) => a.tick - b.tick),
          };
        }
      } else if (input.injectKind === "INFO_UPDATE") {
        if (executeNow) {
          next = {
            ...next,
            injects: [intelLog, ...next.injects].slice(0, MAX_INJECT_LOGS),
          };
        }
      }

      await persistAndPublish(next, "tick_update");
      return true;
    },
    [persistAndPublish]
  );

  const submitInjectResponse = useCallback(
    (
      triggerId: string,
      responseType: "MFR" | "COA",
      content: string,
      strictness?: GradingStrictness
    ) => {
      const submittedAt = new Date().toISOString();
      const record: InjectResponseRecord = {
        status: "pending",
        responseType,
        content,
        submittedAt,
        strictness,
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

  const setInjectResponseStatus = useCallback(
    (triggerId: string, status: InjectResponseRecord["status"]) => {
      setInjectResponses((prev) => {
        const current = prev[triggerId];
        if (!current) return prev;
        const next = { ...current, status };
        const nextMap = { ...prev, [triggerId]: next };
        persistResponses(nextMap);
        void sendBroadcast("grading_complete", {
          triggerId,
          status: next.status,
          grade: next.grade,
          injectProposal: next.injectProposal,
        });
        return nextMap;
      });
    },
    [persistResponses, sendBroadcast]
  );

  const gradeInjectResponse = useCallback(
    async (
      triggerId: string,
      payload: {
        responseType: "MFR" | "COA";
        content: string;
        strictness?: GradingStrictness;
        missedDeadline?: boolean;
      }
    ) => {
      if (gradingInFlightRef.current.has(triggerId)) {
        return;
      }
      gradingInFlightRef.current.add(triggerId);
      try {
        const evalContext = buildEvalContext(
          stateRef.current,
          triggerId,
          payload.responseType,
          payload.content
        );
        const res = await fetch("/api/inject/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            triggerId,
            ...payload,
            scenarioTitle: stateRef.current.scenarioTitle,
            tick: stateRef.current.tick,
            evalContext,
          }),
        });

        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Evaluation failed");
        }
        const body = (await res.json()) as {
          grade?: EvaluationGrade;
          injectProposal?: InjectProposal;
          status?: InjectResponseRecord["status"];
          strictness?: GradingStrictness;
        };

        setInjectResponses((prev) => {
          const current = prev[triggerId] ?? {
            status: "pending" as const,
            responseType: payload.responseType,
            content: payload.content,
            submittedAt: new Date().toISOString(),
            strictness: payload.strictness,
          };
          const next: InjectResponseRecord = {
            ...current,
            status: body.status ?? "graded",
            grade: body.grade ?? current.grade,
            injectProposal: body.injectProposal,
            strictness: body.strictness ?? payload.strictness ?? current.strictness,
            error: undefined,
          };
          const nextMap = { ...prev, [triggerId]: next };
          persistResponses(nextMap);
          return nextMap;
        });

        void sendBroadcast("grading_complete", {
          triggerId,
          grade: body.grade,
          injectProposal: body.injectProposal,
          status: body.status ?? "graded",
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setInjectResponses((prev) => {
          const current = prev[triggerId];
          if (!current) return prev;
          const next: InjectResponseRecord = {
            ...current,
            status: "error",
            error: message,
          };
          const nextMap = { ...prev, [triggerId]: next };
          persistResponses(nextMap);
          return nextMap;
        });
      } finally {
        gradingInFlightRef.current.delete(triggerId);
      }
    },
    [persistResponses, sendBroadcast]
  );

  const isMissionAllowedForUnit = useCallback(
    (
      unit: GameState["units"][number],
      missionType: DeploymentMissionType
    ): boolean => {
      if (missionType === "PATROL") return true;
      const role = unit.role;
      if (!role) return false;
      if (role === "ISR") return missionType === "ISR";
      if (role === "TRANSPORT") {
        return missionType === "TRANSPORT" || missionType === "AIR_DROP";
      }
      if (role === "TANKER") return missionType === "SUPPORT";
      if (role === "FIGHTER") return missionType === "STRIKE" || missionType === "ISR";
      return false;
    },
    []
  );

  const submitDeploymentRequest = useCallback(
    async (request: {
      orderLabel?: string;
      unitAssignments: Array<{
        unitId: string;
        missionType: DeploymentMissionType;
      }>;
      targetLat: number;
      targetLng: number;
      patrolLatA?: number;
      patrolLngA?: number;
      patrolLatB?: number;
      patrolLngB?: number;
      returnBaseId: string;
      patrolReturnTimeIso?: string;
      sameSpeed: boolean;
      departureTimeIso: string;
    }) => {
      const current = stateRef.current;
      if (
        !Array.isArray(request.unitAssignments) ||
        request.unitAssignments.length === 0 ||
        !Number.isFinite(request.targetLat) ||
        !Number.isFinite(request.targetLng) ||
        !request.departureTimeIso ||
        !request.returnBaseId
      ) {
        return false;
      }

      const departureTick = simulationTimeIsoToTick(
        current.simulationStartTimeIso,
        request.departureTimeIso,
        current.hoursPerTick
      );
      if (departureTick == null || departureTick < current.tick) return false;
      const selectedBase = current.bases.find((b) => b.id === request.returnBaseId);
      if (!selectedBase) return false;
      const selectedBaseLabel = selectedBase.label.toLowerCase();
      const isCarrierLanding = selectedBaseLabel.includes("carrier") || selectedBaseLabel.includes("cvn");
      const uniqueAssignments = Array.from(
        new Map(request.unitAssignments.map((item) => [item.unitId, item])).values()
      );
      const selectedUnitIds = new Set(uniqueAssignments.map((item) => item.unitId));
      const selectedUnits = current.units.filter((u) => selectedUnitIds.has(u.id));
      if (selectedUnits.length !== uniqueAssignments.length) return false;

      const missionByUnitId = new Map(
        uniqueAssignments.map((assignment) => [assignment.unitId, assignment.missionType])
      );

      const hasPatrol = uniqueAssignments.some((assignment) => assignment.missionType === "PATROL");
      let patrolReturnTick: number | undefined;
      if (hasPatrol) {
        const hasPatrolCoords =
          Number.isFinite(request.patrolLatA) &&
          Number.isFinite(request.patrolLngA) &&
          Number.isFinite(request.patrolLatB) &&
          Number.isFinite(request.patrolLngB);
        if (!hasPatrolCoords || !request.patrolReturnTimeIso) return false;
        patrolReturnTick = simulationTimeIsoToTick(
          current.simulationStartTimeIso,
          request.patrolReturnTimeIso,
          current.hoursPerTick
        ) ?? undefined;
        if (patrolReturnTick == null) return false;
        if (patrolReturnTick <= current.tick || patrolReturnTick <= departureTick) return false;
      }

      for (const unit of selectedUnits) {
        if (unit.status !== "GROUNDED") return false;
        if (!isPlayerTaskableUnit(unit, current.assets)) return false;
        const missionType = missionByUnitId.get(unit.id);
        if (!missionType || !isMissionAllowedForUnit(unit, missionType)) return false;
        if (isCarrierLanding && unit.role === "TRANSPORT") return false;
      }

      const hasPendingForAnyUnit = current.deploymentRequests.some(
        (req) =>
          req.status === "PENDING_APPROVAL" &&
          req.units.some((assignment) => selectedUnitIds.has(assignment.unit_id))
      );
      if (hasPendingForAnyUnit) return false;

      const slowestSpeed =
        selectedUnits.length > 0
          ? Math.min(...selectedUnits.map((unit) => Math.max(0, unit.speed)))
          : undefined;
      const estimatedFuel = selectedUnits.reduce(
        (sum, unit) => sum + estimateFuelRequired(unit, request.targetLat, request.targetLng),
        0
      );
      const deployment: DeploymentRequest = {
        id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        order_label:
          request.orderLabel?.trim() || `Tasking Order ${new Date().toLocaleTimeString()}`,
        units: selectedUnits.map((unit) => ({
          unit_id: unit.id,
          asset_id: unit.asset_id,
          unit_label: unit.label,
          mission_type: missionByUnitId.get(unit.id) ?? "PATROL",
        })),
        same_speed: request.sameSpeed,
        target_lat: request.targetLat,
        target_lng: request.targetLng,
        return_base_id: request.returnBaseId,
        patrol_lat_a: hasPatrol ? request.patrolLatA : undefined,
        patrol_lng_a: hasPatrol ? request.patrolLngA : undefined,
        patrol_lat_b: hasPatrol ? request.patrolLatB : undefined,
        patrol_lng_b: hasPatrol ? request.patrolLngB : undefined,
        patrol_return_tick: patrolReturnTick,
        departure_tick: departureTick,
        estimated_fuel_required: estimatedFuel,
        requested_by: "CADET",
        requested_at: new Date().toISOString(),
        status: "PENDING_APPROVAL",
      };

      const next: GameState = {
        ...current,
        units: current.units.map((u) =>
          selectedUnitIds.has(u.id)
            ? {
                ...u,
                status: "PENDING_APPROVAL",
                deployment_status: "PENDING_APPROVAL",
                mission_type: missionByUnitId.get(u.id),
                tasking_order_id: deployment.id,
                target_lat:
                  hasPatrol && Number.isFinite(request.patrolLatA)
                    ? request.patrolLatA
                    : request.targetLat,
                target_lng:
                  hasPatrol && Number.isFinite(request.patrolLngA)
                    ? request.patrolLngA
                    : request.targetLng,
                return_base_id: request.returnBaseId,
                patrol_lat_a: hasPatrol ? request.patrolLatA : undefined,
                patrol_lng_a: hasPatrol ? request.patrolLngA : undefined,
                patrol_lat_b: hasPatrol ? request.patrolLatB : undefined,
                patrol_lng_b: hasPatrol ? request.patrolLngB : undefined,
                patrol_return_tick: patrolReturnTick,
                synchronized_speed:
                  request.sameSpeed && typeof slowestSpeed === "number"
                    ? slowestSpeed
                    : undefined,
              }
            : u
        ),
        deploymentRequests: [deployment, ...current.deploymentRequests],
      };
      await persistAndPublish(next, "tick_update");
      void sendBroadcast("deployment_request", deployment);
      return true;
    },
    [isMissionAllowedForUnit, persistAndPublish, sendBroadcast]
  );

  const decideDeploymentRequest = useCallback(
    async (requestId: string, decision: "approve" | "deny", denialReason?: string) => {
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
              denial_reason: decision === "deny" ? denialReason : undefined,
              decided_at: decidedAt,
              decided_by: "ADMIN" as const,
            }
          : r
      );

      const nextUnits = stateRef.current.units.map((u) => {
        const assignment = req.units.find((candidate) => candidate.unit_id === u.id);
        if (!assignment) return u;
        if (decision === "approve") {
          const patrolRoute =
            assignment.mission_type === "PATROL"
              ? [
                  {
                    lat:
                      typeof req.patrol_lat_a === "number"
                        ? req.patrol_lat_a
                        : req.target_lat,
                    lng:
                      typeof req.patrol_lng_a === "number"
                        ? req.patrol_lng_a
                        : req.target_lng,
                  },
                  {
                    lat:
                      typeof req.patrol_lat_b === "number"
                        ? req.patrol_lat_b
                        : req.target_lat,
                    lng:
                      typeof req.patrol_lng_b === "number"
                        ? req.patrol_lng_b
                        : req.target_lng,
                  },
                ]
              : undefined;
          return {
            ...u,
            status: "GROUNDED" as const,
            deployment_status: "APPROVED" as const,
            mission_type: assignment.mission_type,
            tasking_order_id: req.id,
            target_lat:
              assignment.mission_type === "PATROL" &&
              typeof req.patrol_lat_a === "number"
                ? req.patrol_lat_a
                : req.target_lat,
            target_lng:
              assignment.mission_type === "PATROL" &&
              typeof req.patrol_lng_a === "number"
                ? req.patrol_lng_a
                : req.target_lng,
            return_base_id: req.return_base_id,
            patrol_lat_a: req.patrol_lat_a,
            patrol_lng_a: req.patrol_lng_a,
            patrol_lat_b: req.patrol_lat_b,
            patrol_lng_b: req.patrol_lng_b,
            patrol_return_tick: req.patrol_return_tick,
            synchronized_speed: req.same_speed ? u.synchronized_speed : undefined,
            departure_tick: req.departure_tick,
            route: patrolRoute,
            route_index: assignment.mission_type === "PATROL" ? 0 : undefined,
          };
        }
        return {
          ...u,
          status: "GROUNDED" as const,
          deployment_status: undefined,
          mission_type: undefined,
          tasking_order_id: undefined,
          target_lat: undefined,
          target_lng: undefined,
          return_base_id: undefined,
          patrol_lat_a: undefined,
          patrol_lng_a: undefined,
          patrol_lat_b: undefined,
          patrol_lng_b: undefined,
          patrol_return_tick: undefined,
          synchronized_speed: undefined,
          departure_tick: undefined,
          route: undefined,
          route_index: undefined,
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

  const executeMission = useCallback(
    async (unitId: string) => {
      const result = findTransportInjectOnStation(stateRef.current, unitId);
      if (!result) return false;

      const { trigger, unitIndex } = result;
      const unit = stateRef.current.units[unitIndex];
      if (!isPlayerTaskableUnit(unit, stateRef.current.assets)) return false;
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
      setTriggerStrictness,
      updateInjectEventTick,
      triggerInjectEventNow,
      createAdminInject,
      injectResponses,
      submitInjectResponse,
      gradeInjectResponse,
      setInjectResponseStatus,
      submitDeploymentRequest,
      decideDeploymentRequest,
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
      setTriggerStrictness,
      updateInjectEventTick,
      triggerInjectEventNow,
      createAdminInject,
      injectResponses,
      submitInjectResponse,
      gradeInjectResponse,
      setInjectResponseStatus,
      submitDeploymentRequest,
      decideDeploymentRequest,
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
