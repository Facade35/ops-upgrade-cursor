import type {
  Asset,
  Base,
  DeploymentMissionType,
  EventAction,
  GameDefinition,
  GlobePoint,
  HostileBase,
  HostileGroupDefinition,
  InjectTrigger,
  NoFlyZone,
  ResourceMap,
  Side,
  UnitRole,
} from "@/types/game";

function normalizeResourceMap(value: unknown, label: string): ResourceMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object of { [name]: number }.`);
  }

  const normalized: ResourceMap = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      throw new Error(`${label}.${key} must be a valid number.`);
    }
    normalized[key] = raw;
  }
  return normalized;
}

function parseRole(value: unknown): UnitRole | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "TANKER" ||
    normalized === "FIGHTER" ||
    normalized === "ISR" ||
    normalized === "TRANSPORT"
  ) {
    return normalized;
  }
  return undefined;
}

function parseSide(value: unknown, fallback: Side = "BLUE"): Side {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return normalized === "RED" ? "RED" : "BLUE";
}

function parseMissionType(value: unknown): DeploymentMissionType | undefined {
  if (value === "ISR") return "ISR";
  if (value === "Strike") return "Strike";
  if (value === "Transport") return "Transport";
  if (value === "Search & Rescue") return "Search & Rescue";
  return undefined;
}

export function parseDefinition(raw: unknown): GameDefinition {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("JSON root must be an object.");
  }

  const obj = raw as Record<string, unknown>;
  const resourceMap = normalizeResourceMap(obj.resources ?? {}, "resources");
  const resources: ResourceMap = {};
  for (const [key, value] of Object.entries(resourceMap)) {
    if (!key.toLowerCase().includes("mog")) {
      resources[key] = value;
    }
  }

  const basesRaw = Array.isArray(obj.bases) ? obj.bases : [];
  const bases: Base[] = basesRaw
    .map((rawBase, index) => {
      if (!rawBase || typeof rawBase !== "object" || Array.isArray(rawBase)) {
        return null;
      }
      const base = rawBase as Record<string, unknown>;
      const id = typeof base.id === "string" ? base.id : `base-${index + 1}`;
      const label = typeof base.label === "string" ? base.label : id;
      const lat = typeof base.lat === "number" ? base.lat : undefined;
      const lng = typeof base.lng === "number" ? base.lng : undefined;
      if (lat == null || lng == null) {
        return null;
      }

      return {
        id,
        label,
        lat,
        lng,
        fuel_reserves:
          typeof base.fuel_reserves === "number" && Number.isFinite(base.fuel_reserves)
            ? Math.max(0, base.fuel_reserves)
            : 0,
        sidc: typeof base.sidc === "string" ? base.sidc : "SFGPE---------",
      };
    })
    .filter((base): base is Base => base !== null);

  const assetsRaw = Array.isArray(obj.assets) ? obj.assets : [];
  const assets: Asset[] = [];
  assetsRaw.forEach((rawAsset, index) => {
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
      return;
    }
    const asset = rawAsset as Record<string, unknown>;
    const id = typeof asset.id === "string" ? asset.id : `asset-${index + 1}`;
    const label =
      typeof asset.label === "string"
        ? asset.label
        : typeof asset.name === "string"
          ? asset.name
          : id;
    const role = parseRole(asset.role);
    const aoeRadius =
      typeof asset.aoe_radius === "number" && Number.isFinite(asset.aoe_radius)
        ? Math.max(0, asset.aoe_radius)
        : undefined;
    const transferRate =
      typeof asset.transfer_rate === "number" &&
      Number.isFinite(asset.transfer_rate)
        ? Math.max(0, asset.transfer_rate)
        : undefined;
    const sensorRangeKm =
      typeof asset.sensor_range_km === "number" &&
      Number.isFinite(asset.sensor_range_km)
        ? Math.max(0, asset.sensor_range_km)
        : undefined;
    const detectionStrength =
      typeof asset.detection_strength === "number" &&
      Number.isFinite(asset.detection_strength)
        ? Math.max(0, Math.min(100, asset.detection_strength))
        : undefined;
    const combatRating =
      typeof asset.combat_rating === "number" &&
      Number.isFinite(asset.combat_rating)
        ? Math.max(0, Math.min(100, asset.combat_rating))
        : undefined;

    const parsedAsset: Asset = {
      id,
      label,
      sidc: typeof asset.sidc === "string" ? asset.sidc : "SFAPMF----------",
      quantity:
        typeof asset.quantity === "number" && Number.isFinite(asset.quantity)
          ? Math.max(0, Math.floor(asset.quantity))
          : 0,
      home_base:
        typeof asset.home_base === "string"
          ? asset.home_base
          : bases[0]?.id ?? "base-unknown",
      max_fuel:
        typeof asset.max_fuel === "number" && Number.isFinite(asset.max_fuel)
          ? Math.max(0, asset.max_fuel)
          : 0,
      fuel_burn_rate:
        typeof asset.fuel_burn_rate === "number" &&
        Number.isFinite(asset.fuel_burn_rate)
          ? Math.max(0, asset.fuel_burn_rate)
          : 0,
      speed:
        typeof asset.speed === "number" && Number.isFinite(asset.speed)
          ? Math.max(0, asset.speed)
          : 0,
      capacity:
        typeof asset.capacity === "number" && Number.isFinite(asset.capacity)
          ? Math.max(0, asset.capacity)
          : 0,
      side: parseSide(asset.side, "BLUE"),
    };
    if (role) parsedAsset.role = role;
    if (typeof aoeRadius === "number") parsedAsset.aoe_radius = aoeRadius;
    if (typeof transferRate === "number") parsedAsset.transfer_rate = transferRate;
    if (typeof sensorRangeKm === "number") {
      parsedAsset.sensor_range_km = sensorRangeKm;
    }
    if (typeof detectionStrength === "number") {
      parsedAsset.detection_strength = detectionStrength;
    }
    if (typeof combatRating === "number") {
      parsedAsset.combat_rating = combatRating;
    }
    assets.push(parsedAsset);
  });

  const eventsRaw = Array.isArray(obj.events)
    ? obj.events
    : Array.isArray((obj as { inject_triggers?: unknown[] }).inject_triggers)
      ? (obj as { inject_triggers: Record<string, unknown>[] }).inject_triggers.map((t) => ({
          tick: t.tick,
          injects: typeof t.injects === "object" && t.injects !== null ? t.injects : { tension: 1 },
          id: typeof t.id === "string" ? t.id : undefined,
          note: typeof t.title === "string" ? t.title : typeof t.content === "string" ? t.content : undefined,
        }))
      : [];
  const events = eventsRaw.map((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`events[${index}] must be an object.`);
    }
    const parsedEvent = event as Record<string, unknown>;
    const tick = parsedEvent.tick;
    if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 1) {
      throw new Error(`events[${index}].tick must be an integer >= 1.`);
    }
    const injects = normalizeResourceMap(parsedEvent.injects ?? parsedEvent.resourceInjects ?? {}, `events[${index}].injects`);
    const rawActions = Array.isArray(parsedEvent.actions)
      ? parsedEvent.actions
      : [];
    const actions: EventAction[] = rawActions
      .map((rawAction) => {
        if (
          !rawAction ||
          typeof rawAction !== "object" ||
          Array.isArray(rawAction)
        ) {
          return null;
        }
        const action = rawAction as Record<string, unknown>;
        const type = typeof action.type === "string" ? action.type : "";
        if (type === "SPAWN_HOSTILE_GROUP") {
          const groupId =
            typeof action.group_id === "string" ? action.group_id : null;
          if (!groupId) return null;
          return { type, group_id: groupId } as EventAction;
        }
        if (type === "ACTIVATE_ZONE") {
          const zoneId = typeof action.zone_id === "string" ? action.zone_id : null;
          if (!zoneId) return null;
          const active =
            typeof action.active === "boolean" ? action.active : undefined;
          return { type, zone_id: zoneId, active } as EventAction;
        }
        return null;
      })
      .filter((a): a is EventAction => a !== null);

    return {
      id: typeof parsedEvent.id === "string" ? parsedEvent.id : `event-${index + 1}`,
      tick,
      note: typeof parsedEvent.note === "string" ? parsedEvent.note : undefined,
      injects,
      ...(actions.length > 0 ? { actions } : {}),
    };
  });

  const globePoints: GlobePoint[] = [];
  const meta = obj.scenario_metadata;
  let scenarioTitle: string | undefined;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const metaObj = meta as Record<string, unknown>;
    if (typeof metaObj.title === "string") {
      scenarioTitle = metaObj.title;
    }
    const start = metaObj.starting_location;
    if (start && typeof start === "object" && !Array.isArray(start)) {
      const s = start as { lat?: number; lng?: number };
      if (typeof s.lat === "number" && typeof s.lng === "number") {
        globePoints.push({
          lat: s.lat,
          lng: s.lng,
          label: "Starting location",
          type: "START",
        });
      }
    }
  }
  const triggersRaw = (obj as { inject_triggers?: Record<string, unknown>[] }).inject_triggers;
  const injectTriggers: InjectTrigger[] = [];
  if (Array.isArray(triggersRaw)) {
    for (const t of triggersRaw) {
      if (t && typeof t === "object" && typeof t.tick === "number") {
        injectTriggers.push({
          id:
            typeof t.id === "string"
              ? t.id
              : `inject-trigger-${injectTriggers.length + 1}`,
          tick: t.tick,
          title: typeof t.title === "string" ? t.title : undefined,
          content: typeof t.content === "string" ? t.content : undefined,
          type: typeof t.type === "string" ? t.type : undefined,
          priority: typeof t.priority === "string" ? t.priority : undefined,
          required_response:
            t.required_response === "MFR" ||
            t.required_response === "COA" ||
            t.required_response === "NONE"
              ? t.required_response
              : undefined,
          deadline_tick:
            typeof t.deadline_tick === "number" ? t.deadline_tick : undefined,
          lat: typeof t.lat === "number" ? t.lat : undefined,
          lng: typeof t.lng === "number" ? t.lng : undefined,
          map_visible:
            typeof t.map_visible === "boolean" ? t.map_visible : undefined,
          sidc: typeof t.sidc === "string" ? t.sidc : undefined,
          inject_kind:
            t.inject_kind === "TASK_RED_ASSET" ||
            t.inject_kind === "CREATE_NFZ" ||
            t.inject_kind === "CREATE_DROP_ZONE" ||
            t.inject_kind === "INFO_UPDATE"
              ? t.inject_kind
              : undefined,
        });
        if (
          typeof t.lat === "number" &&
          typeof t.lng === "number" &&
          t.map_visible !== false
        ) {
          globePoints.push({
            lat: t.lat,
            lng: t.lng,
            label: typeof t.title === "string" ? t.title : undefined,
            type: typeof t.type === "string" ? t.type : undefined,
            tick: t.tick,
          });
        }
      }
    }
  }

  const hostileBasesRaw = Array.isArray(obj.hostile_bases)
    ? obj.hostile_bases
    : [];
  const hostileBases: HostileBase[] = hostileBasesRaw
    .map((rawBase, index) => {
      if (!rawBase || typeof rawBase !== "object" || Array.isArray(rawBase)) {
        return null;
      }
      const base = rawBase as Record<string, unknown>;
      const lat = typeof base.lat === "number" ? base.lat : undefined;
      const lng = typeof base.lng === "number" ? base.lng : undefined;
      if (lat == null || lng == null) return null;

      return {
        id:
          typeof base.id === "string" ? base.id : `hostile-base-${index + 1}`,
        label:
          typeof base.label === "string"
            ? base.label
            : `Hostile Base ${index + 1}`,
        lat,
        lng,
        sidc:
          typeof base.sidc === "string" ? base.sidc : "SHGPE---------",
        side: parseSide(base.side, "RED"),
      };
    })
    .filter((base): base is HostileBase => base !== null);

  const hostileGroupsRaw = Array.isArray(obj.hostile_groups)
    ? obj.hostile_groups
    : [];
  const hostileGroups: HostileGroupDefinition[] = hostileGroupsRaw
    .map((rawGroup, index) => {
      if (
        !rawGroup ||
        typeof rawGroup !== "object" ||
        Array.isArray(rawGroup)
      ) {
        return null;
      }
      const group = rawGroup as Record<string, unknown>;
      const role = parseRole(group.role) ?? "FIGHTER";
      const quantity =
        typeof group.quantity === "number" && Number.isFinite(group.quantity)
          ? Math.max(1, Math.floor(group.quantity))
          : 1;
      const maxFuel =
        typeof group.max_fuel === "number" && Number.isFinite(group.max_fuel)
          ? Math.max(0, group.max_fuel)
          : 0;
      const fuelBurnRate =
        typeof group.fuel_burn_rate === "number" &&
        Number.isFinite(group.fuel_burn_rate)
          ? Math.max(0, group.fuel_burn_rate)
          : 0;
      const speed =
        typeof group.speed === "number" && Number.isFinite(group.speed)
          ? Math.max(0, group.speed)
          : 0;
      const aoeRadius =
        typeof group.aoe_radius === "number" && Number.isFinite(group.aoe_radius)
          ? Math.max(0, group.aoe_radius)
          : undefined;
      const routeRaw = Array.isArray(group.route) ? group.route : [];
      const route = routeRaw
        .map((waypoint) => {
          if (
            !waypoint ||
            typeof waypoint !== "object" ||
            Array.isArray(waypoint)
          ) {
            return null;
          }
          const point = waypoint as Record<string, unknown>;
          const lat = typeof point.lat === "number" ? point.lat : undefined;
          const lng = typeof point.lng === "number" ? point.lng : undefined;
          if (lat == null || lng == null) return null;
          return { lat, lng };
        })
        .filter((waypoint): waypoint is { lat: number; lng: number } => waypoint !== null);
      const sensorRangeKm =
        typeof group.sensor_range_km === "number" &&
        Number.isFinite(group.sensor_range_km)
          ? Math.max(0, group.sensor_range_km)
          : undefined;
      const engagementRangeKm =
        typeof group.engagement_range_km === "number" &&
        Number.isFinite(group.engagement_range_km)
          ? Math.max(0, group.engagement_range_km)
          : undefined;
      const combatRating =
        typeof group.combat_rating === "number" &&
        Number.isFinite(group.combat_rating)
          ? Math.max(0, Math.min(100, group.combat_rating))
          : undefined;
      const signature =
        typeof group.signature === "number" && Number.isFinite(group.signature)
          ? Math.max(0, Math.min(100, group.signature))
          : undefined;

      return {
        id:
          typeof group.id === "string" ? group.id : `hostile-group-${index + 1}`,
        label:
          typeof group.label === "string"
            ? group.label
            : `Hostile Group ${index + 1}`,
        side: parseSide(group.side, "RED"),
        home_base:
          typeof group.home_base === "string"
            ? group.home_base
            : hostileBases[0]?.id ?? "hostile-base-1",
        quantity,
        role,
        sidc:
          typeof group.sidc === "string" ? group.sidc : "SHAPMF----------",
        max_fuel: maxFuel,
        fuel_burn_rate: fuelBurnRate,
        speed,
        ...(typeof aoeRadius === "number" ? { aoe_radius: aoeRadius } : {}),
        ...(typeof sensorRangeKm === "number"
          ? { sensor_range_km: sensorRangeKm }
          : {}),
        ...(typeof engagementRangeKm === "number"
          ? { engagement_range_km: engagementRangeKm }
          : {}),
        ...(typeof combatRating === "number"
          ? { combat_rating: combatRating }
          : {}),
        ...(typeof signature === "number" ? { signature } : {}),
        ...(route.length > 0 ? { route } : {}),
      };
    })
    .filter((group): group is HostileGroupDefinition => group !== null);

  const noFlyZonesRaw = Array.isArray(obj.no_fly_zones) ? obj.no_fly_zones : [];
  const noFlyZones: NoFlyZone[] = noFlyZonesRaw
    .map((rawZone, index) => {
      if (!rawZone || typeof rawZone !== "object" || Array.isArray(rawZone)) {
        return null;
      }
      const zone = rawZone as Record<string, unknown>;
      const centerLat =
        typeof zone.center_lat === "number" ? zone.center_lat : undefined;
      const centerLng =
        typeof zone.center_lng === "number" ? zone.center_lng : undefined;
      const radiusKm =
        typeof zone.radius_km === "number" ? zone.radius_km : undefined;
      if (centerLat == null || centerLng == null || radiusKm == null) {
        return null;
      }
      const appliesToRaw = Array.isArray(zone.applies_to)
        ? zone.applies_to
        : ["RED"];
      const appliesTo = appliesToRaw
        .map((value) => parseSide(value, "RED"))
        .filter((value, idx, arr) => arr.indexOf(value) === idx);
      const policy =
        zone.violation_policy === "WARN_THEN_DESTROY"
          ? "WARN_THEN_DESTROY"
          : "WARN_THEN_DESTROY";
      const warningGraceTicks =
        typeof zone.warning_grace_ticks === "number" &&
        Number.isFinite(zone.warning_grace_ticks)
          ? Math.max(0, Math.floor(zone.warning_grace_ticks))
          : undefined;

      return {
        id: typeof zone.id === "string" ? zone.id : `nfz-${index + 1}`,
        label:
          typeof zone.label === "string"
            ? zone.label
            : `No-Fly Zone ${index + 1}`,
        shape: "CIRCLE",
        center_lat: centerLat,
        center_lng: centerLng,
        radius_km: Math.max(0, radiusKm),
        active: zone.active === true,
        applies_to: appliesTo.length > 0 ? appliesTo : ["RED"],
        violation_policy: policy,
        ...(typeof warningGraceTicks === "number"
          ? { warning_grace_ticks: warningGraceTicks }
          : {}),
      };
    })
    .filter((zone): zone is NoFlyZone => zone !== null);

  const initialAirborneRaw = Array.isArray(obj.initial_airborne)
    ? obj.initial_airborne
    : [];
  const initialAirborne: NonNullable<GameDefinition["initialAirborne"]> =
    initialAirborneRaw
      .map((rawPlacement) => {
        if (
          !rawPlacement ||
          typeof rawPlacement !== "object" ||
          Array.isArray(rawPlacement)
        ) {
          return null;
        }
        const placement = rawPlacement as Record<string, unknown>;
        const assetId =
          typeof placement.asset_id === "string" ? placement.asset_id : null;
        const lat = typeof placement.lat === "number" ? placement.lat : undefined;
        const lng = typeof placement.lng === "number" ? placement.lng : undefined;
        if (!assetId || lat == null || lng == null) return null;

        const unitIndex =
          typeof placement.unit_index === "number" &&
          Number.isFinite(placement.unit_index)
            ? Math.max(1, Math.floor(placement.unit_index))
            : undefined;
        const missionType = parseMissionType(placement.mission_type);
        const targetLat =
          typeof placement.target_lat === "number" ? placement.target_lat : undefined;
        const targetLng =
          typeof placement.target_lng === "number" ? placement.target_lng : undefined;

        return {
          asset_id: assetId,
          lat,
          lng,
          ...(typeof unitIndex === "number" ? { unit_index: unitIndex } : {}),
          ...(missionType ? { mission_type: missionType } : {}),
          ...(typeof targetLat === "number" ? { target_lat: targetLat } : {}),
          ...(typeof targetLng === "number" ? { target_lng: targetLng } : {}),
        };
      })
      .filter((placement) => placement !== null);

  return {
    resources,
    bases,
    assets,
    events,
    globePoints,
    injectTriggers,
    hostileBases,
    hostileGroups,
    noFlyZones,
    ...(initialAirborne.length > 0 ? { initialAirborne } : {}),
    scenarioTitle,
  };
}

export function getInitialTickRate(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const meta = (raw as Record<string, unknown>).scenario_metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const rate = (meta as Record<string, unknown>).tick_rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    return undefined;
  }

  // Treat scenario_metadata.tick_rate as "ticks per second".
  // The simulation engine converts this to an interval via 1000 / tickRate,
  // so a tick_rate of 5 yields a 200ms simulation step.
  return Math.min(10, Math.max(1, Math.round(rate)));
}

