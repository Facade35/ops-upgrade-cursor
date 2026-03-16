"use client";

import { Pause, Play } from "lucide-react";

import { useGameState } from "@/hooks/use-game-state";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export function ControlPanel() {
  const { state, setTickRate, togglePaused, stopSimulation } = useGameState();

  return (
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
        <div className="flex gap-2 mt-2">
          <Button
            className="flex-1 text-xs"
            size="sm"
            variant="secondary"
            onClick={() => {
              console.info(
                "[ADMIN ACTION]",
                state.paused ? "Resume simulation" : "Pause simulation"
              );
              togglePaused();
            }}
          >
            {state.paused ? <Play className="mr-2 size-4" /> : <Pause className="mr-2 size-4" />}
            {state.paused ? "Resume" : "Pause"}
          </Button>
          <Button
            className="flex-1 text-xs"
            size="sm"
            variant="outline"
            onClick={() => {
              console.info("[ADMIN ACTION] Stop simulation");
              stopSimulation();
            }}
          >
            Stop Sim
          </Button>
        </div>
      </div>
    </section>
  );
}
