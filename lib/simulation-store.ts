import type {
  DeploymentMissionType,
  DeploymentRequest,
  GameDefinition,
  InjectLog,
  InjectTrigger,
  ResourceMap,
  SpawnedUnit,
} from "@/types/game";
import { normalizeScenarioStartTime } from "@/lib/simulation-time";
import { clampSimulationTickRate } from "@/lib/simulation-tick-rate";
import {
  applyInitialAirborne,
  distanceKm,
  estimateFuelRequired,
  isWithinAoe,
  resolveHoursPerTick,
  spawnUnitsFromAssets,
} from "@/lib/simulation-units";

const MAX_INJECT_LOGS = 120;

export interface SimulationState {
  resources: ResourceMap;
  bases: GameDefinition["bases"];
  assets: GameDefinition["assets"];
  units: SpawnedUnit[];
  events: GameDefinition["events"];
  injects: InjectLog[];
  injectTriggers: InjectTrigger[];
  tick: number;
  tickRate: number;
  hoursPerTick: number;
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
}

function deriveGlobalTension(resources: ResourceMap, fallback: number): number {
  const entries = Object.entries(resources);
  let globalKey: string | undefined;
  let tensionKey: string | undefined;
  for (const [key] of entries) {
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

function applyEventInjects(resources: ResourceMap, injects: ResourceMap): ResourceMap {
  const next = { ...resources };
  // Build a lowercase → canonical-key map so inject keys match case-insensitively.
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

const initialState: SimulationState = {
  resources: {},
  bases: [],
  assets: [],
  units: [],
  events: [],
  injects: [],
  injectTriggers: [],
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

let state: SimulationState = { ...initialState };
const listeners = new Set<(s: SimulationState) => void>();

function applyActiveRefuels(
  units: SpawnedUnit[],
  activeRefuels: SimulationState["activeRefuels"],
  hoursPerTick: number
): { units: SpawnedUnit[]; activeRefuels: SimulationState["activeRefuels"] } {
  if (activeRefuels.length === 0) {
    return { units, activeRefuels };
  }
  const h = resolveHoursPerTick(hoursPerTick);

  const nextUnits = units.map((unit) => ({ ...unit }));
  const unitById = new Map(nextUnits.map((unit) => [unit.id, unit]));
  const persisted: SimulationState["activeRefuels"] = [];

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

    const ratePerHour = Math.max(0, tanker.transfer_rate ?? 0);
    const receiverNeed = Math.max(0, receiver.max_fuel - receiver.current_fuel);
    if (ratePerHour <= 0 || receiverNeed <= 0 || tanker.current_fuel <= 0) continue;

    const transferAmount = Math.min(ratePerHour * h, receiverNeed, tanker.current_fuel);
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

function buildInjectTriggerKey(trigger: InjectTrigger): string {
  if (typeof trigger.id === "string" && trigger.id.trim().length > 0) {
    return trigger.id;
  }
  const lat = typeof trigger.lat === "number" ? trigger.lat.toFixed(4) : "na";
  const lng = typeof trigger.lng === "number" ? trigger.lng.toFixed(4) : "na";
  return `${trigger.tick}:${trigger.title ?? "inject"}:${lat}:${lng}`;
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

function findTransportInjectOnStation(unit: SpawnedUnit): InjectTrigger | null {
  if (unit.role !== "TRANSPORT") return null;
  if (unit.status !== "AIRBORNE") return null;
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
      return trigger;
    }
  }
  return null;
}

function getState(): SimulationState {
  return state;
}

function setState(next: SimulationState) {
  state = next;
  listeners.forEach((cb) => cb(state));
}

export function loadDefinition(
  definition: GameDefinition,
  fileName: string,
  initialTickRate?: number
) {
  const spawnedUnits = spawnUnitsFromAssets(definition.assets, definition.bases);
  const next: SimulationState = {
    ...state,
    resources: definition.resources,
    bases: definition.bases,
    assets: definition.assets,
    units: applyInitialAirborne(spawnedUnits, definition.initialAirborne),
    events: definition.events,
    injects: [],
    injectTriggers: withTriggerIds(definition.injectTriggers),
    tick: 0,
    // Always start a freshly loaded scenario in a running state.
    // Admin can pause again via the control API if needed.
    paused: false,
    status: "RUNNING",
    loadedFileName: fileName,
    error: null,
    globePoints: definition.globePoints ?? [],
    globalTension: deriveGlobalTension(definition.resources, state.globalTension),
    scenarioTitle: definition.scenarioTitle ?? null,
    deploymentRequests: [],
    activeRefuels: [],
    hoursPerTick: resolveHoursPerTick(definition.hours_per_tick),
    simulationStartTimeIso: normalizeScenarioStartTime(definition.scenario_start_time),
  };
  if (typeof initialTickRate === "number" && initialTickRate > 0) {
    next.tickRate = clampSimulationTickRate(initialTickRate);
  }
  setState(next);
}

function updateTensionKey(resources: ResourceMap, clamped: number): ResourceMap {
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

export function setTickRate(tickRate: number) {
  const next = { ...state, tickRate: clampSimulationTickRate(tickRate) };
  setState(next);
}

export function setGlobalTension(value: number) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  setState({
    ...state,
    resources: updateTensionKey(state.resources, clamped),
    globalTension: clamped,
  });
}

export function togglePaused() {
  setPaused(!state.paused);
}

export function setPaused(paused: boolean) {
  const nextStatus: SimulationState["status"] = paused ? state.status : "RUNNING";
  const next = { ...state, paused, status: nextStatus };
  setState(next);
}

export function stopSimulation() {
  setState({
    ...initialState,
    tickRate: state.tickRate,
    hoursPerTick: state.hoursPerTick,
    simulationStartTimeIso: null,
    paused: true,
    status: "UNINITIALIZED",
    globalTension: 20,
    deploymentRequests: [],
  });
}

export function setError(message: string | null) {
  setState({ ...state, error: message });
}

export function subscribe(listener: (s: SimulationState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateEventTick(id: string, tick: number) {
  if (!Number.isInteger(tick) || tick < 1) return;
  const events = state.events.map((event) =>
    event.id === id ? { ...event, tick } : event
  );
  setState({ ...state, events });
}

export function triggerEventNow(id: string) {
  const event = state.events.find((e) => e.id === id);
  if (!event) return;
  console.info("[INJECT] Manual trigger", event.id ?? id);

  const now = Date.now();
  const currentTick = state.tick;

  let nextResources = state.resources;
  nextResources = applyEventInjects(nextResources, event.injects);

  const logs: InjectLog[] = [];
  for (const [resource, amount] of Object.entries(event.injects)) {
    logs.push({
      id: `manual-${now}-${event.id ?? resource}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      tick: currentTick,
      resource,
      amount,
      note: event.note,
      at: new Date(now).toISOString(),
    });
  }

  setState({
    ...state,
    resources: nextResources,
    injects: [...logs, ...state.injects].slice(0, MAX_INJECT_LOGS),
    globalTension: deriveGlobalTension(nextResources, state.globalTension),
  });
}

interface CreateDeploymentRequestInput {
  unitId: string;
  missionType: DeploymentMissionType;
  targetLat: number;
  targetLng: number;
  departureTick: number;
}

export function createDeploymentRequest(
  input: CreateDeploymentRequestInput
): DeploymentRequest | null {
  if (
    !input.unitId ||
    !Number.isFinite(input.targetLat) ||
    !Number.isFinite(input.targetLng) ||
    !Number.isFinite(input.departureTick)
  ) {
    return null;
  }

  const departureTick = Math.max(1, Math.floor(input.departureTick));
  const unit = state.units.find((u) => u.id === input.unitId);
  if (!unit || unit.status !== "GROUNDED") return null;

  const alreadyPending = state.deploymentRequests.some(
    (req) => req.unit_id === input.unitId && req.status === "PENDING_APPROVAL"
  );
  if (alreadyPending) return null;

  const estimatedFuel = estimateFuelRequired(unit, input.targetLat, input.targetLng);
  const now = new Date().toISOString();
  const request: DeploymentRequest = {
    id: `dep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    unit_id: unit.id,
    asset_id: unit.asset_id,
    unit_label: unit.label,
    mission_type: input.missionType,
    target_lat: input.targetLat,
    target_lng: input.targetLng,
    departure_tick: departureTick,
    estimated_fuel_required: estimatedFuel,
    requested_by: "CADET",
    requested_at: now,
    status: "PENDING_APPROVAL",
  };

  const nextUnits = state.units.map((u) =>
    u.id === input.unitId
      ? {
          ...u,
          status: "PENDING_APPROVAL" as const,
          deployment_status: "PENDING_APPROVAL" as const,
          mission_type: input.missionType,
        }
      : u
  );
  setState({
    ...state,
    units: nextUnits,
    deploymentRequests: [request, ...state.deploymentRequests],
  });
  return request;
}

export function approveDeploymentRequest(requestId: string): boolean {
  const req = state.deploymentRequests.find((r) => r.id === requestId);
  if (!req || req.status !== "PENDING_APPROVAL") return false;

  const decidedAt = new Date().toISOString();
  const nextRequests = state.deploymentRequests.map((r) =>
    r.id === requestId
      ? {
          ...r,
          status: "APPROVED" as const,
          decided_at: decidedAt,
          decided_by: "ADMIN" as const,
        }
      : r
  );

  const nextUnits = state.units.map((u) =>
    u.id === req.unit_id
      ? {
          ...u,
          status: "GROUNDED" as const,
          deployment_status: "APPROVED" as const,
          mission_type: req.mission_type,
          target_lat: req.target_lat,
          target_lng: req.target_lng,
          departure_tick: req.departure_tick,
        }
      : u
  );

  setState({
    ...state,
    units: nextUnits,
    deploymentRequests: nextRequests,
  });
  return true;
}

export function denyDeploymentRequest(requestId: string): boolean {
  const req = state.deploymentRequests.find((r) => r.id === requestId);
  if (!req || req.status !== "PENDING_APPROVAL") return false;

  const decidedAt = new Date().toISOString();
  const nextRequests = state.deploymentRequests.map((r) =>
    r.id === requestId
      ? {
          ...r,
          status: "DENIED" as const,
          decided_at: decidedAt,
          decided_by: "ADMIN" as const,
        }
      : r
  );

  const nextUnits = state.units.map((u) =>
    u.id === req.unit_id
      ? {
          ...u,
          status: "GROUNDED" as const,
          deployment_status: undefined,
          mission_type: undefined,
        }
      : u
  );

  setState({
    ...state,
    units: nextUnits,
    deploymentRequests: nextRequests,
  });
  return true;
}

export function initiateAerialRefuel(receiverId: string): boolean {
  const receiver = state.units.find((unit) => unit.id === receiverId);
  if (!receiver || receiver.status !== "AIRBORNE") return false;

  const candidateTankers = state.units.filter((unit) => {
    if (
      unit.id === receiver.id ||
      unit.status !== "AIRBORNE" ||
      unit.role !== "TANKER"
    ) {
      return false;
    }
    const radius = Math.max(0, unit.aoe_radius ?? 0);
    if (radius <= 0 || (unit.transfer_rate ?? 0) <= 0 || unit.current_fuel <= 0) {
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

  const nextRefuels = state.activeRefuels.filter(
    (link) =>
      link.receiverId !== receiver.id &&
      !(link.receiverId === receiver.id && link.tankerId === tanker.id)
  );
  nextRefuels.unshift({ tankerId: tanker.id, receiverId: receiver.id });

  setState({
    ...state,
    activeRefuels: nextRefuels,
  });
  return true;
}

export function executeTransportMission(unitId: string): boolean {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit) return false;

  const trigger = findTransportInjectOnStation(unit);
  if (!trigger) return false;

  const triggerKey = buildInjectTriggerKey(trigger);
  const completedIds = Array.isArray(unit.completed_inject_ids)
    ? unit.completed_inject_ids
    : [];

  if (completedIds.includes(triggerKey)) return false;

  const now = Date.now();
  const note = `${unit.label} on station for ${trigger.title ?? "active inject"}`;
  const missionLog: InjectLog = {
    id: `mission-${now}-${unit.id}-${Math.random().toString(36).slice(2, 8)}`,
    tick: state.tick,
    resource: "mission",
    amount: 1,
    note,
    at: new Date(now).toISOString(),
  };

  const nextUnits = state.units.map((u) => {
    if (u.id !== unit.id) return u;
    return {
      ...u,
      completed_inject_ids: [...completedIds, triggerKey],
    };
  });

  setState({
    ...state,
    units: nextUnits,
    injects: [missionLog, ...state.injects].slice(0, MAX_INJECT_LOGS),
  });
  return true;
}

export { getState };
