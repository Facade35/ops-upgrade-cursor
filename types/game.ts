export type ResourceMap = Record<string, number>;

export interface Base {
  id: string;
  label: string;
  lat: number;
  lng: number;
  fuel_reserves: number;
  sidc: string;
}

export type UnitRole = "TANKER" | "FIGHTER" | "ISR" | "TRANSPORT";
export type Side = "BLUE" | "RED";
export type HostileUnitStatus = "AIRBORNE" | "SURFACE" | "DESTROYED";
export type NoFlyZonePolicy = "WARN_THEN_DESTROY";
export type InjectResponseRequirement = "MFR" | "COA" | "NONE";
export type GradingStrictness =
  | "COACHING"
  | "BALANCED"
  | "MISSION_READY"
  | "ZERO_TOLERANCE";

export type GradeVerdict = "accept" | "accept_with_inject" | "resubmit";

export interface EvaluationGrade {
  summary: string;
  verdict: GradeVerdict;
  faults: string[];
  recommendations?: string[];
}

export interface InjectProposal {
  title: string;
  content?: string;
  tick?: number;
  inject_kind?: InjectKind;
  type?: string;
  priority?: string;
  required_response?: InjectResponseRequirement;
  deadline_tick?: number;
  lat?: number;
  lng?: number;
  map_visible?: boolean;
  sidc?: string;
  spawn_group?: {
    id?: string;
    label?: string;
    home_base?: string;
    quantity?: number;
    role?: UnitRole;
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

export interface EvalContextCurrentTrigger {
  id: string;
  tick: number;
  title?: string;
  type?: string;
  priority?: string;
  required_response?: InjectResponseRequirement;
  deadline_tick?: number;
  lat?: number;
  lng?: number;
}

export interface EvalContextMissionSnapshot {
  tick: number;
  globalTension: number;
  topRisks: string[];
}

export interface EvalContextRelevantAsset {
  id: string;
  label: string;
  role?: UnitRole;
  quantity: number;
  airborne: number;
  grounded: number;
  avgFuelRatio?: number;
  nearestDistanceKm?: number;
  roughLocation?: string;
}

export interface EvalContextRecentInject {
  id: string;
  tick: number;
  title?: string;
  type?: string;
  priority?: string;
}

export interface EvalContextConstraints {
  allowedTypes: string[];
  allowedPriorities: string[];
  allowedRequiredResponses: InjectResponseRequirement[];
  tickWindow: { min: number; max: number };
  deadlineWindow: { min: number; max: number };
}

export interface EvalContext {
  currentTrigger?: EvalContextCurrentTrigger;
  missionSnapshot: EvalContextMissionSnapshot;
  relevantAssets: EvalContextRelevantAsset[];
  recentInjects: EvalContextRecentInject[];
  constraints: EvalContextConstraints;
}
export type InjectKind =
  | "TASK_RED_ASSET"
  | "CREATE_NFZ"
  | "CREATE_DROP_ZONE"
  | "INFO_UPDATE"
  | "SPAWN_HOSTILE_GROUP";

export interface Asset {
  id: string;
  label: string;
  sidc: string;
  quantity: number;
  home_base: string;
  max_fuel: number;
  /** Fuel burn rating where 10 = 10,000 lbs/hour (airborne). */
  fuel_burn_rate: number;
  /** Speed rating where 1.0 = 1000 mph (airborne movement). */
  speed: number;
  capacity: number;
  role?: UnitRole;
  aoe_radius?: number;
  /** Fuel per simulated hour (tanker). */
  transfer_rate?: number;
  side?: Side;
  sensor_range_km?: number;
  detection_strength?: number;
  combat_rating?: number;
  /**
   * When false, cadets cannot deploy or direct this unit (e.g. neutral civilian traffic).
   * Omitted or true means normal playable assets.
   */
  player_taskable?: boolean;
}

export type UnitStatus =
  | "GROUNDED"
  | "AIRBORNE"
  | "PENDING_APPROVAL"
  | "DESTROYED";
export type DeploymentMissionType =
  | "ISR"
  | "PATROL"
  | "STRIKE"
  | "TRANSPORT"
  | "AIR_DROP"
  | "SUPPORT";
export type DeploymentRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "DENIED";

export interface TaskingOrderUnitAssignment {
  unit_id: string;
  asset_id: string;
  unit_label: string;
  mission_type: DeploymentMissionType;
}

export interface TaskingOrderAiReview {
  strictness: GradingStrictness;
  verdict: "APPROVE" | "DENY";
  summary: string;
  faults: string[];
  recommendations?: string[];
}

export interface SpawnedUnit {
  id: string;
  asset_id: string;
  label: string;
  sidc: string;
  home_base: string;
  current_base: string | null;
  status: UnitStatus;
  lat: number;
  lng: number;
  current_fuel: number;
  max_fuel: number;
  /** Fuel burn rating where 10 = 10,000 lbs/hour (airborne). */
  fuel_burn_rate: number;
  /** Speed rating where 1.0 = 1000 mph when airborne. */
  speed: number;
  capacity: number;
  role?: UnitRole;
  aoe_radius?: number;
  /** Fuel per simulated hour (tanker). */
  transfer_rate?: number;
  target_lat?: number;
  target_lng?: number;
  return_base_id?: string;
  patrol_lat_a?: number;
  patrol_lng_a?: number;
  patrol_lat_b?: number;
  patrol_lng_b?: number;
  patrol_return_tick?: number;
  tasking_order_id?: string;
  synchronized_speed?: number;
  departure_tick?: number;
  deployment_status?: DeploymentRequestStatus;
  mission_type?: DeploymentMissionType;
  completed_inject_ids?: string[];
  side?: Side;
  sensor_range_km?: number;
  detection_strength?: number;
  combat_rating?: number;
  route?: Array<{ lat: number; lng: number }>;
  route_index?: number;
  /** Copied from asset; see Asset.player_taskable. */
  player_taskable?: boolean;
}

export interface DeploymentRequest {
  id: string;
  order_label: string;
  units: TaskingOrderUnitAssignment[];
  same_speed: boolean;
  target_lat: number;
  target_lng: number;
  return_base_id: string;
  patrol_lat_a?: number;
  patrol_lng_a?: number;
  patrol_lat_b?: number;
  patrol_lng_b?: number;
  patrol_return_tick?: number;
  departure_tick: number;
  estimated_fuel_required: number;
  requested_by: "CADET";
  requested_at: string;
  status: DeploymentRequestStatus;
  denial_reason?: string;
  ai_review?: TaskingOrderAiReview;
  decided_at?: string;
  decided_by?: "ADMIN";
}

export interface GlobePoint {
  lat: number;
  lng: number;
  label?: string;
  type?: string;
  tick?: number;
  radius_km?: number;
}

export interface HostileBase {
  id: string;
  label: string;
  lat: number;
  lng: number;
  sidc: string;
  side: Side;
}

export interface HostileGroupDefinition {
  id: string;
  label: string;
  side: Side;
  home_base: string;
  quantity: number;
  role: UnitRole;
  sidc: string;
  max_fuel: number;
  fuel_burn_rate: number;
  speed: number;
  aoe_radius?: number;
  sensor_range_km?: number;
  engagement_range_km?: number;
  combat_rating?: number;
  signature?: number;
  route?: Array<{ lat: number; lng: number }>;
}

export interface HostileUnit {
  id: string;
  group_id: string;
  label: string;
  side: Side;
  status: HostileUnitStatus;
  role: UnitRole;
  sidc: string;
  home_base: string;
  lat: number;
  lng: number;
  target_lat?: number;
  target_lng?: number;
  route?: Array<{ lat: number; lng: number }>;
  route_index?: number;
  current_fuel: number;
  max_fuel: number;
  fuel_burn_rate: number;
  speed: number;
  aoe_radius?: number;
  sensor_range_km?: number;
  engagement_range_km?: number;
  combat_rating?: number;
  signature?: number;
  first_warning_tick?: number;
}

export interface KnownTrack {
  id: string;
  truth_unit_id: string;
  label: string;
  lat: number;
  lng: number;
  side: Side;
  classification: "HOSTILE_AIR" | "HOSTILE_SURFACE";
  last_seen_tick: number;
  detected_by_unit_id: string;
  confidence: number;
}

export interface NoFlyZone {
  id: string;
  label: string;
  shape: "CIRCLE";
  center_lat: number;
  center_lng: number;
  radius_km: number;
  active: boolean;
  applies_to: Side[];
  violation_policy: NoFlyZonePolicy;
  warning_grace_ticks?: number;
}

export type EventAction =
  | {
      type: "SPAWN_HOSTILE_GROUP";
      group_id: string;
    }
  | {
      type: "ACTIVATE_ZONE";
      zone_id: string;
      active?: boolean;
    }
  | {
      type: "CREATE_NFZ";
      zone: NoFlyZone;
    }
  | {
      type: "CREATE_DROP_ZONE";
      point: GlobePoint;
    }
  | {
      type: "RETASK_RED_ASSETS";
      target_lat: number;
      target_lng: number;
      group_ids?: string[];
    };

export interface GameEvent {
  id?: string;
  tick: number;
  note?: string;
  injects: ResourceMap;
  actions?: EventAction[];
}

export interface InjectTrigger {
  id?: string;
  tick: number;
  title?: string;
  content?: string;
  type?: string;
  priority?: string;
  required_response?: InjectResponseRequirement;
  deadline_tick?: number;
  lat?: number;
  lng?: number;
  map_visible?: boolean;
  sidc?: string;
  inject_kind?: InjectKind;
  action_payload?: Record<string, unknown>;
  strictness?: GradingStrictness;
}

export interface InitialAirbornePlacement {
  asset_id: string;
  unit_index?: number;
  lat: number;
  lng: number;
  mission_type?: DeploymentMissionType;
  target_lat?: number;
  target_lng?: number;
}

export interface GameDefinition {
  resources: ResourceMap;
  bases: Base[];
  assets: Asset[];
  events: GameEvent[];
  globePoints: GlobePoint[];
  injectTriggers?: InjectTrigger[];
  hostileBases?: HostileBase[];
  hostileGroups?: HostileGroupDefinition[];
  noFlyZones?: NoFlyZone[];
  initialAirborne?: InitialAirbornePlacement[];
  scenarioTitle?: string;
  /**
   * Simulated hours advanced per game tick (default 1). Used to scale movement and fuel.
   * Asset `speed` is a rating where 1.0 = 1000 mph.
   * `fuel_burn_rate` is a rating where 10 = 10,000 lbs/hour.
   * Tanker `transfer_rate` remains lbs/hour.
   */
  hours_per_tick?: number;
  /** ISO 8601 scenario start (UTC recommended). Simulated time = start + tick × hours_per_tick. */
  scenario_start_time?: string;
}

export interface InjectLog {
  id: string;
  tick: number;
  resource: string;
  amount: number;
  at: string;
  note?: string;
}
