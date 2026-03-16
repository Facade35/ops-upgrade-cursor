"use client";

import { useState } from "react";
import { Inbox, ShieldAlert } from "lucide-react";

import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { triggerKey } from "@/components/inject-trigger-card";
import type { GameEvent } from "@/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function summarizeInjects(event: GameEvent): string {
  const entries = Object.entries(event.injects);
  if (entries.length === 0) return "No resource changes";
  return entries
    .map(([key, amount]) => {
      const sign = amount > 0 ? "+" : "";
      return `${key}: ${sign}${amount}`;
    })
    .join(" · ");
}

export function AdminInjectManager() {
  const { state, injectResponses, updateInjectEventTick, triggerInjectEventNow } =
    useRemoteGameState();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [pendingTicks, setPendingTicks] = useState<Record<string, number>>({});

  const events = state.events ?? [];
  const triggers = state.injectTriggers ?? [];

  const handleTickChange = (id: string, value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    setPendingTicks((prev) => ({ ...prev, [id]: Math.max(1, Math.round(num)) }));
  };

  const saveTick = async (event: GameEvent) => {
    const id = event.id ?? "";
    if (!id) return;
    const tick = pendingTicks[id] ?? event.tick;
    setSavingId(id);
    try {
      await updateInjectEventTick(id, tick);
    } finally {
      setSavingId(null);
    }
  };

  const triggerNow = async (event: GameEvent) => {
    const id = event.id ?? "";
    if (!id) return;
    setTriggeringId(id);
    try {
      await triggerInjectEventNow(id);
    } finally {
      setTriggeringId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">

      {/* ── Intel Triggers table ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Intel Triggers</h2>
            <p className="text-sm text-muted-foreground">
              Inject triggers from the scenario JSON. Tracks cadet response submissions in real time.
            </p>
          </div>
          <Badge variant="outline">Triggers {triggers.length}</Badge>
        </div>

        <div className="overflow-x-auto rounded-lg border bg-background/40">
          {triggers.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <ShieldAlert className="mb-2 size-6 text-zinc-500" />
              <p className="text-sm text-muted-foreground">No intel triggers loaded.</p>
              <p className="mt-1 text-xs text-zinc-600">
                Upload a scenario with <code className="font-mono text-xs">inject_triggers</code> to manage cadet response windows here.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-background/90">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-14 px-4 py-3 text-left">Tick</th>
                  <th className="min-w-[180px] px-4 py-3 text-left">Title</th>
                  <th className="w-24 px-4 py-3 text-left">Type</th>
                  <th className="w-24 px-4 py-3 text-left">Required</th>
                  <th className="w-28 px-4 py-3 text-left">Deadline</th>
                  <th className="min-w-[160px] px-4 py-3 text-left">Cadet Status</th>
                </tr>
              </thead>
              <tbody>
                {triggers.map((t, i) => {
                  const key = triggerKey(t);
                  const response = injectResponses[key];
                  const ticksLeft =
                    t.deadline_tick != null
                      ? t.deadline_tick - state.tick
                      : null;
                  const overdue = ticksLeft !== null && ticksLeft <= 0;

                  return (
                    <tr
                      key={`${key}-${i}`}
                      className={`border-b border-border/60 hover:bg-muted/40 ${
                        overdue && !response ? "bg-red-950/20" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {t.tick}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {t.title ?? "—"}
                        {t.content && (
                          <p className="mt-0.5 line-clamp-1 text-[11px] font-normal text-muted-foreground">
                            {t.content}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.type && (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {t.type}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {t.required_response ? (
                          <Badge
                            className={`font-mono text-[10px] ${
                              t.required_response === "MFR"
                                ? "bg-blue-700/60 text-blue-100"
                                : "bg-emerald-700/60 text-emerald-100"
                            }`}
                          >
                            {t.required_response}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {ticksLeft !== null ? (
                          <span
                            className={
                              overdue
                                ? "text-red-400"
                                : ticksLeft <= 10
                                  ? "text-amber-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {overdue ? "OVERDUE" : `T-${ticksLeft}`}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {response ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge className="w-fit bg-amber-600/20 font-mono text-[10px] text-amber-400 hover:bg-amber-600/20">
                              ⏳ PENDING AI GRADING
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">
                              {response.responseType} ·{" "}
                              {new Date(response.submittedAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ) : t.required_response ? (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-muted-foreground"
                          >
                            AWAITING CADET
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Resource Inject Events table ─────────────────────────────────── */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Inject Manager</h2>
            <p className="text-sm text-muted-foreground">
              Review resource injection events, adjust ticks, or manually trigger an inject.
            </p>
          </div>
          <Badge variant="outline">Events {events.length}</Badge>
        </div>

        <div className="max-h-[calc(100vh-32rem)] overflow-y-auto rounded-lg border bg-background/40">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <Inbox className="mb-2 size-6 text-zinc-500" />
              <p className="text-sm text-muted-foreground">No inject events loaded.</p>
              <p className="mt-1 text-xs text-zinc-600">
                Upload a scenario on the Command Center tab to populate event controls.
              </p>
            </div>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-background/90">
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Tick</th>
                  <th className="px-3 py-2 text-left">Summary</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => {
                  const id = event.id ?? `event-${index + 1}`;
                  const pendingTick = pendingTicks[id] ?? event.tick;
                  const isSaving = savingId === id;
                  const isTriggering = triggeringId === id;

                  return (
                    <tr key={id} className="border-b border-border/60 hover:bg-muted/40">
                      <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">
                        {id}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            className="w-20 rounded border border-border bg-background px-2 py-1 text-xs"
                            value={pendingTick}
                            onChange={(e) => handleTickChange(id, e.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isSaving}
                            onClick={() => void saveTick(event)}
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {event.note ?? "No note"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {summarizeInjects(event)}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={isTriggering}
                          onClick={() => void triggerNow(event)}
                        >
                          {isTriggering ? "Triggering…" : "Trigger now"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}
