"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Inbox, XCircle } from "lucide-react";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { getSimulationTimeDisplay } from "@/lib/simulation-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeploymentMap2D, type DeploymentMapPoint, type DeploymentMapRoute } from "@/components/deployment-map-2d";
import type { GradingStrictness } from "@/types/game";

export function AdminDeploymentsTab() {
  const { state, decideDeploymentRequest } = useRemoteGameState();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [strictnessById, setStrictnessById] = useState<Record<string, GradingStrictness>>({});
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [aiReviewById, setAiReviewById] = useState<
    Record<
      string,
      {
        verdict: "APPROVE" | "DENY";
        summary: string;
        faults: string[];
        recommendations?: string[];
      }
    >
  >({});

  const pending = state.deploymentRequests.filter(
    (request) => request.status === "PENDING_APPROVAL"
  );

  const resolveOrigin = (unitId: string) => {
    const unit = state.units.find((candidate) => candidate.id === unitId);
    if (!unit) return null;
    if (unit.current_base) {
      const base = state.bases.find((candidate) => candidate.id === unit.current_base);
      if (base) return { lat: base.lat, lng: base.lng };
    }
    if (Number.isFinite(unit.lat) && Number.isFinite(unit.lng)) {
      return { lat: unit.lat, lng: unit.lng };
    }
    return null;
  };

  const pendingRoutes: DeploymentMapRoute[] = useMemo(() => {
    const routes: DeploymentMapRoute[] = [];
    for (const request of pending) {
      for (const assignment of request.units) {
        const origin = resolveOrigin(assignment.unit_id);
        if (!origin) continue;
        if (
          assignment.mission_type === "PATROL" &&
          typeof request.patrol_lat_a === "number" &&
          typeof request.patrol_lng_a === "number" &&
          typeof request.patrol_lat_b === "number" &&
          typeof request.patrol_lng_b === "number"
        ) {
          routes.push({
            id: `${request.id}-${assignment.unit_id}-patrol-entry`,
            originLat: origin.lat,
            originLng: origin.lng,
            targetLat: request.patrol_lat_a,
            targetLng: request.patrol_lng_a,
            unitLabel: assignment.unit_label,
            missionType: `${assignment.mission_type} (A)`,
            departureTick: request.departure_tick,
            departureLabel: getSimulationTimeDisplay(
              state.simulationStartTimeIso,
              request.departure_tick,
              state.hoursPerTick
            ),
            status: request.status,
          });
          routes.push({
            id: `${request.id}-${assignment.unit_id}-patrol-loop`,
            originLat: request.patrol_lat_a,
            originLng: request.patrol_lng_a,
            targetLat: request.patrol_lat_b,
            targetLng: request.patrol_lng_b,
            unitLabel: assignment.unit_label,
            missionType: `${assignment.mission_type} (B)`,
            departureTick: request.departure_tick,
            departureLabel: getSimulationTimeDisplay(
              state.simulationStartTimeIso,
              request.departure_tick,
              state.hoursPerTick
            ),
            status: request.status,
          });
          continue;
        }
        routes.push({
          id: `${request.id}-${assignment.unit_id}`,
          originLat: origin.lat,
          originLng: origin.lng,
          targetLat: request.target_lat,
          targetLng: request.target_lng,
          unitLabel: assignment.unit_label,
          missionType: assignment.mission_type,
          departureTick: request.departure_tick,
          departureLabel: getSimulationTimeDisplay(
            state.simulationStartTimeIso,
            request.departure_tick,
            state.hoursPerTick
          ),
          status: request.status,
        });
      }
    }
    return routes;
  }, [pending, state.bases, state.units]);

  const mapPoints: DeploymentMapPoint[] = useMemo(
    () => [
      ...state.bases.map((base) => ({
        id: `base-${base.id}`,
        lat: base.lat,
        lng: base.lng,
        label: base.label,
        kind: "BASE" as const,
        sidc: base.sidc,
      })),
      ...state.units.map((unit) => ({
        id: `unit-${unit.id}`,
        lat: unit.lat,
        lng: unit.lng,
        label: unit.label,
        kind: "UNIT" as const,
        sidc: unit.sidc,
      })),
    ],
    [state.bases, state.units]
  );

  const onDecision = async (requestId: string, decision: "approve" | "deny") => {
    setBusyId(requestId);
    const aiReview = aiReviewById[requestId];
    await decideDeploymentRequest(
      requestId,
      decision,
      decision === "deny" ? aiReview?.summary ?? "Denied by admin review." : undefined
    );
    setBusyId(null);
  };

  const evaluateTaskingOrder = async (requestId: string) => {
    const request = pending.find((candidate) => candidate.id === requestId);
    if (!request) return;
    setAiBusyId(requestId);
    try {
      const response = await fetch("/api/admin/deployments/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strictness: strictnessById[requestId] ?? "BALANCED",
          request,
          context: {
            tick: state.tick,
            airborneUnits: state.units
              .filter((unit) => unit.status === "AIRBORNE")
              .map((unit) => ({
                id: unit.id,
                label: unit.label,
                mission_type: unit.mission_type,
              })),
            recentInjects: state.injects.slice(0, 6),
          },
        }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        verdict: "APPROVE" | "DENY";
        summary: string;
        faults: string[];
        recommendations?: string[];
      };
      setAiReviewById((prev) => ({ ...prev, [requestId]: body }));
    } finally {
      setAiBusyId(null);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tasking Orders</h2>
          <p className="text-sm text-muted-foreground">
            Review cadet tasking orders and approve or deny.
          </p>
        </div>
        <Badge variant="outline">{pending.length}</Badge>
      </div>

      <div className="mb-3">
        <DeploymentMap2D
          title="Tasking Orders Tactical Map"
          routes={pendingRoutes}
          points={mapPoints}
        />
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/30 p-6 text-center">
          <Inbox className="mb-2 size-6 text-zinc-500" />
          <p className="text-sm font-medium text-muted-foreground">No pending tasking orders.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Cadet submissions will appear here for command review and approval.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((request) => (
            <div
              key={request.id}
              className="rounded border border-border bg-background/40 px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{request.order_label}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.units.length} aircraft -&gt; ({request.target_lat.toFixed(2)},{" "}
                    {request.target_lng.toFixed(2)}) at{" "}
                    {getSimulationTimeDisplay(
                      state.simulationStartTimeIso,
                      request.departure_tick,
                      state.hoursPerTick
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Return:{" "}
                    {state.bases.find((base) => base.id === request.return_base_id)?.label ??
                      request.return_base_id}
                    {typeof request.patrol_return_tick === "number"
                      ? ` · Patrol RTB ${getSimulationTimeDisplay(
                          state.simulationStartTimeIso,
                          request.patrol_return_tick,
                          state.hoursPerTick
                        )}`
                      : ""}
                  </p>
                  {typeof request.patrol_lat_a === "number" &&
                    typeof request.patrol_lng_a === "number" &&
                    typeof request.patrol_lat_b === "number" &&
                    typeof request.patrol_lng_b === "number" && (
                      <p className="text-xs text-muted-foreground">
                        Patrol route: ({request.patrol_lat_a.toFixed(2)}, {request.patrol_lng_a.toFixed(2)})
                        {" "}↔ ({request.patrol_lat_b.toFixed(2)}, {request.patrol_lng_b.toFixed(2)})
                      </p>
                    )}
                  <p className="text-xs text-muted-foreground">
                    Units:{" "}
                    {request.units
                      .map((assignment) => `${assignment.unit_label} (${assignment.mission_type})`)
                      .join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Estimated Fuel: {request.estimated_fuel_required.toFixed(1)}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <select
                      className="rounded border border-border bg-background px-2 py-1 text-[10px] uppercase text-zinc-200"
                      value={strictnessById[request.id] ?? "BALANCED"}
                      onChange={(e) =>
                        setStrictnessById((prev) => ({
                          ...prev,
                          [request.id]: e.target.value as GradingStrictness,
                        }))
                      }
                    >
                      <option value="COACHING">Coaching</option>
                      <option value="BALANCED">Balanced</option>
                      <option value="MISSION_READY">Mission-Ready</option>
                      <option value="ZERO_TOLERANCE">Zero-Tolerance</option>
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void evaluateTaskingOrder(request.id)}
                      disabled={aiBusyId === request.id}
                    >
                      {aiBusyId === request.id ? "Evaluating..." : "Run AI Review"}
                    </Button>
                  </div>
                  {aiReviewById[request.id] && (
                    <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2 text-xs">
                      <p className="font-semibold">
                        AI Verdict: {aiReviewById[request.id].verdict}
                      </p>
                      <p>{aiReviewById[request.id].summary}</p>
                      {aiReviewById[request.id].faults.length > 0 && (
                        <ul className="list-disc pl-4">
                          {aiReviewById[request.id].faults.slice(0, 3).map((fault, idx) => (
                            <li key={`${request.id}-fault-${idx}`}>{fault}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void onDecision(request.id, "approve")}
                    disabled={busyId === request.id}
                  >
                    <CheckCircle2 className="mr-1 size-4" />
                    APPROVE
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void onDecision(request.id, "deny")}
                    disabled={busyId === request.id}
                  >
                    <XCircle className="mr-1 size-4" />
                    DENY
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
