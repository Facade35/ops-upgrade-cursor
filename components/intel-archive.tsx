"use client";

import { useGameState } from "@/hooks/use-game-state";
import { Inbox } from "lucide-react";

export function IntelArchive() {
  const { state } = useGameState();
  const injects = [...state.injects].sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.at.localeCompare(b.at);
  });

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Intel Archive</h2>
        <p className="text-sm text-muted-foreground">
          Long-form log of all triggered injects for the intel cell. Entries are chronological and use a coding font for easier parsing.
        </p>
      </div>

      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto rounded-lg border bg-background/60 p-4 font-mono text-sm leading-relaxed">
        {injects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="mb-2 size-6 text-zinc-500" />
            <p className="text-sm text-muted-foreground">No injects have fired yet.</p>
            <p className="mt-1 text-xs text-zinc-600">
              As the simulation runs, chronological intel events will appear in this archive.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {injects.map((inject) => (
              <li key={inject.id} className="border-b border-border/60 pb-3 last:border-b-0 last:pb-0">
                <div className="mb-1 text-xs text-muted-foreground">
                  [Tick {inject.tick}] [{inject.at}]
                </div>
                <div>
                  {`${inject.resource} ${inject.amount > 0 ? "+" : ""}${inject.amount}`}
                  {inject.note ? ` — ${inject.note}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

