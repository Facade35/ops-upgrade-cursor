"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileText, ShieldAlert, Target } from "lucide-react";

import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { triggerKey } from "@/components/inject-trigger-card";
import type { Asset, GradingStrictness, InjectTrigger } from "@/types/game";
import type { InjectResponseRecord } from "@/components/remote-game-state-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Shared constants ─────────────────────────────────────────────────────────

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

// ─── COA inline form ─────────────────────────────────────────────────────────

function COAForm({
  assets,
  selections,
  reasoning,
  onToggle,
  onSetAlloc,
  onSetReasoning,
}: {
  assets: Asset[];
  selections: Record<string, { selected: boolean; allocation: number }>;
  reasoning: string;
  onToggle: (id: string) => void;
  onSetAlloc: (id: string, v: number) => void;
  onSetReasoning: (v: string) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/30 p-5 text-center">
        <ShieldAlert className="mb-2 size-5 text-zinc-500" />
        <p className="text-sm font-medium text-muted-foreground">No assets declared in this scenario.</p>
        <p className="mt-1 text-xs text-zinc-600">
          Asset options for COA assignments will populate after scenario assets are loaded.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        Assign Assets
      </p>
      <div className="space-y-2">
        {assets.map((asset) => {
          const s = selections[asset.id];
          const selected = s?.selected ?? false;
          return (
            <div
              key={asset.id}
              className={`rounded-lg border p-3 transition-all ${
                selected
                  ? "border-emerald-600/50 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/40"
              }`}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggle(asset.id)}
                  className="size-4 accent-emerald-500"
                />
                <span className="text-sm font-medium text-white">{asset.label}</span>
              </label>
              {selected && (
                <div className="mt-3 pl-7">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Force Allocation</span>
                    <span className="font-semibold text-emerald-400">
                      {s?.allocation ?? 50}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    step={10}
                    value={s?.allocation ?? 50}
                    onChange={(e) => onSetAlloc(asset.id, Number(e.target.value))}
                    className="mt-1.5 w-full accent-emerald-500"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Commander&apos;s Reasoning
        </p>
        <textarea
          value={reasoning}
          onChange={(e) => onSetReasoning(e.target.value)}
          placeholder="Explain your course of action and justify asset selection…"
          rows={4}
          className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
        />
      </div>
    </div>
  );
}

// ─── Single trigger response card ─────────────────────────────────────────────

function TriggerResponseCard({
  trigger,
  currentTick,
  assets,
  responseRecord,
  onSubmit,
}: {
  trigger: InjectTrigger;
  currentTick: number;
  assets: Asset[];
  responseRecord: InjectResponseRecord | undefined;
  onSubmit: (triggerId: string, responseType: "MFR" | "COA", content: string) => void;
}) {
  const id = triggerKey(trigger);
  const submitted =
    !!responseRecord &&
    responseRecord.status !== "resubmit_required" &&
    responseRecord.status !== "expired";
  const requiredResponse = trigger.required_response;
  const requiresMfr = requiredResponse === "MFR";
  const requiresCoa = requiredResponse === "COA";
  const requiresResponse = requiresMfr || requiresCoa;
  const resubmitFeedback =
    responseRecord?.status === "resubmit_required" ? responseRecord.grade : undefined;

  const ticksRemaining =
    trigger.deadline_tick != null ? trigger.deadline_tick - currentTick : null;
  const overdue = ticksRemaining !== null && ticksRemaining <= 0;

  // Sound alert — fires once when the deadline is crossed with no response
  const alertFiredRef = useRef(false);
  useEffect(() => {
    if (overdue && !submitted && !alertFiredRef.current) {
      alertFiredRef.current = true;
    }
    if (!overdue) alertFiredRef.current = false;
  }, [overdue, submitted]);

  // MFR draft
  const [mfrText, setMfrText] = useState("");

  // COA draft
  const [coaSelections, setCoaSelections] = useState<
    Record<string, { selected: boolean; allocation: number }>
  >({});
  const [coaReasoning, setCoaReasoning] = useState("");

  const coaToggle = (assetId: string) =>
    setCoaSelections((prev) => ({
      ...prev,
      [assetId]: {
        selected: !(prev[assetId]?.selected ?? false),
        allocation: prev[assetId]?.allocation ?? 50,
      },
    }));

  const coaSetAlloc = (assetId: string, v: number) =>
    setCoaSelections((prev) => ({
      ...prev,
      [assetId]: { ...prev[assetId]!, allocation: v },
    }));

  const canSubmitMFR = mfrText.trim().length >= 10;
  const canSubmitCOA = Object.values(coaSelections).some((s) => s.selected);

  const handleSubmit = () => {
    if (requiresMfr) {
      onSubmit(id, "MFR", mfrText.trim());
    } else if (requiresCoa) {
      const lines: string[] = [`COA — ${trigger.title ?? "Untitled"}`, ""];
      lines.push("ASSIGNED ASSETS:");
      for (const asset of assets) {
        const s = coaSelections[asset.id];
        if (s?.selected) {
          lines.push(`  • ${asset.label}  — ${s.allocation}% allocation`);
        }
      }
      if (coaReasoning.trim()) {
        lines.push("", "COMMANDER REASONING:", coaReasoning.trim());
      }
      onSubmit(id, "COA", lines.join("\n"));
    }
  };

  const priorityCls = trigger.priority
    ? (PRIORITY_CLASSES[trigger.priority] ?? "bg-zinc-600/20 text-zinc-300 border-zinc-600/40")
    : null;
  const typeCls = trigger.type
    ? (TYPE_CLASSES[trigger.type] ?? "bg-zinc-700/70 text-zinc-200")
    : null;

  return (
    <div
      className={`rounded-xl border bg-card transition-all ${
        submitted
          ? "border-zinc-700"
          : overdue
            ? "border-red-500 shadow-[0_0_16px_rgba(239,68,68,0.25)]"
            : "border-zinc-700"
      }`}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {typeCls && (
              <Badge className={`font-mono text-[10px] uppercase tracking-wider ${typeCls}`}>
                {trigger.type}
              </Badge>
            )}
            {typeCls && priorityCls && (
              <span className="text-[10px] font-bold text-zinc-500">:</span>
            )}
            {priorityCls && (
              <Badge className={`font-mono text-[10px] uppercase tracking-wider ${priorityCls}`}>
                {trigger.priority}
              </Badge>
            )}
            {requiresResponse && (
              <Badge
                className={`font-mono text-[10px] uppercase tracking-wider ${
                  requiresMfr
                    ? "bg-blue-700/60 text-blue-100"
                    : "bg-emerald-700/60 text-emerald-100"
                }`}
              >
                <span className="flex items-center gap-1">
                  {requiresMfr ? (
                    <FileText className="size-3 shrink-0" />
                  ) : (
                    <Target className="size-3 shrink-0" />
                  )}
                  {requiredResponse} Required
                </span>
              </Badge>
            )}
          </div>
          <h3 className="text-base font-semibold text-white">
            {trigger.title ?? `Tick ${trigger.tick} Event`}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">Released at Tick {trigger.tick}</p>
        </div>

        {/* Deadline */}
        {ticksRemaining !== null && (
          <div
            className={`flex shrink-0 flex-col items-end gap-0.5 font-mono text-xs font-semibold ${
              submitted
                ? "text-zinc-600"
                : overdue
                  ? "text-red-400"
                  : ticksRemaining <= 10
                    ? "text-amber-400"
                    : "text-zinc-400"
            }`}
          >
            <div className="flex items-center gap-1">
              {overdue && !submitted ? (
                <AlertTriangle className="size-3.5 shrink-0" />
              ) : (
                <Clock className="size-3.5 shrink-0" />
              )}
              {submitted
                ? "SUBMITTED"
                : overdue
                  ? "OVERDUE"
                  : `DUE IN ${ticksRemaining} TICKS`}
            </div>
            {trigger.deadline_tick != null && (
              <span className="text-[10px] font-normal text-zinc-600">
                Deadline: Tick {trigger.deadline_tick}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Inject brief ───────────────────────────────────────────────── */}
      {trigger.content && (
        <div className="border-b border-zinc-800 bg-zinc-900/40 px-5 py-3">
          <p className="text-sm leading-relaxed text-zinc-300">{trigger.content}</p>
        </div>
      )}

      {/* ── Response area ──────────────────────────────────────────────── */}
      <div className="p-5">
        {submitted ? (
          /* Already submitted — show confirmation */
          <div className="flex items-start gap-3 rounded-lg border border-amber-600/30 bg-amber-950/20 p-4">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-semibold text-amber-300">
                {responseRecord.status === "approved"
                  ? "APPROVED"
                  : "Response Submitted — Awaiting Staff Review"}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {responseRecord.responseType} submitted at{" "}
                {new Date(responseRecord.submittedAt).toLocaleTimeString()}
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                {responseRecord.status === "approved"
                  ? "Your response has been approved by staff."
                  : "Staff will provide feedback directly if updates are required."}
              </p>
            </div>
          </div>
        ) : requiresMfr ? (
          /* MFR inline form */
          <div className="space-y-3 rounded-lg border border-border border-t-primary/40 bg-card/50 p-4 md:border-t-2">
            {responseRecord?.status === "resubmit_required" && (
              <p className="rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                Resubmission requested by staff. Update your MFR and submit again.
              </p>
            )}
            {resubmitFeedback && (
              <div className="rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                <p className="font-semibold uppercase tracking-wider text-[10px] text-amber-300">
                  AI Feedback
                </p>
                <p className="mt-1">{resubmitFeedback.summary}</p>
                {resubmitFeedback.faults.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {resubmitFeedback.faults.slice(0, 3).map((fault, idx) => (
                      <li key={idx}>{fault}</li>
                    ))}
                  </ul>
                )}
                {resubmitFeedback.recommendations?.length ? (
                  <p className="mt-1 text-amber-200">
                    Next: {resubmitFeedback.recommendations.slice(0, 2).join(" | ")}
                  </p>
                ) : null}
              </div>
            )}
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Memorandum For Record
            </p>
            <textarea
              value={mfrText}
              onChange={(e) => setMfrText(e.target.value)}
              placeholder={
                "Type your memorandum here…\n\nInclude: situation assessment, recommended actions, and justification."
              }
              rows={8}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 p-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-600">{mfrText.length} characters</span>
              <Button
                disabled={!canSubmitMFR}
                onClick={handleSubmit}
                variant="secondary"
              >
                <FileText className="mr-2 size-4" />
                Submit MFR
              </Button>
            </div>
          </div>
        ) : requiresCoa ? (
          /* COA inline form */
          <div className="space-y-4 rounded-lg border border-border border-t-primary/40 bg-card/50 p-4 md:border-t-2">
            {responseRecord?.status === "resubmit_required" && (
              <p className="rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-300">
                Resubmission requested by staff. Update your COA and submit again.
              </p>
            )}
            {resubmitFeedback && (
              <div className="rounded border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100">
                <p className="font-semibold uppercase tracking-wider text-[10px] text-amber-300">
                  AI Feedback
                </p>
                <p className="mt-1">{resubmitFeedback.summary}</p>
                {resubmitFeedback.faults.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {resubmitFeedback.faults.slice(0, 3).map((fault, idx) => (
                      <li key={idx}>{fault}</li>
                    ))}
                  </ul>
                )}
                {resubmitFeedback.recommendations?.length ? (
                  <p className="mt-1 text-amber-200">
                    Next: {resubmitFeedback.recommendations.slice(0, 2).join(" | ")}
                  </p>
                ) : null}
              </div>
            )}
            <COAForm
              assets={assets}
              selections={coaSelections}
              reasoning={coaReasoning}
              onToggle={coaToggle}
              onSetAlloc={coaSetAlloc}
              onSetReasoning={setCoaReasoning}
            />
            <div className="flex justify-end">
              <Button
                disabled={!canSubmitCOA}
                onClick={handleSubmit}
                variant="secondary"
              >
                <Target className="mr-2 size-4" />
                Submit COA
              </Button>
            </div>
          </div>
        ) : (
          /* No response required */
          <p className="text-sm text-zinc-600">No response required for this inject.</p>
        )}
      </div>
    </div>
  );
}

// ─── CadetActionsTab ──────────────────────────────────────────────────────────

export function CadetActionsTab() {
  const { state, injectResponses, submitInjectResponse, gradeInjectResponse } =
    useRemoteGameState();
  const [activeInjectIndex, setActiveInjectIndex] = useState(0);

  const visibleTriggers = state.injectTriggers.filter(
    (t) => t.tick <= state.tick
  );

  useEffect(() => {
    setActiveInjectIndex((prev) => {
      if (visibleTriggers.length === 0) return 0;
      return Math.min(prev, visibleTriggers.length - 1);
    });
  }, [visibleTriggers.length]);

  const handleSubmit = (
    trigger: InjectTrigger,
    responseType: "MFR" | "COA",
    content: string
  ) => {
    const strictness: GradingStrictness = trigger.strictness ?? "BALANCED";
    const key = triggerKey(trigger);
    submitInjectResponse(key, responseType, content, strictness);
    void gradeInjectResponse(key, {
      responseType,
      content,
      strictness,
      missedDeadline: false,
    });
  };

  if (!state.loadedFileName) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-card p-16 text-center">
        <FileText className="mb-3 size-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No scenario loaded</p>
        <p className="mt-1 text-xs text-zinc-600">
          Waiting for the admin to upload a scenario JSON.
        </p>
      </div>
    );
  }

  if (visibleTriggers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-card p-16 text-center">
        <Clock className="mb-3 size-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No actions due yet</p>
        <p className="mt-1 text-xs text-zinc-600">
          Intel triggers will appear here as the simulation advances.
        </p>
      </div>
    );
  }

  const activeTrigger = visibleTriggers[activeInjectIndex];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveInjectIndex((prev) => Math.max(prev - 1, 0))}
          disabled={activeInjectIndex === 0}
        >
          Previous
        </Button>
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Inject {activeInjectIndex + 1} of {visibleTriggers.length}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setActiveInjectIndex((prev) =>
              Math.min(prev + 1, visibleTriggers.length - 1)
            )
          }
          disabled={activeInjectIndex === visibleTriggers.length - 1}
        >
          Next
        </Button>
      </div>
      <TriggerResponseCard
        key={triggerKey(activeTrigger)}
        trigger={activeTrigger}
        currentTick={state.tick}
        assets={state.assets}
        responseRecord={injectResponses[triggerKey(activeTrigger)]}
        onSubmit={(triggerId, responseType, content) =>
          handleSubmit(activeTrigger, responseType, content)
        }
      />
    </div>
  );
}
