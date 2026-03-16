"use client";

import { useMemo } from "react";
import { Inbox, ShieldAlert } from "lucide-react";

import { useGameState } from "@/hooks/use-game-state";
import { Badge } from "@/components/ui/badge";

function capitalizeResource(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function severityTag(amount: number): { label: string; className: string } {
  if (amount > 5) return { label: "HIGH", className: "bg-[#ffb000] text-black" };
  if (amount > 0) return { label: "MEDIUM", className: "bg-[#00ff41]/80 text-black" };
  return { label: "LOW", className: "bg-zinc-600 text-zinc-200" };
}

export function InjectSidebar() {
  const { state } = useGameState();
  const resourceEntries = useMemo(() => Object.entries(state.resources), [state.resources]);

  return (
    <div className="w-full space-y-4">
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Injects</h3>
        <div className="max-h-[220px] space-y-1.5 overflow-y-auto">
          {state.injects.length === 0 ? (
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-center">
              <Inbox className="mx-auto mb-1.5 size-4 text-zinc-600" />
              <p className="text-xs text-zinc-500">No injects yet.</p>
              <p className="mt-1 text-[10px] text-zinc-600">
                Triggered inject events will appear here as ticks advance.
              </p>
            </div>
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
                        {capitalizeResource(inject.resource)} <span className="font-mono tabular-nums">{inject.amount > 0 ? `+${inject.amount}` : inject.amount}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Tick <span className="font-mono tabular-nums">{inject.tick}</span>
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
            <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-3 text-center">
              <ShieldAlert className="mx-auto mb-1.5 size-4 text-zinc-600" />
              <p className="text-xs text-zinc-500">Upload a definition to initialize resources.</p>
              <p className="mt-1 text-[10px] text-zinc-600">
                Resource levels and trend changes will populate after scenario load.
              </p>
            </div>
          ) : (
            resourceEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-xs"
              >
                <span className="text-zinc-500">{capitalizeResource(key)}</span>
                <span className="font-medium text-white font-mono tabular-nums">{value}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
