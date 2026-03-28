"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ms from "milsymbol";
import * as THREE from "three";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGameState } from "@/hooks/use-game-state";
import { useRemoteGameState } from "@/components/remote-game-state-provider";

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => <div className="h-[72vh] min-h-[520px] w-full animate-pulse rounded-xl bg-muted/30" />,
}) as any;

const EARTH_RADIUS_KM = 6371.0088;
const CIRCLE_SEGMENTS = 96;
const UNIT_Z_AXIS = new THREE.Vector3(0, 0, 1);
const AIRBORNE_OVERLAY_ALTITUDE = 0.018;
const CYLINDER_HEIGHT_FRACTION = -0.018; // Opposite of overlay altitude+.02
const LEGACY_UNSUPPORTED_AIR_SIDCS = new Set([
  "SFAPMC----------",
  "SFAPMT----------",
  "SFAPMS----------",
]);
const AIR_ROLE_SIDCS = {
  STRIKE: "SFAPMF----------",
  CARGO: "SFAPML----------",
  RECON: "SFAPME----------",
  UTILITY: "SFAPMH----------",
  TANKER: "SFAPMV----------",
} as const;
const NUMERIC_AIR_ROLE_SIDCS: Record<string, (typeof AIR_ROLE_SIDCS)[keyof typeof AIR_ROLE_SIDCS]> = {
  "130301000011010400000000000000": AIR_ROLE_SIDCS.STRIKE, // fighter
  "130301000011010700000000000000": AIR_ROLE_SIDCS.CARGO, // cargo
  "130301000011011300000000000000": AIR_ROLE_SIDCS.UTILITY, // utility
  "130301000011010900000000000000": AIR_ROLE_SIDCS.TANKER, // tanker
  "130301000011011100000000000000": AIR_ROLE_SIDCS.RECON, // recon
};
const SIDC_REMAPPINGS: Record<string, string> = {
  // Keep generic remaps for non-unit markers that may still send legacy codes.
  "SFAPMC----------": AIR_ROLE_SIDCS.CARGO,
  "SFAPMT----------": AIR_ROLE_SIDCS.TANKER,
  "SFAPMS----------": AIR_ROLE_SIDCS.RECON,
  ...NUMERIC_AIR_ROLE_SIDCS,
};
const sidcValidityCache = new Map<string, boolean>();

function isRenderableSidc(sidc: string): boolean {
  if (sidcValidityCache.has(sidc)) return sidcValidityCache.get(sidc) ?? false;
  let valid = false;
  try {
    valid = Boolean(new ms.Symbol(sidc, { size: 1 }).isValid());
  } catch {
    valid = false;
  }
  sidcValidityCache.set(sidc, valid);
  return valid;
}

function resolveRenderableSidc(rawSidc: unknown, fallbackSidc: string): string {
  if (typeof rawSidc !== "string" || rawSidc.trim().length === 0) {
    return fallbackSidc;
  }
  const trimmed = rawSidc.trim();
  if (isRenderableSidc(trimmed)) return trimmed;
  const remapped = SIDC_REMAPPINGS[trimmed] ?? trimmed;
  return isRenderableSidc(remapped) ? remapped : fallbackSidc;
}

function inferAirRoleSidc(marker: any): string | undefined {
  const role = typeof marker?.role === "string" ? marker.role.trim().toUpperCase() : "";
  const id = typeof marker?.id === "string" ? marker.id.toUpperCase() : "";
  const label = typeof marker?.label === "string" ? marker.label.toUpperCase() : "";
  const text = `${id} ${label}`;

  if (role === "FIGHTER" || text.includes("F-15") || text.includes("F-16") || text.includes("F-22") || text.includes("F-35")) {
    return AIR_ROLE_SIDCS.STRIKE;
  }
  if (role === "ISR" || text.includes("P-8") || text.includes("POSEIDON") || text.includes("RECON")) {
    return AIR_ROLE_SIDCS.RECON;
  }
  if (role === "TANKER" || text.includes("KC-") || text.includes("STRATOTANKER")) {
    return AIR_ROLE_SIDCS.TANKER;
  }
  if (
    text.includes("C-130") ||
    text.includes("C130") ||
    text.includes("HERCULES") ||
    text.includes("CV-22") ||
    text.includes("CV22") ||
    text.includes("OSPREY")
  ) {
    return AIR_ROLE_SIDCS.UTILITY;
  }
  if (role === "TRANSPORT" || text.includes("C-17") || text.includes("GLOBEMASTER") || text.includes("C-5") || text.includes("GALAXY")) {
    return AIR_ROLE_SIDCS.CARGO;
  }
  return undefined;
}

function resolveUnitSidc(marker: any, fallbackSidc: string): string {
  const rawSidc = typeof marker?.sidc === "string" ? marker.sidc.trim() : "";
  if (rawSidc && !LEGACY_UNSUPPORTED_AIR_SIDCS.has(rawSidc) && isRenderableSidc(rawSidc)) {
    return rawSidc;
  }
  const numericMapped = NUMERIC_AIR_ROLE_SIDCS[rawSidc];
  if (numericMapped && isRenderableSidc(numericMapped)) return numericMapped;
  const inferred = inferAirRoleSidc(marker);
  if (inferred && isRenderableSidc(inferred)) return inferred;
  return resolveRenderableSidc(rawSidc, fallbackSidc);
}

type AoeMeshDatum = {
  id: string;
  lat: number;
  lng: number;
  radiusKm: number;
  kind: "AOE" | "NFZ";
  role?: string;
  selected: boolean;
  altitude: number;
};

export default function Globe3D() {
  const pathname = usePathname();
  const isAdminView = pathname === "/admin";
  const { state } = useGameState();
  const { selectedUnitId } = useRemoteGameState();
  const [size, setSize] = useState({ width: 1200, height: 720 });
  const globeRef = useRef<any>(undefined);
  const aoeDatumByIdRef = useRef(new Map<string, AoeMeshDatum>());
  const pointsData = state.globePoints.filter(
    (point) => point.tick == null || point.tick <= state.tick
  );
  const airborneUnits = state.units.filter(
    (unit) => unit.status !== "DESTROYED" && unit.status === "AIRBORNE"
  );
  const hostileAirborneUnits = state.hostileUnits.filter(
    (unit) => unit.status === "AIRBORNE"
  );
  const activeNoFlyZones = state.noFlyZones.filter((zone) => zone.active);
  const assetsByBaseId = useMemo(() => {
    const map = new Map<string, { label: string; quantity: number }[]>();
    for (const asset of state.assets) {
      if (!asset.home_base) continue;
      const label = asset.label ?? asset.id ?? "Asset";
      const quantity = typeof asset.quantity === "number" ? asset.quantity : 1;
      const existing = map.get(asset.home_base) ?? [];
      existing.push({ label, quantity });
      map.set(asset.home_base, existing);
    }
    return map;
  }, [state.assets]);
  const globeMarkers = [
    ...state.bases.map((base) => ({
      ...base,
      markerType: "BASE" as const,
      assetsStationed: assetsByBaseId.get(base.id) ?? [],
    })),
    ...(isAdminView
      ? state.hostileBases.map((base) => ({
          ...base,
          markerType: "HOSTILE_BASE" as const,
        }))
      : []),
    ...airborneUnits.map((unit) => ({
      ...unit,
      markerType: "UNIT" as const,
    })),
    ...(isAdminView
      ? hostileAirborneUnits.map((unit) => ({
          ...unit,
          markerType: "HOSTILE_UNIT" as const,
        }))
      : []),
    ...state.knownTracks.map((track) => ({
      ...track,
      markerType: "TRACK" as const,
    })),
    ...pointsData.map((point) => ({
      ...point,
      markerType: "POINT" as const,
    })),
  ];
  const roleColor = (role: string | undefined): string => {
    if (role === "TANKER") return "#00ff00";
    if (role === "FIGHTER") return "#ff0000";
    if (role === "ISR") return "#0096ff";
    if (role === "TRANSPORT") return "#ffff00";
    return "#c8c8c8";
  };

  const zoneColor = "#ff3b30";

  const toWorldRadius = (radiusKm: number): number => {
    const globeRadius = globeRef.current?.getGlobeRadius?.() ?? 100;
    return globeRadius * (Math.max(0, radiusKm) / EARTH_RADIUS_KM);
  };

  const getCylinderHeight = (): number => {
    const globeRadius = globeRef.current?.getGlobeRadius?.() ?? 100;
    return globeRadius * CYLINDER_HEIGHT_FRACTION;
  };

  const buildCylinderWallGeometry = (radius: number, height: number): THREE.BufferGeometry => {
    const geo = new THREE.CylinderGeometry(radius, radius, height, CIRCLE_SEGMENTS, 1, true);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, height / 2);
    return geo;
  };

  const buildCylinderCapGeometry = (radius: number): THREE.BufferGeometry => {
    const geo = new THREE.CircleGeometry(radius, CIRCLE_SEGMENTS);
    return geo;
  };

  const buildRingGeometry = (radius: number, zOffset: number): THREE.BufferGeometry => {
    const points = new THREE.Path().absarc(0, 0, radius, 0, Math.PI * 2, false).getPoints(CIRCLE_SEGMENTS);
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    if (zOffset !== 0) geo.translate(0, 0, zOffset);
    return geo;
  };

  const positionAoeMesh = (obj: THREE.Object3D, datum: AoeMeshDatum) => {
    const coords = globeRef.current?.getCoords?.(datum.lat, datum.lng, datum.altitude);
    if (!coords) return;
    obj.position.set(coords.x, coords.y, coords.z);
    const normal = new THREE.Vector3(coords.x, coords.y, coords.z).normalize();
    obj.quaternion.setFromUnitVectors(UNIT_Z_AXIS, normal);
  };

  const updateAoeMeshObject = (obj: THREE.Object3D, datum: AoeMeshDatum) => {
    const group = obj as THREE.Group;
    const wall = group.getObjectByName("aoe-wall") as THREE.Mesh | undefined;
    const cap = group.getObjectByName("aoe-cap") as THREE.Mesh | undefined;
    const topBorder = group.getObjectByName("aoe-border") as THREE.LineLoop | undefined;
    if (!wall || !cap || !topBorder) return;

    const worldRadius = toWorldRadius(datum.radiusKm);
    const height = getCylinderHeight();
    if (group.userData.worldRadius !== worldRadius || group.userData.cylinderHeight !== height) {
      wall.geometry.dispose();
      wall.geometry = buildCylinderWallGeometry(worldRadius, height);
      cap.geometry.dispose();
      cap.geometry = buildCylinderCapGeometry(worldRadius);
      topBorder.geometry.dispose();
      topBorder.geometry = buildRingGeometry(worldRadius, 0);
      group.userData.worldRadius = worldRadius;
      group.userData.cylinderHeight = height;
    }

    const nextColor = datum.kind === "NFZ" ? zoneColor : roleColor(datum.role);
    (wall.material as THREE.MeshBasicMaterial).color.set(nextColor);
    (wall.material as THREE.MeshBasicMaterial).opacity =
      datum.kind === "NFZ" ? 0.26 : datum.selected ? 0.35 : 0.3;
    (cap.material as THREE.MeshBasicMaterial).color.set(nextColor);
    (cap.material as THREE.MeshBasicMaterial).opacity =
      datum.kind === "NFZ" ? 0.16 : datum.selected ? 0.25 : 0.2;
    (topBorder.material as THREE.LineBasicMaterial).color.set(nextColor);
    positionAoeMesh(group, datum);
  };

  const createAoeMeshObject = (datum: AoeMeshDatum): THREE.Object3D => {
    const worldRadius = toWorldRadius(datum.radiusKm);
    const height = getCylinderHeight();
    const color = datum.kind === "NFZ" ? zoneColor : roleColor(datum.role);
    const group = new THREE.Group();

    const wall = new THREE.Mesh(
      buildCylinderWallGeometry(worldRadius, height),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: datum.kind === "NFZ" ? 0.26 : datum.selected ? 0.35 : 0.3,
        side: THREE.FrontSide,
        depthWrite: false,
      })
    );
    wall.name = "aoe-wall";

    const cap = new THREE.Mesh(
      buildCylinderCapGeometry(worldRadius),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: datum.kind === "NFZ" ? 0.16 : datum.selected ? 0.25 : 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    cap.name = "aoe-cap";

    const topBorder = new THREE.LineLoop(
      buildRingGeometry(worldRadius, 0),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    topBorder.name = "aoe-border";

    group.add(wall, cap, topBorder);
    group.userData.worldRadius = worldRadius;
    group.userData.cylinderHeight = height;
    positionAoeMesh(group, datum);
    return group;
  };

  const aoeMeshData = useMemo(() => {
    const nextById = new Map<string, AoeMeshDatum>();
    const airborneAoe = state.units.filter(
      (unit) => unit.status === "AIRBORNE" && (unit.aoe_radius ?? 0) > 0
    );

    const nextData = airborneAoe.map((unit) => {
      const id = String(unit.id);
      const existing = aoeDatumByIdRef.current.get(id) ?? {
        id,
        lat: unit.lat,
        lng: unit.lng,
        radiusKm: unit.aoe_radius ?? 0,
        kind: "AOE" as const,
        role: unit.role,
        selected: selectedUnitId === unit.id,
        altitude: AIRBORNE_OVERLAY_ALTITUDE,
      };

      existing.lat = unit.lat;
      existing.lng = unit.lng;
      existing.radiusKm = unit.aoe_radius ?? 0;
      existing.kind = "AOE";
      existing.role = unit.role;
      existing.selected = selectedUnitId === unit.id;
      existing.altitude = AIRBORNE_OVERLAY_ALTITUDE;

      nextById.set(id, existing);
      return existing;
    });

    for (const zone of activeNoFlyZones) {
      const id = `zone-${zone.id}`;
      const existing = aoeDatumByIdRef.current.get(id) ?? {
        id,
        lat: zone.center_lat,
        lng: zone.center_lng,
        radiusKm: zone.radius_km,
        kind: "NFZ" as const,
        selected: false,
        altitude: 0.015,
      };
      existing.lat = zone.center_lat;
      existing.lng = zone.center_lng;
      existing.radiusKm = zone.radius_km;
      existing.kind = "NFZ";
      existing.selected = false;
      existing.altitude = 0.015;
      nextById.set(id, existing);
      nextData.push(existing);
    }

    aoeDatumByIdRef.current = nextById;
    return nextData;
  }, [activeNoFlyZones, selectedUnitId, state.units]);

  useEffect(() => {
    const update = () =>
      setSize({
        width: Math.min(typeof window !== "undefined" ? window.innerWidth - 336 : 1200, 1600),
        height: Math.floor((typeof window !== "undefined" ? window.innerHeight : 900) * 0.72),
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="uppercase tracking-[0.1em]">{state.scenarioTitle ?? "No scenario loaded"}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-[72vh] px-2 pb-2">
        <div
          className="globe-color relative flex h-[72vh] min-h-[560px] w-full items-center justify-center rounded-xl bg-black"
          style={{ filter: "none" }}
        >
          <div className="scanline-overlay"></div>
          <Globe
            ref={globeRef}
            globeImageUrl="https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg"
              backgroundColor="rgba(0,0,0,0)"
              width={size.width}
              height={size.height}
              animateIn={false}
              atmosphereAltitude={0.16}
              atmosphereColor="rgba(148, 163, 184, 0.35)"
              enablePointerInteraction
              customLayerData={aoeMeshData}
              customThreeObject={(d: object) => createAoeMeshObject(d as AoeMeshDatum)}
              customThreeObjectUpdate={(obj: THREE.Object3D, d: object) => updateAoeMeshObject(obj, d as AoeMeshDatum)}
              htmlElementsData={globeMarkers}
              htmlLat="lat"
              htmlLng="lng"
              htmlAltitude={(d: any) => {
                if (d.markerType === "UNIT" || d.markerType === "HOSTILE_UNIT") return AIRBORNE_OVERLAY_ALTITUDE;
                if (d.markerType === "POINT") return 0.001;
                return 0;
              }}
              htmlElement={(d: any) => {
                const container = document.createElement("div");
                container.className = "glp-marker";
                container.style.pointerEvents = "auto";
                if (d.markerType === "BASE") {
                  const icon = document.createElement("div");
                  const symbol = new ms.Symbol(resolveRenderableSidc(d.sidc, "SFGPE---------"), {
                    size: 24,
                  });
                  const symbolSvg = symbol.asSVG();
                  icon.innerHTML = symbolSvg;
                  icon.style.width = "24px";
                  icon.style.height = "24px";
                  icon.style.filter = "drop-shadow(0 0 5px rgba(0,0,0,0.55))";

                  const tooltip = document.createElement("div");
                  tooltip.className = "glp-tooltip glp-tooltip--base";
                  const baseName = d.label ?? d.id ?? "Base";
                  const fuel =
                    typeof d.fuel_reserves === "number"
                      ? d.fuel_reserves.toLocaleString()
                      : "N/A";
                  const assets: Array<{ label: string; quantity: number }> =
                    Array.isArray(d.assetsStationed) ? d.assetsStationed : [];
                  const assetsHtml =
                    assets.length > 0
                      ? `<div class="glp-tooltip-row"><span class="glp-tooltip-label">Assets:</span> ${assets
                          .map((a) =>
                            a.quantity > 1 ? `${a.label} ×${a.quantity}` : a.label
                          )
                          .join(", ")}</div>`
                      : "";
                  tooltip.innerHTML = `
                    <div class="glp-tooltip-title">${baseName}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Fuel:</span> ${fuel}</div>
                    ${assetsHtml}
                  `;

                  container.appendChild(icon);
                  container.appendChild(tooltip);
                  return container;
                }
                if (d.markerType === "HOSTILE_BASE") {
                  const icon = document.createElement("div");
                  const symbol = new ms.Symbol(resolveRenderableSidc(d.sidc, "SHGPE---------"), {
                    size: 24,
                  });
                  icon.innerHTML = symbol.asSVG();
                  icon.style.width = "24px";
                  icon.style.height = "24px";
                  icon.style.filter = "drop-shadow(0 0 6px rgba(255,59,48,0.6))";

                  const tooltip = document.createElement("div");
                  tooltip.className = "glp-tooltip glp-tooltip--hostile-base";
                  const baseName = d.label ?? d.id ?? "Hostile Base";
                  const fuel =
                    typeof d.fuel_reserves === "number"
                      ? d.fuel_reserves.toLocaleString()
                      : "Unknown";
                  tooltip.innerHTML = `
                    <div class="glp-tooltip-title">${baseName}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Fuel:</span> ${fuel}</div>
                  `;

                  container.appendChild(icon);
                  container.appendChild(tooltip);
                  return container;
                }
                if (d.markerType === "UNIT") {
                  const icon = document.createElement("div");
                  const symbol = new ms.Symbol(resolveUnitSidc(d, AIR_ROLE_SIDCS.STRIKE), {
                    size: 18,
                  });
                  icon.innerHTML = symbol.asSVG();
                  icon.style.width = "18px";
                  icon.style.height = "18px";
                  icon.style.filter = "drop-shadow(0 0 4px rgba(0,255,65,0.6))";

                  const tooltip = document.createElement("div");
                  tooltip.className = "glp-tooltip glp-tooltip--unit";
                  const name = d.label ?? d.id ?? "Aircraft";
                  const currentFuel =
                    typeof d.current_fuel === "number"
                      ? d.current_fuel.toLocaleString()
                      : "N/A";
                  const maxFuel =
                    typeof d.max_fuel === "number"
                      ? d.max_fuel.toLocaleString()
                      : "N/A";
                  const lat =
                    typeof d.lat === "number" ? d.lat.toFixed(2) : "—";
                  const lng =
                    typeof d.lng === "number" ? d.lng.toFixed(2) : "—";
                  tooltip.innerHTML = `
                    <div class="glp-tooltip-title">${name}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Fuel:</span> ${currentFuel} / ${maxFuel}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Coords:</span> ${lat}, ${lng}</div>
                  `;

                  container.appendChild(icon);
                  container.appendChild(tooltip);
                  return container;
                }
                if (d.markerType === "HOSTILE_UNIT") {
                  const icon = document.createElement("div");
                  const symbol = new ms.Symbol(resolveUnitSidc(d, "SHAPMF----------"), {
                    size: 18,
                  });
                  icon.innerHTML = symbol.asSVG();
                  icon.style.width = "18px";
                  icon.style.height = "18px";
                  icon.style.filter = "drop-shadow(0 0 6px rgba(255,59,48,0.9))";

                  const tooltip = document.createElement("div");
                  tooltip.className = "glp-tooltip glp-tooltip--hostile-unit";
                  const name = d.label ?? d.id ?? "Hostile Aircraft";
                  const currentFuel =
                    typeof d.current_fuel === "number"
                      ? d.current_fuel.toLocaleString()
                      : "N/A";
                  const maxFuel =
                    typeof d.max_fuel === "number"
                      ? d.max_fuel.toLocaleString()
                      : "N/A";
                  const lat =
                    typeof d.lat === "number" ? d.lat.toFixed(2) : "—";
                  const lng =
                    typeof d.lng === "number" ? d.lng.toFixed(2) : "—";
                  tooltip.innerHTML = `
                    <div class="glp-tooltip-title">${name}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Fuel:</span> ${currentFuel} / ${maxFuel}</div>
                    <div class="glp-tooltip-row"><span class="glp-tooltip-label">Coords:</span> ${lat}, ${lng}</div>
                  `;

                  container.appendChild(icon);
                  container.appendChild(tooltip);
                  return container;
                }
                if (d.markerType === "TRACK") {
                  const el = document.createElement("div");
                  el.style.width = "12px";
                  el.style.height = "12px";
                  el.style.borderRadius = "50%";
                  el.style.border = "2px solid #ff3b30";
                  el.style.backgroundColor = "rgba(255,59,48,0.2)";
                  el.style.boxShadow = "0 0 8px rgba(255,59,48,0.75)";
                  el.title = `${d.label ?? "Hostile Track"} · ${d.confidence ?? 0}%`;
                  return el;
                }

                const el = document.createElement("div");
                el.style.width = "10px";
                el.style.height = "10px";
                el.style.borderRadius = "50%";
                let color = "rgba(200, 200, 200, 0.9)";
                if (d.type === "INTEL") color = "#00ff41";
                if (d.type === "ADMIN") color = "#ffb000";
                if (d.type === "OPS") color = "rgba(59, 130, 246, 0.95)";
                if (d.type === "DROP_ZONE") color = "rgba(34, 197, 94, 0.95)";
                el.style.backgroundColor = color;
                el.style.boxShadow = `0 0 6px ${color}`;
                el.title = [d.label, d.type].filter(Boolean).join(" · ") || "Point";
                return el;
              }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
