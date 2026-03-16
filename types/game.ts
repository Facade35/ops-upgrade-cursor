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
}

export type UnitStatus = "GROUNDED" | "AIRBORNE" | "PENDING_APPROVAL";
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
}

export interface GameEvent {
  id?: string;
  tick: number;
  note?: string;
  injects: ResourceMap;
}

export interface InjectTrigger {
  tick: number;
  title?: string;
  content?: string;
  type?: string;
  priority?: string;
  required_response?: "MFR" | "COA";
  deadline_tick?: number;
  lat?: number;
  lng?: number;
  map_visible?: boolean;
  sidc?: string;
}

export interface GameDefinition {
  resources: ResourceMap;
  bases: Base[];
  assets: Asset[];
  events: GameEvent[];
  globePoints: GlobePoint[];
  injectTriggers?: InjectTrigger[];
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
