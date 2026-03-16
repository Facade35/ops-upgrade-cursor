"use client";

import { FileText } from "lucide-react";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { AssetDropdown } from "@/components/asset-dropdown";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Pause, Play } from "lucide-react";
import type { InjectTrigger } from "@/types/game";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

function capitalizeResource(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function severityTag(amount: number): { label: string; className: string } {
  if (amount > 5) return { label: "HIGH", className: "bg-red-600/80 text-white" };
  if (amount > 0) return { label: "MEDIUM", className: "bg-amber-500/80 text-white" };
  return { label: "LOW", className: "bg-zinc-600 text-zinc-200" };
}

/** Intel / inject triggers: for cadets only show when currentTick >= trigger.tick */
function InjectTriggersList({
  triggers,
  currentTick,
  cadetMode,
}: {
  triggers: InjectTrigger[];
  currentTick: number;
  cadetMode: boolean;
}) {
  const visible = useMemo(
    () => (cadetMode ? triggers.filter((t) => t.tick <= currentTick) : triggers),
    [triggers, currentTick, cadetMode]
  );
  if (visible.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Intel timeline
      </h3>
      <div className="max-h-[180px] space-y-1.5 overflow-y-auto">
        {visible.map((t, i) => (
          <div
            key={`${t.tick}-${i}`}
            className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2"
          >
            <p className="text-xs font-medium text-white">
              {t.title ?? t.content ?? `Tick ${t.tick}`}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Tick {t.tick}
              {t.type ? ` · ${t.type}` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RemoteSidebar({ mode }: { mode: "admin" | "cadet" }) {
  const {
    state,
    setTickRate,
    setGlobalTension,
    togglePaused,
    selectedUnitId,
    setSelectedUnitId,
  } = useRemoteGameState();
  const resourceEntries = useMemo(() => Object.entries(state.resources), [state.resources]);
  const isCadet = mode === "cadet";
  const [localTension, setLocalTension] = useState(state.globalTension);

  useEffect(() => {
    setLocalTension(state.globalTension);
  }, [state.globalTension]);

  return (
    <aside className="fixed left-0 top-0 z-10 flex h-[100dvh] max-h-[100dvh] w-[33vw] flex-col border-r border-zinc-800 bg-zinc-950 overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-center gap-2">
          <FileText className="size-4 text-zinc-400" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-white">
            {isCadet ? "Cadet Intel" : "Admin Intel"}
          </h2>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <div className="space-y-3">
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Units</h3>
            {state.units.length === 0 ? (
              <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
                No active units.
              </p>
            ) : (
              <div className="space-y-1.5">
                {state.units.map((unit) => (
                  <AssetDropdown
                    key={unit.id}
                    unit={unit}
                    selectedUnitId={selectedUnitId}
                    onSelectUnit={setSelectedUnitId}
                  />
                ))}
              </div>
            )}
          </section>

          {!isCadet && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Simulation Controls
              </h3>
              <div className="space-y-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Tick-rate</span>
                  <span className="font-medium text-white">{state.tickRate}x / sec</span>
                </div>
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[state.tickRate]}
                  onValueChange={(values) => setTickRate(values[0] ?? 1)}
                />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Current Tick</span>
                  <span className="font-medium text-white">{state.tick}</span>
                </div>
                <Button
                  className="w-full text-xs"
                  size="sm"
                  variant={state.paused ? "default" : "secondary"}
                  onClick={() => togglePaused()}
                >
                  {state.paused ? <Play className="mr-2 size-4" /> : <Pause className="mr-2 size-4" />}
                  {state.paused ? "Resume" : "Pause"}
                </Button>
              </div>
            </section>
          )}

          <InjectTriggersList
            triggers={state.injectTriggers}
            currentTick={state.tick}
            cadetMode={isCadet}
          />

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Injects</h3>
            <div className="max-h-[220px] space-y-1.5 overflow-y-auto">
              {state.injects.length === 0 ? (
                <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
                  No injects yet.
                </p>
              ) : (
                state.injects.map((inject) => {
                  const tag = severityTag(inject.amount);
                  return (
                    <div
                      key={inject.id}
                      className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-white">
                            {capitalizeResource(inject.resource)} {inject.amount > 0 ? `+${inject.amount}` : inject.amount}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-500">
                            Tick {inject.tick}
                            {inject.note ? ` · ${inject.note}` : ""}
                          </p>
                        </div>
                        <Badge className={`shrink-0 text-[10px] ${tag.className}`}>{tag.label}</Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Resources</h3>
            <div className="space-y-1.5">
              {resourceEntries.length === 0 ? (
                <p className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
                  No resources yet.
                </p>
              ) : (
                resourceEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs"
                  >
                    <span className="text-zinc-500">{capitalizeResource(key)}</span>
                    <span className="font-medium text-white">{value}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-zinc-800 min-h-[8.5rem] bg-zinc-900/90 px-4 pt-4 pb-10">
        {isCadet ? (
          <div className="flex flex-col justify-center min-h-[3.5rem]">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Global Tension Index
            </span>
            <span
              className={`tabular-nums font-semibold ${
                state.globalTension > 75
                  ? "text-red-500"
                  : state.globalTension > 50
                    ? "text-amber-500"
                    : "text-muted-foreground"
              }`}
            >
              {state.globalTension}%
            </span>
          </div>
        ) : (
          <>
            <div className="tension-slider-wrapper mb-4 min-h-[3.5rem] flex flex-col justify-center">
              <Slider
                min={0}
                max={100}
                step={1}
                value={[localTension]}
                onValueChange={([v]) => setLocalTension(v ?? 0)}
                onValueCommit={([v]) => {
                  const committed = v ?? 0;
                  console.info("[ADMIN ACTION] Global tension committed:", committed);
                  setGlobalTension(committed);
                }}
                className="py-2"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                Global Tension Index
              </span>
              <span
                className={`tabular-nums font-semibold ${
                  state.globalTension > 75
                    ? "text-red-500"
                    : state.globalTension > 50
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }`}
              >
                {state.globalTension}%
              </span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
