"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import type { SpawnedUnit } from "@/types/game";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { isWithinAoe } from "@/lib/simulation-units";
import { Button } from "@/components/ui/button";

interface AssetDropdownProps {
  unit: SpawnedUnit;
  selectedUnitId: string | null;
  onSelectUnit: (unitId: string | null) => void;
}

export function AssetDropdown({
  unit,
  selectedUnitId,
  onSelectUnit,
}: AssetDropdownProps) {
  const { state, executeMission } = useRemoteGameState();
  const [isSubmittingMission, setIsSubmittingMission] = useState(false);
  const isSelected = selectedUnitId === unit.id;

  const canExecuteMission = useMemo(() => {
    if (unit.status !== "AIRBORNE" || unit.role !== "TRANSPORT") return false;
    const aoeRadius = Math.max(0, unit.aoe_radius ?? 0);
    if (aoeRadius <= 0) return false;
    const completed = new Set(unit.completed_inject_ids ?? []);

    return state.injectTriggers.some((trigger) => {
      if (
        trigger.tick > state.tick ||
        trigger.map_visible === false ||
        typeof trigger.lat !== "number" ||
        typeof trigger.lng !== "number"
      ) {
        return false;
      }
      const triggerKey =
        typeof trigger.id === "string" && trigger.id.trim().length > 0
          ? trigger.id
          : `${trigger.tick}:${trigger.title ?? "inject"}:${trigger.lat.toFixed(4)}:${trigger.lng.toFixed(4)}`;
      if (completed.has(triggerKey)) return false;
      return isWithinAoe(unit.lat, unit.lng, trigger.lat, trigger.lng, aoeRadius);
    });
  }, [state.assets, state.injectTriggers, state.tick, unit]);

  const handleMission = async () => {
    if (isSubmittingMission) return;
    setIsSubmittingMission(true);
    try {
      await executeMission(unit.id);
    } finally {
      setIsSubmittingMission(false);
    }
  };

  return (
    <details
      className={`group rounded border bg-zinc-900/50 ${
        isSelected ? "border-[#00ff41]/60" : "border-zinc-800"
      }`}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm text-white [&::-webkit-details-marker]:hidden"
        onClick={() => onSelectUnit(unit.id)}
      >
        <span className="font-medium">{unit.label}</span>
        <ChevronDown className="size-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <dl className="space-y-1">
          <div className="flex justify-between gap-2">
            <dt>Status</dt>
            <dd className="text-zinc-300">{unit.status}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Fuel</dt>
            <dd className="text-zinc-300">
              {Math.round(unit.current_fuel).toLocaleString()} / {Math.round(unit.max_fuel).toLocaleString()}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Burn rate</dt>
            <dd className="text-zinc-300">
              {unit.fuel_burn_rate.toFixed(2)} ({(unit.fuel_burn_rate * 1000).toLocaleString()} lbs/hr)
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Speed</dt>
            <dd className="text-zinc-300">
              {unit.speed.toFixed(3)} ({Math.round(unit.speed * 1000).toLocaleString()} mph)
            </dd>
          </div>
          {unit.role && (
            <div className="flex justify-between gap-2">
              <dt>Role</dt>
              <dd className="text-zinc-300">{unit.role}</dd>
            </div>
          )}
          {typeof unit.aoe_radius === "number" && unit.aoe_radius > 0 && (
            <div className="flex justify-between gap-2">
              <dt>AOE Radius</dt>
              <dd className="text-zinc-300">{unit.aoe_radius.toLocaleString()} km</dd>
            </div>
          )}
          {unit.capacity > 0 && (
            <div className="flex justify-between gap-2">
              <dt>Capacity</dt>
              <dd className="text-zinc-300">{unit.capacity}</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt>ID</dt>
            <dd className="font-mono text-zinc-500">{unit.id}</dd>
          </div>
        </dl>
        {canExecuteMission && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleMission}
              disabled={isSubmittingMission}
            >
              Execute Mission
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
