"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import ms from "milsymbol";

export interface DeploymentMapRoute {
  id: string;
  originLat: number;
  originLng: number;
  targetLat: number;
  targetLng: number;
  unitLabel?: string;
  missionType?: string;
  departureTick?: number;
  departureLabel?: string;
  status?: string;
}

export interface DeploymentMapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "BASE" | "UNIT";
  sidc?: string;
}

interface DeploymentMap2DProps {
  title: string;
  routes: DeploymentMapRoute[];
  points?: DeploymentMapPoint[];
  onMapClick?: (coords: { lat: number; lng: number }) => void;
  className?: string;
}

type HoveredRoute = {
  id: string;
  unitLabel?: string;
  missionType?: string;
  departureTick?: number;
  departureLabel?: string;
  status?: string;
};

const EARTH_BLUE_MARBLE_URL =
  "https://unpkg.com/three-globe@2.31.1/example/img/earth-blue-marble.jpg";
const BASE_FALLBACK_SIDC = "SFGPE---------";
const UNIT_FALLBACK_SIDC = "SFAPMF----------";
const MARKER_MAX_PX = 20;
/** Max zoom (wheel); higher = closer inspection of routes and symbols. */
const MAP_MAX_ZOOM = 24;
const sidcValidityCache = new Map<string, boolean>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lngToX(lng: number, width: number): number {
  return ((lng + 180) / 360) * width;
}

function latToY(lat: number, height: number): number {
  return ((90 - lat) / 180) * height;
}

function xToLng(x: number, width: number): number {
  return (x / width) * 360 - 180;
}

function yToLat(y: number, height: number): number {
  return 90 - (y / height) * 180;
}

function routeColor(status: string | undefined): string {
  if (status === "PENDING_APPROVAL") return "#f59e0b";
  if (status === "DRAFT") return "#22c55e";
  return "#60a5fa";
}

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

/** Raster size for map markers; position uses bbox center on lat/lng. */
function buildMarkerLayout(sidc: string) {
  const sym = new ms.Symbol(sidc, { size: MARKER_MAX_PX });
  const finalSym = sym.isValid() ? sym : new ms.Symbol(UNIT_FALLBACK_SIDC, { size: MARKER_MAX_PX });
  const { width: w, height: h } = finalSym.getSize();
  const scale = Math.min(MARKER_MAX_PX / w, MARKER_MAX_PX / h);
  return {
    markerUrl: finalSym.toDataURL(),
    width: w * scale,
    height: h * scale,
  };
}

export function DeploymentMap2D({
  title,
  routes,
  points = [],
  onMapClick,
  className,
}: DeploymentMap2DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [hoveredRoute, setHoveredRoute] = useState<HoveredRoute | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<DeploymentMapPoint | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const applySize = () => {
      const rect = node.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };
    applySize();

    const observer = new ResizeObserver(() => applySize());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const stopWheelScroll = (event: Event) => {
      event.preventDefault();
    };
    node.addEventListener("wheel", stopWheelScroll, { passive: false });
    return () => node.removeEventListener("wheel", stopWheelScroll);
  }, []);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [title]);

  const projectedRoutes = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return [];
    return routes.flatMap((route) => {
      if (
        !Number.isFinite(route.originLat) ||
        !Number.isFinite(route.originLng) ||
        !Number.isFinite(route.targetLat) ||
        !Number.isFinite(route.targetLng)
      ) {
        return [];
      }
      return {
        ...route,
        x1: lngToX(route.originLng, canvasSize.width),
        y1: latToY(route.originLat, canvasSize.height),
        x2: lngToX(route.targetLng, canvasSize.width),
        y2: latToY(route.targetLat, canvasSize.height),
      };
    });
  }, [canvasSize.height, canvasSize.width, routes]);

  const projectedPoints = useMemo(() => {
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return [];
    return points.flatMap((point) => {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return [];
      const fallbackSidc = point.kind === "BASE" ? BASE_FALLBACK_SIDC : UNIT_FALLBACK_SIDC;
      const sidc =
        typeof point.sidc === "string" && point.sidc.trim().length > 0 && isRenderableSidc(point.sidc)
          ? point.sidc
          : fallbackSidc;
      return {
        ...point,
        x: lngToX(point.lng, canvasSize.width),
        y: latToY(point.lat, canvasSize.height),
        ...buildMarkerLayout(sidc),
      };
    });
  }, [canvasSize.height, canvasSize.width, points]);

  const worldToScreen = (x: number, y: number) => ({
    x: x * zoom + offset.x,
    y: y * zoom + offset.y,
  });

  const screenToWorld = (screenX: number, screenY: number) => ({
    x: (screenX - offset.x) / zoom,
    y: (screenY - offset.y) / zoom,
  });

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = clamp(event.clientX - rect.left, 0, canvasSize.width);
    const screenY = clamp(event.clientY - rect.top, 0, canvasSize.height);
    const world = screenToWorld(screenX, screenY);
    const x = clamp(world.x, 0, canvasSize.width);
    const y = clamp(world.y, 0, canvasSize.height);
    setHoverCoords({
      lat: yToLat(y, canvasSize.height),
      lng: xToLng(x, canvasSize.width),
    });
    if (dragStart) {
      setOffset((prev) => ({
        x: prev.x + (event.clientX - dragStart.x),
        y: prev.y + (event.clientY - dragStart.y),
      }));
      setDragStart({ x: event.clientX, y: event.clientY });
    }
  };

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onMapClick || !containerRef.current || canvasSize.width <= 0 || canvasSize.height <= 0) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = clamp(event.clientX - rect.left, 0, canvasSize.width);
    const screenY = clamp(event.clientY - rect.top, 0, canvasSize.height);
    const world = screenToWorld(screenX, screenY);
    const x = clamp(world.x, 0, canvasSize.width);
    const y = clamp(world.y, 0, canvasSize.height);
    onMapClick({
      lat: yToLat(y, canvasSize.height),
      lng: xToLng(x, canvasSize.width),
    });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!containerRef.current || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    event.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    const worldBefore = screenToWorld(screenX, screenY);
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.1 : 0.9), 1, MAP_MAX_ZOOM);
    const nextOffset = {
      x: screenX - worldBefore.x * nextZoom,
      y: screenY - worldBefore.y * nextZoom,
    };
    setZoom(nextZoom);
    setOffset(nextOffset);
  };

  const onRouteHover = (
    route: Pick<
      DeploymentMapRoute,
      "id" | "unitLabel" | "missionType" | "departureTick" | "departureLabel" | "status"
    > | null
  ) => {
    if (route) {
      setHoveredRoute({
        id: route.id,
        unitLabel: route.unitLabel,
        missionType: route.missionType,
        departureTick: route.departureTick,
        departureLabel: route.departureLabel,
        status: route.status,
      });
    } else {
      setHoveredRoute(null);
    }
  };

  return (
    <div className={`overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40 ${className ?? ""}`}>
      <div className="border-b border-zinc-800 px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">{title}</p>
      </div>
      <div
        ref={containerRef}
        className={`relative w-full overflow-hidden bg-black ${dragStart ? "cursor-grabbing" : "cursor-grab"} aspect-[2/1] min-h-[280px] max-h-[380px]`}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={() => {
          setHoveredRoute(null);
          setDragStart(null);
        }}
        onClick={handleCanvasClick}
        onWheel={handleWheel}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          setDragStart({ x: event.clientX, y: event.clientY });
        }}
        onMouseUp={() => setDragStart(null)}
      >
        <div
          className="absolute left-0 top-0"
          style={{
            width: `${canvasSize.width}px`,
            height: `${canvasSize.height}px`,
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <img
            src={EARTH_BLUE_MARBLE_URL}
            alt="Earth blue marble"
            className="absolute inset-0 h-full w-full object-fill select-none"
            draggable={false}
          />
          <svg className="absolute inset-0 h-full w-full" role="presentation">
            {projectedRoutes.map((route) => (
              <g key={route.id}>
                <line
                  x1={route.x1}
                  y1={route.y1}
                  x2={route.x2}
                  y2={route.y2}
                  stroke={routeColor(route.status)}
                  strokeWidth={1.25}
                  strokeOpacity={0.92}
                  onMouseEnter={() => onRouteHover(route)}
                  onMouseLeave={() => onRouteHover(null)}
                />
                <circle
                  cx={route.x2}
                  cy={route.y2}
                  r={2.5}
                  fill="#f8fafc"
                  stroke={routeColor(route.status)}
                  strokeWidth={1}
                  onMouseEnter={() => onRouteHover(route)}
                  onMouseLeave={() => onRouteHover(null)}
                />
              </g>
            ))}
          </svg>

          {projectedPoints.map((point) => (
            <div
              key={point.id}
              role="img"
              aria-label={point.label}
              onMouseEnter={() => setSelectedPoint(point)}
              onMouseLeave={() =>
                setSelectedPoint((prev) => (prev?.id === point.id ? null : prev))
              }
              className="absolute flex items-center justify-center p-0"
              style={{
                left: `${point.x - point.width / 2}px`,
                top: `${point.y - point.height / 2}px`,
                width: `${point.width}px`,
                height: `${point.height}px`,
                transform: `scale(${1 / zoom})`,
                transformOrigin: "center center",
              }}
            >
              <img
                src={point.markerUrl}
                alt=""
                width={point.width}
                height={point.height}
                className="block max-h-full max-w-full object-contain drop-shadow-[0_0_3px_rgba(0,0,0,0.7)]"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {selectedPoint && canvasSize.width > 0 && canvasSize.height > 0 && (
          <div
            className="pointer-events-none absolute rounded bg-black/75 px-2 py-1 text-[11px] text-zinc-100"
            style={{
              left: `${clamp(worldToScreen(lngToX(selectedPoint.lng, canvasSize.width), latToY(selectedPoint.lat, canvasSize.height)).x + 10, 8, canvasSize.width - 140)}px`,
              top: `${clamp(worldToScreen(lngToX(selectedPoint.lng, canvasSize.width), latToY(selectedPoint.lat, canvasSize.height)).y - 10, 8, canvasSize.height - 52)}px`,
            }}
          >
            <p className="font-semibold">{selectedPoint.label}</p>
            <p>
              {selectedPoint.lat.toFixed(4)}, {selectedPoint.lng.toFixed(4)}
            </p>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-zinc-200">
          {hoverCoords
            ? `Lat ${hoverCoords.lat.toFixed(4)} · Lng ${hoverCoords.lng.toFixed(4)}`
            : "Move cursor for coordinates"}
        </div>
        {hoveredRoute && (
          <div className="pointer-events-none absolute right-2 top-2 rounded bg-black/70 px-2 py-1.5 text-[11px] text-zinc-100">
            <p className="font-semibold">{hoveredRoute.unitLabel || "Route"}</p>
            <p>{hoveredRoute.missionType || "Mission"}</p>
            {hoveredRoute.departureLabel && <p>{hoveredRoute.departureLabel}</p>}
            {!hoveredRoute.departureLabel && hoveredRoute.departureTick != null && (
              <p>Tick {hoveredRoute.departureTick}</p>
            )}
            {hoveredRoute.status && <p>{hoveredRoute.status}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
