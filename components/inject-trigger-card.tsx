"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

import type { InjectTrigger } from "@/types/game";
import { Badge } from "@/components/ui/badge";
import type { InjectResponseRecord } from "@/components/remote-game-state-provider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_CLASSES: Record<string, string> = {
  CRITICAL: "bg-red-500/10 text-red-500 border-red-500/30",
  HIGH: "bg-orange-500/10 text-orange-500 border-orange-500/30",
  MEDIUM: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
  LOW: "bg-blue-500/10 text-blue-500 border-blue-500/30",
};

const TYPE_CLASSES: Record<string, string> = {
  INTEL: "text-[#00ff41] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
  OPS: "text-[#3b82f6] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
  ADMIN: "text-[#ef4444] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
};

/** Stable key for a trigger — used to track responses. */
export function triggerKey(t: InjectTrigger): string {
  return `${t.tick}-${t.title ?? t.content ?? ""}`;
}

// ─── InjectTriggerCard ────────────────────────────────────────────────────────
// Sidebar-only info card. Submission happens in the dedicated Actions tab.

export function InjectTriggerCard({
  trigger,
  currentTick,
  responseRecord,
}: {
  trigger: InjectTrigger;
  currentTick: number;
  responseRecord: InjectResponseRecord | undefined;
}) {
  const submitted = !!responseRecord;

  // ── Deadline countdown ────────────────────────────────────────────────────
  const [ticksRemaining, setTicksRemaining] = useState<number | null>(null);
  const [overdue, setOverdue] = useState(false);
  const alertFiredRef = useRef(false);

  useEffect(() => {
    if (trigger.deadline_tick == null) return;
    const remaining = trigger.deadline_tick - currentTick;
    setTicksRemaining(remaining);

    if (remaining <= 0 && !submitted) {
      setOverdue(true);
      if (!alertFiredRef.current) {
        alertFiredRef.current = true;
      }
    } else {
      setOverdue(false);
      if (remaining > 0) alertFiredRef.current = false;
    }
  }, [trigger.deadline_tick, currentTick, submitted]);

  const priorityCls = trigger.priority
    ? (PRIORITY_CLASSES[trigger.priority] ?? "bg-zinc-600/20 text-zinc-300 border-zinc-600/40")
    : null;
  const typeCls = trigger.type
    ? (TYPE_CLASSES[trigger.type] ?? "bg-zinc-700/70 text-zinc-200")
    : null;

  return (
    <div
      className={`rounded border px-3 py-2.5 transition-all ${
        submitted
          ? "border-zinc-700 bg-zinc-900/40"
          : overdue
            ? "border-red-500 bg-red-950/20 shadow-[0_0_10px_rgba(239,68,68,0.35)]"
            : "border-zinc-800 bg-zinc-900/50"
      }`}
    >
      {/* Type + priority badges */}
      {(typeCls || priorityCls) && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          {typeCls && (
            <Badge className={`rounded px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider ${typeCls}`}>
              {trigger.type}
            </Badge>
          )}
          {typeCls && priorityCls && (
            <span className="text-[9px] font-bold text-zinc-500">:</span>
          )}
          {priorityCls && (
            <Badge className={`rounded px-1.5 py-0 font-mono text-[9px] uppercase tracking-wider ${priorityCls}`}>
              {trigger.priority}
            </Badge>
          )}
        </div>
      )}

      {/* Title */}
      <p className="text-xs font-semibold leading-snug text-white">
        {trigger.title ?? trigger.content ?? `Tick ${trigger.tick}`}
      </p>

      {/* Content preview */}
      {trigger.content && trigger.title && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-400">
          {trigger.content}
        </p>
      )}

      {/* Tick */}
      <p className="mt-1 text-[10px] text-zinc-600">Tick {trigger.tick}</p>

      {/* Deadline countdown */}
      {ticksRemaining !== null && !submitted && (
        <div
          className={`mt-1.5 flex items-center gap-1 font-mono text-[10px] font-semibold ${
            overdue
              ? "text-red-400"
              : ticksRemaining <= 10
                ? "text-amber-400"
                : "text-zinc-400"
          }`}
        >
          <Clock className="size-3 shrink-0" />
          {overdue ? "⚠ OVERDUE" : `DUE IN: ${ticksRemaining} TICKS`}
        </div>
      )}

      {/* Status after submission */}
      {submitted && (
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-500">
          ⏳ Pending AI Grading
        </div>
      )}

      {/* Required response hint (no button — go to Actions tab) */}
      {!submitted && trigger.required_response && (
        <p className="mt-1.5 text-[10px] text-zinc-500">
          Response required in <span className="font-semibold text-zinc-400">Actions</span> tab
        </p>
      )}
    </div>
  );
}
