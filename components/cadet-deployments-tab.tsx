"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Inbox, Plane, Send } from "lucide-react";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { estimateFuelRequired } from "@/lib/simulation-units";
import type { DeploymentMissionType } from "@/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MISSION_TYPES: DeploymentMissionType[] = [
  "ISR",
  "Strike",
  "Transport",
  "Search & Rescue",
];

export function CadetDeploymentsTab() {
  const { state, submitDeploymentRequest } = useRemoteGameState();
  const groundedUnits = useMemo(
    () =>
      state.units.filter(
        (unit) =>
          unit.status === "GROUNDED" &&
          !!unit.current_base &&
          unit.deployment_status !== "PENDING_APPROVAL"
      ),
    [state.units]
  );

  const [unitId, setUnitId] = useState<string>("");
  const [targetLat, setTargetLat] = useState<string>("");
  const [targetLng, setTargetLng] = useState<string>("");
  const [departureTick, setDepartureTick] = useState<string>("");
  const [missionType, setMissionType] = useState<DeploymentMissionType>("ISR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedUnit = groundedUnits.find((unit) => unit.id === unitId);
  const lat = Number(targetLat);
  const lng = Number(targetLng);
  const fuelEstimate =
    selectedUnit && Number.isFinite(lat) && Number.isFinite(lng)
      ? estimateFuelRequired(selectedUnit, lat, lng)
      : null;

  const pendingSorties = state.deploymentRequests.filter(
    (req) => req.status === "PENDING_APPROVAL"
  );

  const canSubmit =
    !!selectedUnit &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Number.isFinite(Number(departureTick)) &&
    Number(departureTick) >= state.tick;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUnit || !canSubmit) return;

    setSubmitting(true);
    setError(null);
    const ok = await submitDeploymentRequest({
      unitId: selectedUnit.id,
      missionType,
      targetLat: Number(targetLat),
      targetLng: Number(targetLng),
      departureTick: Number(departureTick),
    });
    setSubmitting(false);

    if (!ok) {
      setError("Unable to submit request. Check values and try again.");
      return;
    }

    setUnitId("");
    setTargetLat("");
    setTargetLng("");
    setDepartureTick("");
    setMissionType("ISR");
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="space-y-4 rounded-xl border border-border border-t-primary/40 bg-card/50 p-4 shadow-sm md:border-t-2"
      >
        <div>
          <h2 className="text-lg font-semibold">Deployment Manager</h2>
          <p className="text-sm text-muted-foreground">
            Submit sortie requests for grounded units. Requests require admin approval.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Asset Selection</span>
            <select
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
            >
              <option value="">Select grounded unit...</option>
              {groundedUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Mission Type</span>
            <select
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
              value={missionType}
              onChange={(e) => setMissionType(e.target.value as DeploymentMissionType)}
            >
              {MISSION_TYPES.map((mission) => (
                <option key={mission} value={mission}>
                  {mission}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Target Latitude</span>
            <input
              type="number"
              step="0.0001"
              value={targetLat}
              onChange={(e) => setTargetLat(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Target Longitude</span>
            <input
              type="number"
              step="0.0001"
              value={targetLng}
              onChange={(e) => setTargetLng(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Departure Tick</span>
            <input
              type="number"
              min={state.tick}
              value={departureTick}
              onChange={(e) => setDepartureTick(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Estimated Fuel Required</span>
            <input
              type="text"
              readOnly
              value={fuelEstimate == null ? "Select unit and target" : fuelEstimate.toFixed(1)}
              className="w-full rounded border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button type="submit" disabled={!canSubmit || submitting}>
          <Send className="mr-2 size-4" />
          {submitting ? "Submitting..." : "Submit Deployment Request"}
        </Button>
      </form>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Pending Sorties</h3>
          <Badge variant="outline">{pendingSorties.length}</Badge>
        </div>
        {pendingSorties.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/40 p-6 text-center">
            <Inbox className="mb-2 size-6 text-zinc-500" />
            <p className="text-sm font-medium text-muted-foreground">No pending requests.</p>
            <p className="mt-1 text-xs text-zinc-600">
              Submitted deployment approvals will appear here for status tracking.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingSorties.map((req) => (
              <div
                key={req.id}
                className="rounded border border-border bg-background/40 px-3 py-2 text-sm"
              >
                <p className="font-medium">{req.unit_label}</p>
                <p className="text-xs text-muted-foreground">
                  {req.mission_type} to ({req.target_lat.toFixed(2)}, {req.target_lng.toFixed(2)}) at
                  Tick {req.departure_tick}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {groundedUnits.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-card p-12 text-center">
          <Plane className="mx-auto mb-2 size-6 text-zinc-500" />
          <p className="text-sm text-muted-foreground">
            No grounded units available for deployment.
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Units become deployable when scenarios load and return to base.
          </p>
        </div>
      )}
    </div>
  );
}
