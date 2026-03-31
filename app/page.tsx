"use client";

import Globe3D from "@/components/Globe3D";
import { GameStateProvider } from "@/components/game-state-provider";
import { useGameState } from "@/hooks/use-game-state";
import { getSimulationTimeDisplay } from "@/lib/simulation-time";
import { JsonDropzone } from "@/components/json-dropzone";
import { PulseSidebar } from "@/components/pulse-sidebar";
import { Badge } from "@/components/ui/badge";

function SandboxContent() {
  const { state } = useGameState();

  return (
    <main className="min-h-screen bg-black text-foreground">
      <PulseSidebar />

      <section className="flex min-w-0 flex-1 flex-col gap-4 p-6 pl-[calc(33vw+16px)]">
        <header className="rounded-xl border bg-card p-4">
          <h1 className="text-2xl font-semibold tracking-tight">GLP Engine Sandbox</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{state.paused ? "Paused" : "Running"}</Badge>
            <Badge variant="outline" className="font-mono">
              {getSimulationTimeDisplay(
                state.simulationStartTimeIso,
                state.tick,
                state.hoursPerTick
              )}
            </Badge>
            <Badge variant="outline">Assets {state.assets.length}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload a GLP JSON config to drive global resources and timeline inject events in real-time.
          </p>
        </header>

        <JsonDropzone />

        <Globe3D />
      </section>
    </main>
  );
}

export default function HomePage() {
  return (
    <GameStateProvider>
      <SandboxContent />
    </GameStateProvider>
  );
}
