"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
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
const AIRBORNE_OVERLAY_ALTITUDE = 0.05;

type AoeMeshDatum = {
  id: string;
  lat: number;
  lng: number;
  radiusKm: number;
  role?: string;
  selected: boolean;
  altitude: number;
};

export default function Globe3D() {
  const { state } = useGameState();
  const { selectedUnitId } = useRemoteGameState();
  const [size, setSize] = useState({ width: 1200, height: 720 });
  const globeRef = useRef<any>(undefined);
  const aoeDatumByIdRef = useRef(new Map<string, AoeMeshDatum>());
  const pointsData = state.globePoints.filter(
    (point) => point.tick == null || point.tick <= state.tick
  );
  const airborneUnits = state.units.filter((unit) => unit.status === "AIRBORNE");
  const globeMarkers = [
    ...state.bases.map((base) => ({
      ...base,
      markerType: "BASE" as const,
    })),
    ...airborneUnits.map((unit) => ({
      ...unit,
      markerType: "UNIT" as const,
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

  const toWorldRadius = (radiusKm: number): number => {
    const globeRadius = globeRef.current?.getGlobeRadius?.() ?? 100;
    return globeRadius * (Math.max(0, radiusKm) / EARTH_RADIUS_KM);
  };

  const buildCircleGeometry = (radius: number): THREE.BufferGeometry =>
    new THREE.CircleGeometry(radius, CIRCLE_SEGMENTS);

  const buildCircleBorderGeometry = (radius: number): THREE.BufferGeometry => {
    const points = new THREE.Path().absarc(0, 0, radius, 0, Math.PI * 2, false).getPoints(CIRCLE_SEGMENTS);
    return new THREE.BufferGeometry().setFromPoints(points);
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
    const fill = group.getObjectByName("aoe-fill") as THREE.Mesh | undefined;
    const border = group.getObjectByName("aoe-border") as THREE.LineLoop | undefined;
    if (!fill || !border) return;

    const worldRadius = toWorldRadius(datum.radiusKm);
    if (group.userData.worldRadius !== worldRadius) {
      const nextFillGeometry = buildCircleGeometry(worldRadius);
      const nextBorderGeometry = buildCircleBorderGeometry(worldRadius);
      (fill.geometry as THREE.BufferGeometry).dispose();
      fill.geometry = nextFillGeometry;
      (border.geometry as THREE.BufferGeometry).dispose();
      border.geometry = nextBorderGeometry;
      group.userData.worldRadius = worldRadius;
    }

    const color = roleColor(datum.role);
    (fill.material as THREE.MeshBasicMaterial).color.set(color);
    (fill.material as THREE.MeshBasicMaterial).opacity = datum.selected ? 0.2 : 0.15;
    (border.material as THREE.LineBasicMaterial).color.set(color);
    positionAoeMesh(group, datum);
  };

  const createAoeMeshObject = (datum: AoeMeshDatum): THREE.Object3D => {
    const worldRadius = toWorldRadius(datum.radiusKm);
    const color = roleColor(datum.role);
    const group = new THREE.Group();

    const fill = new THREE.Mesh(
      buildCircleGeometry(worldRadius),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: datum.selected ? 0.2 : 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    fill.name = "aoe-fill";

    const border = new THREE.LineLoop(
      buildCircleBorderGeometry(worldRadius),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
      })
    );
    border.name = "aoe-border";

    group.add(fill, border);
    group.userData.worldRadius = worldRadius;
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
        role: unit.role,
        selected: selectedUnitId === unit.id,
        altitude: AIRBORNE_OVERLAY_ALTITUDE,
      };

      existing.lat = unit.lat;
      existing.lng = unit.lng;
      existing.radiusKm = unit.aoe_radius ?? 0;
      existing.role = unit.role;
      existing.selected = selectedUnitId === unit.id;
      existing.altitude = AIRBORNE_OVERLAY_ALTITUDE;

      nextById.set(id, existing);
      return existing;
    });

    aoeDatumByIdRef.current = nextById;
    return nextData;
  }, [selectedUnitId, state.units]);

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
        <div className="globe-color relative flex h-[72vh] min-h-[560px] w-full items-center justify-center overflow-hidden rounded-xl bg-black" style={{ filter: "none" }}>
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
              htmlAltitude={(d: any) => (d.markerType === "UNIT" ? AIRBORNE_OVERLAY_ALTITUDE : 0)}
              htmlElement={(d: any) => {
                const el = document.createElement("div");
                if (d.markerType === "BASE") {
                  const symbol = new ms.Symbol(d.sidc ?? "SFGPE---------", {
                    size: 24,
                  });
                  const symbolSvg = symbol.asSVG();
                  el.innerHTML = symbolSvg;
                  el.style.width = "24px";
                  el.style.height = "24px";
                  el.style.filter = "drop-shadow(0 0 5px rgba(0,0,0,0.55))";
                  el.title = d.label ?? d.id ?? "Base";
                  return el;
                }
                if (d.markerType === "UNIT") {
                  const symbol = new ms.Symbol(d.sidc ?? "SFAPMF----------", {
                    size: 18,
                  });
                  el.innerHTML = symbol.asSVG();
                  el.style.width = "18px";
                  el.style.height = "18px";
                  el.style.filter = "drop-shadow(0 0 4px rgba(0,255,65,0.6))";
                  el.title = d.label ?? d.id ?? "Unit";
                  return el;
                }

                el.style.width = "10px";
                el.style.height = "10px";
                el.style.borderRadius = "50%";
                let color = "rgba(200, 200, 200, 0.9)";
                if (d.type === "INTEL") color = "#00ff41";
                if (d.type === "ADMIN") color = "#ffb000";
                if (d.type === "OPS") color = "rgba(59, 130, 246, 0.95)";
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