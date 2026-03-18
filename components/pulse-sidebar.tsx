"use client";

import { FileText, ShieldAlert, Users } from "lucide-react";

import { AssetDropdown } from "@/components/asset-dropdown";
import { GlobalTensionBar } from "@/components/global-tension-bar";
import { ControlPanel } from "@/components/control-panel";
import { InjectSidebar } from "@/components/inject-sidebar";
import { InjectTriggerCard, triggerKey } from "@/components/inject-trigger-card";
import { useRemoteGameState } from "@/components/remote-game-state-provider";

export function PulseSidebar({ mode = "sandbox" }: { mode?: "admin" | "cadet" | "sandbox" }) {
  const { state, injectResponses, selectedUnitId, setSelectedUnitId } = useRemoteGameState();
  const isCadet = mode === "cadet";
  const baseOrder = ["base_utapao", "base_changi", "base_basa"];
  const orderedBases = [
    ...state.bases.filter((base) => baseOrder.includes(base.id)),
    ...state.bases.filter((base) => !baseOrder.includes(base.id)),
  ];

  // For cadet: only show triggers whose tick has been reached
  const visibleTriggers = state.injectTriggers.filter(
    (t) => !isCadet || t.tick <= state.tick
  );

  return (
    <aside className="fixed left-0 top-0 z-10 flex h-[100dvh] max-h-[100dvh] w-[33vw] flex-col border-r border-zinc-800 bg-[#0a0a0a] overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800 px-3 py-2">
        <div className="flex items-center justify-center gap-2">
          <FileText className="size-4 text-zinc-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white">
            {isCadet ? "Cadet Intel" : "Intel Feed"}
          </h2>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-2">

          {/* Order of battle */}
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Order of Battle</h3>
            {state.units.length === 0 ? (
              <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-center">
                <Users className="mx-auto mb-1.5 size-4 text-zinc-600" />
                <p className="text-xs text-zinc-500">No active units.</p>
                <p className="mt-1 text-[10px] text-zinc-600">
                  Unit groups appear here after scenario assets are initialized.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {orderedBases.map((base) => {
                  const unitsAtHomeBase = state.units.filter(
                    (unit) => unit.home_base === base.id
                  );
                  return (
                    <details
                      key={base.id}
                      className="rounded border border-zinc-800 bg-zinc-900/30"
                    >
                      <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wider text-zinc-300">
                        {base.label} ({unitsAtHomeBase.length})
                      </summary>
                      <div className="space-y-1.5 border-t border-zinc-800 px-2 py-2">
                        {unitsAtHomeBase.length === 0 ? (
                          <div className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-2 text-center">
                            <ShieldAlert className="mx-auto mb-1 size-3.5 text-zinc-600" />
                            <p className="text-[11px] text-zinc-500">No units assigned.</p>
                            <p className="mt-1 text-[10px] text-zinc-600">
                              Assigned assets for this base will list here.
                            </p>
                          </div>
                        ) : (
                          unitsAtHomeBase.map((unit) => (
                            <AssetDropdown
                              key={unit.id}
                              unit={unit}
                              selectedUnitId={selectedUnitId}
                              onSelectUnit={setSelectedUnitId}
                            />
                          ))
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
            {isCadet ? (
              <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/30 px-2 py-2">
                <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Detected Hostile Tracks ({state.knownTracks.length})
                </p>
                {state.knownTracks.length === 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-600">
                    No active tracks detected by ISR/Strike assets.
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {state.knownTracks.map((track) => (
                      <div
                        key={track.id}
                        className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1"
                      >
                        <p className="text-[11px] text-zinc-300">{track.label}</p>
                        <p className="text-[10px] text-zinc-500">
                          Seen T{track.last_seen_tick} · Conf {track.confidence}%
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2 rounded border border-red-900/60 bg-red-950/20 px-2 py-2">
                <p className="text-[11px] uppercase tracking-wider text-red-300">
                  Red Assets ({state.hostileUnits.length})
                </p>
                {state.hostileUnits.length === 0 ? (
                  <p className="mt-1 text-[11px] text-zinc-500">No hostile aircraft active.</p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {state.hostileUnits.map((unit) => (
                      <div
                        key={unit.id}
                        className="rounded border border-red-950/70 bg-black/40 px-2 py-1"
                      >
                        <p className="text-[11px] text-red-200">{unit.label}</p>
                        <p className="text-[10px] text-zinc-500">
                          {unit.status} · Fuel {Math.round(unit.current_fuel)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Admin controls */}
          {!isCadet && <ControlPanel />}

          {/* Intel timeline — inject triggers with response actions */}
          {visibleTriggers.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Intel Timeline
              </h3>
              <div className="space-y-2">
                {visibleTriggers.map((t) => (
                  <InjectTriggerCard
                    key={triggerKey(t)}
                    trigger={t}
                    currentTick={state.tick}
                    responseRecord={injectResponses[triggerKey(t)]}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Fired injects + resources */}
          <InjectSidebar />

        </div>
      </div>

      <div className="flex-shrink-0 border-t border-zinc-800 min-h-[6rem]">
        {isCadet ? (
          <div className="bg-zinc-900/90 px-3 pt-3 pb-6 min-h-[6rem] flex flex-col justify-center">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Global Tension Index
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className="tabular-nums font-mono font-semibold"
                style={{
                  color:
                    state.globalTension > 75
                      ? "#ffb000"
                      : state.globalTension > 50
                        ? "#00ff41"
                        : "var(--muted-foreground)",
                }}
              >
                {state.globalTension}%
              </span>
              {/* Note: In cadet view we just show the tension. To show trend, we'd need recent injects or tension history */}
            </div>
          </div>
        ) : (
          <GlobalTensionBar />
        )}
      </div>
    </aside>
  );
}
