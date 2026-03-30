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
export type HostileUnitStatus = "AIRBORNE" | "DESTROYED";
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
  type?: string;
  priority?: string;
  required_response?: InjectResponseRequirement;
  deadline_tick?: number;
  lat?: number;
  lng?: number;
  map_visible?: boolean;
  sidc?: string;
}
export type InjectKind =
  | "TASK_RED_ASSET"
  | "CREATE_NFZ"
  | "CREATE_DROP_ZONE"
  | "INFO_UPDATE";

export interface Asset {
  id: string;
  label: string;
  sidc: string;
  quantity: number;
  home_base: string;
  max_fuel: number;
  fuel_burn_rate: number;
  speed: number;
  capacity: number;
  role?: UnitRole;
  aoe_radius?: number;
  transfer_rate?: number;
  side?: Side;
  sensor_range_km?: number;
  detection_strength?: number;
  combat_rating?: number;
}

export type UnitStatus =
  | "GROUNDED"
  | "AIRBORNE"
  | "PENDING_APPROVAL"
  | "DESTROYED";
export type DeploymentMissionType =
  | "ISR"
  | "Strike"
  | "Transport"
  | "Search & Rescue";
export type DeploymentRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "DENIED";

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
  fuel_burn_rate: number;
  speed: number;
  capacity: number;
  role?: UnitRole;
  aoe_radius?: number;
  transfer_rate?: number;
  target_lat?: number;
  target_lng?: number;
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
}

export interface DeploymentRequest {
  id: string;
  unit_id: string;
  asset_id: string;
  unit_label: string;
  mission_type: DeploymentMissionType;
  target_lat: number;
  target_lng: number;
  departure_tick: number;
  estimated_fuel_required: number;
  requested_by: "CADET";
  requested_at: string;
  status: DeploymentRequestStatus;
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
  classification: "HOSTILE_AIR";
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
}

export interface InjectLog {
  id: string;
  tick: number;
  resource: string;
  amount: number;
  at: string;
  note?: string;
}
