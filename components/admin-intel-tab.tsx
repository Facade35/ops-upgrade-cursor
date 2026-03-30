"use client";

import { AlertTriangle, CheckCircle2, Clock, FileText, Target } from "lucide-react";

import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { triggerKey } from "@/components/inject-trigger-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GradingStrictness } from "@/types/game";

const PRIORITY_CLASSES: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-amber-500 text-white",
  LOW: "bg-zinc-600 text-zinc-200",
};

const TYPE_CLASSES: Record<string, string> = {
  INTEL: "text-[#00ff41] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
  OPS: "text-[#3b82f6] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
  ADMIN: "text-[#ef4444] bg-transparent hover:bg-transparent border-transparent p-0 shadow-none",
};

export function AdminIntelTab() {
  const {
    state,
    injectResponses,
    setTriggerStrictness,
    setInjectResponseStatus,
    createAdminInject,
  } = useRemoteGameState();
  const triggers = state.injectTriggers ?? [];

  if (!state.loadedFileName) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-card p-16 text-center">
        <FileText className="mb-3 size-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No scenario loaded</p>
        <p className="mt-1 text-xs text-zinc-600">
          Upload a scenario JSON to see intel triggers here.
        </p>
      </div>
    );
  }

  if (triggers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-card p-16 text-center">
        <FileText className="mb-3 size-8 text-zinc-600" />
        <p className="text-sm font-medium text-zinc-400">No intel triggers defined</p>
        <p className="mt-1 text-xs text-zinc-600">
          Add an <code className="font-mono text-xs">inject_triggers</code> array to the scenario JSON.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {triggers.map((t, i) => {
        const key = triggerKey(t);
        const response = injectResponses[key];
        const requiredResponse = t.required_response;
        const requiresMfr = requiredResponse === "MFR";
        const requiresCoa = requiredResponse === "COA";
        const requiresResponse = requiresMfr || requiresCoa;
        const ticksRemaining =
          t.deadline_tick != null ? t.deadline_tick - state.tick : null;
        const overdue = ticksRemaining !== null && ticksRemaining <= 0;
        const released = t.tick <= state.tick;

        const requestResubmission = () =>
          setInjectResponseStatus(key, "resubmit_required");
        const acceptResponse = () => setInjectResponseStatus(key, "graded");
        const approveProposal = async () => {
          const proposal = response?.injectProposal;
          if (!proposal) return;
          await createAdminInject({
            injectKind: "INFO_UPDATE",
            title: proposal.title ?? "Follow-up Inject",
            content: proposal.content,
            tick: proposal.tick ?? state.tick + 1,
            type: proposal.type ?? "OPS",
            priority: proposal.priority ?? "MEDIUM",
            requiredResponse: proposal.required_response ?? "NONE",
            deadlineTick: proposal.deadline_tick,
            lat: proposal.lat,
            lng: proposal.lng,
            mapVisible: proposal.map_visible ?? true,
            sidc: proposal.sidc,
            executeNow: false,
          });
          setInjectResponseStatus(key, "graded");
        };

        const priorityCls = t.priority
          ? (PRIORITY_CLASSES[t.priority] ?? "bg-zinc-600 text-zinc-200")
          : null;
        const typeCls = t.type
          ? (TYPE_CLASSES[t.type] ?? "bg-zinc-700/70 text-zinc-200")
          : null;

        return (
          <div
            key={`${key}-${i}`}
            className={`overflow-hidden rounded-xl border bg-card transition-all ${
              response
                ? "border-amber-600/40"
                : overdue && !response
                  ? "border-red-500/70"
                  : released
                    ? "border-zinc-700"
                    : "border-zinc-800 opacity-60"
            }`}
          >
            {/* ── Header ──────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-5">
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {typeCls && (
                    <Badge className={`font-mono text-[10px] uppercase tracking-wider ${typeCls}`}>
                      {t.type}
                    </Badge>
                  )}
                  {typeCls && priorityCls && (
                    <span className="text-[10px] font-bold text-zinc-500">:</span>
                  )}
                  {priorityCls && (
                    <Badge className={`font-mono text-[10px] uppercase tracking-wider ${priorityCls}`}>
                      {t.priority}
                    </Badge>
                  )}
                  <select
                    className="ml-2 rounded border border-border bg-background px-2 py-1 text-[10px] uppercase text-zinc-200"
                    value={t.strictness ?? "BALANCED"}
                    onChange={(e) =>
                      setTriggerStrictness(
                        t.id ?? key,
                        e.target.value as GradingStrictness
                      )
                    }
                  >
                    <option value="COACHING">Coaching</option>
                    <option value="BALANCED">Balanced</option>
                    <option value="MISSION_READY">Mission-Ready</option>
                    <option value="ZERO_TOLERANCE">Zero-Tolerance</option>
                  </select>
                  {!released && (
                    <Badge variant="outline" className="font-mono text-[10px] text-zinc-500">
                      NOT YET RELEASED
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
                  {t.title ?? `Tick ${t.tick} Event`}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Releases at Tick {t.tick}
                </p>
              </div>

              {/* Deadline status */}
              <div className="flex shrink-0 flex-col items-end gap-1">
                {ticksRemaining !== null ? (
                  <div
                    className={`flex items-center gap-1.5 font-mono text-sm font-semibold ${
                      response
                        ? "text-zinc-500"
                        : overdue
                          ? "text-red-400"
                          : ticksRemaining <= 10
                            ? "text-amber-400"
                            : "text-zinc-400"
                    }`}
                  >
                    {overdue && !response ? (
                      <AlertTriangle className="size-4 shrink-0" />
                    ) : (
                      <Clock className="size-4 shrink-0" />
                    )}
                    {response
                      ? "SUBMITTED"
                      : overdue
                        ? "OVERDUE"
                        : `T‑${ticksRemaining}`}
                  </div>
                ) : null}
                {t.deadline_tick != null && (
                  <span className="text-[10px] text-zinc-600">
                    Deadline: Tick {t.deadline_tick}
                  </span>
                )}
              </div>
            </div>

            {/* ── Brief content ────────────────────────────────────────── */}
            {t.content && (
              <div className="border-b border-zinc-800 bg-zinc-900/30 px-5 py-3">
                <p className="text-sm leading-relaxed text-zinc-400">{t.content}</p>
              </div>
            )}

            {/* ── Cadet response area ──────────────────────────────────── */}
            <div className="p-5 space-y-3">
              {response ? (
                <>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-amber-400" />
                    <span className="text-sm font-semibold text-amber-300">
                      {response.status === "pending"
                        ? "Response Pending AI Grading"
                        : response.status === "resubmit_required"
                          ? "Resubmission Required"
                          : response.status === "error"
                            ? "Error during grading"
                            : "AI Graded"}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">
                      {response.responseType} · {new Date(response.submittedAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Submitted Content
                    </p>
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-zinc-200">
                      {response.content}
                    </pre>
                  </div>

                  {response.grade && (
                    <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-4 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200">
                        AI Summary & Recommendation
                      </p>
                      <p className="text-sm text-emerald-100">Verdict: {response.grade.verdict}</p>
                      <p className="text-sm text-emerald-50">{response.grade.summary}</p>
                      {response.grade.faults?.length ? (
                        <ul className="list-disc pl-5 text-sm text-emerald-100">
                          {response.grade.faults.slice(0, 4).map((f, idx) => (
                            <li key={idx}>{f}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}

                  {response.injectProposal && (
                    <div className="rounded-lg border border-blue-800/40 bg-blue-950/20 p-4 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-200">
                        AI Inject Proposal
                      </p>
                      <p className="text-sm text-blue-100 font-semibold">
                        {response.injectProposal.title}
                      </p>
                      {response.injectProposal.content && (
                        <p className="text-sm text-blue-50">
                          {response.injectProposal.content}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={acceptResponse}>
                      Accept
                    </Button>
                    <Button size="sm" variant="secondary" onClick={requestResubmission}>
                      Request Resubmission
                    </Button>
                    {response.injectProposal && (
                      <Button size="sm" onClick={() => void approveProposal()}>
                        Approve Proposal
                      </Button>
                    )}
                  </div>

                  {response.error && (
                    <p className="text-xs text-red-400">Error: {response.error}</p>
                  )}
                </>
              ) : requiresResponse ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Clock className="size-4 shrink-0" />
                  Awaiting cadet {requiredResponse} submission…
                </div>
              ) : (
                <p className="text-sm text-zinc-600">No response required.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
