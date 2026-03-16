import type {
  Asset,
  Base,
  GameDefinition,
  GlobePoint,
  InjectTrigger,
  ResourceMap,
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
  const assets: Asset[] = assetsRaw
    .map((rawAsset, index) => {
      if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) {
        return null;
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
        typeof asset.transfer_rate === "number" && Number.isFinite(asset.transfer_rate)
          ? Math.max(0, asset.transfer_rate)
          : undefined;

      return {
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
          typeof asset.fuel_burn_rate === "number" && Number.isFinite(asset.fuel_burn_rate)
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
        ...(role ? { role } : {}),
        ...(typeof aoeRadius === "number" ? { aoe_radius: aoeRadius } : {}),
        ...(typeof transferRate === "number"
          ? { transfer_rate: transferRate }
          : {}),
      };
    })
    .filter((asset): asset is Asset => asset !== null);

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

    return {
      id: typeof parsedEvent.id === "string" ? parsedEvent.id : `event-${index + 1}`,
      tick,
      note: typeof parsedEvent.note === "string" ? parsedEvent.note : undefined,
      injects,
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
          tick: t.tick,
          title: typeof t.title === "string" ? t.title : undefined,
          content: typeof t.content === "string" ? t.content : undefined,
          type: typeof t.type === "string" ? t.type : undefined,
          priority: typeof t.priority === "string" ? t.priority : undefined,
          required_response:
            t.required_response === "MFR" || t.required_response === "COA"
              ? t.required_response
              : undefined,
          deadline_tick:
            typeof t.deadline_tick === "number" ? t.deadline_tick : undefined,
          lat: typeof t.lat === "number" ? t.lat : undefined,
          lng: typeof t.lng === "number" ? t.lng : undefined,
          map_visible:
            typeof t.map_visible === "boolean" ? t.map_visible : undefined,
          sidc: typeof t.sidc === "string" ? t.sidc : undefined,
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

  return {
    resources,
    bases,
    assets,
    events,
    globePoints,
    injectTriggers,
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

