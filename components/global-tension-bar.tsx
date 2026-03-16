"use client";

import { useEffect, useState } from "react";
import { useGameState } from "@/hooks/use-game-state";
import { Slider } from "@/components/ui/slider";

export function GlobalTensionBar() {
  const { state, setGlobalTension } = useGameState();
  const [localTension, setLocalTension] = useState(state.globalTension);
  const pct = localTension;

  useEffect(() => {
    setLocalTension(state.globalTension);
  }, [state.globalTension]);

  const textColor =
    pct > 75 ? "text-red-500" : pct > 50 ? "text-amber-500" : "text-muted-foreground";

  return (
    <div className="bg-zinc-900/90 px-3 pt-3 pb-6 min-h-[6rem]">
      <div className="tension-slider-wrapper mb-2 min-h-[2.5rem] flex flex-col justify-center" data-tension-slider>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[pct]}
          onValueChange={([v]) => setLocalTension(v ?? 0)}
          onValueCommit={([v]) => {
            const committed = v ?? 0;
            console.info("[ADMIN ACTION] Global tension committed:", committed);
            setGlobalTension(committed);
          }}
          className="py-1"
        />
      </div>
      <div className="flex items-center justify-between gap-2 pr-2">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Global Tension Index
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`tabular-nums font-mono font-semibold ${textColor}`}>{pct}%</span>
          {(() => {
            const recentInjects = state.injects.filter(i => i.resource === 'global_tension' && i.tick >= state.tick - 5);
            const sum = recentInjects.reduce((acc, i) => acc + i.amount, 0);
            if (sum > 0) return <span className="text-[#ffb000]">▲</span>;
            if (sum < 0) return <span className="text-[#00ff41]">▼</span>;
            return <span className="text-zinc-500">-</span>;
          })()}
        </div>
      </div>
    </div>
  );
}
