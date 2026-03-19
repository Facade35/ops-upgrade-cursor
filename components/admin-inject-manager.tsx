"use client";

import { useState } from "react";
import { Inbox, ShieldAlert } from "lucide-react";

import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { triggerKey } from "@/components/inject-trigger-card";
import type { GameEvent, InjectKind, InjectResponseRequirement, Side } from "@/types/game";
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
  const {
    state,
    injectResponses,
    updateInjectEventTick,
    triggerInjectEventNow,
    createAdminInject,
  } = useRemoteGameState();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [pendingTicks, setPendingTicks] = useState<Record<string, number>>({});
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [injectKind, setInjectKind] = useState<InjectKind>("INFO_UPDATE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<"NOW" | "SCHEDULED">("NOW");
  const [tick, setTick] = useState(String(state.tick));
  const [priority, setPriority] = useState("MEDIUM");
  const [injectType, setInjectType] = useState("OPS");
  const [requiredResponse, setRequiredResponse] =
    useState<InjectResponseRequirement>("NONE");
  const [deadlineTick, setDeadlineTick] = useState("");
  const [mapVisible, setMapVisible] = useState(true);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sidc, setSidc] = useState("");
  const [targetLat, setTargetLat] = useState("");
  const [targetLng, setTargetLng] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("ALL");
  const [nfzRadiusKm, setNfzRadiusKm] = useState("120");
  const [dropZoneRadiusKm, setDropZoneRadiusKm] = useState("30");
  const [warningGraceTicks, setWarningGraceTicks] = useState("2");
  const [appliesToRed, setAppliesToRed] = useState(true);
  const [appliesToBlue, setAppliesToBlue] = useState(false);

  const events = state.events ?? [];
  const triggers = state.injectTriggers ?? [];
  const hostileGroups = state.hostileGroups ?? [];

  const resetCreateForm = () => {
    setTitle("");
    setContent("");
    setMode("NOW");
    setTick(String(state.tick));
    setPriority("MEDIUM");
    setInjectType("OPS");
    setRequiredResponse("NONE");
    setDeadlineTick("");
    setMapVisible(true);
    setLat("");
    setLng("");
    setSidc("");
    setTargetLat("");
    setTargetLng("");
    setTargetGroupId("ALL");
    setNfzRadiusKm("120");
    setDropZoneRadiusKm("30");
    setWarningGraceTicks("2");
    setAppliesToRed(true);
    setAppliesToBlue(false);
  };

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

  const parseNum = (value: string): number | undefined => {
    if (value.trim().length === 0) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleCreate = async () => {
    setCreateError(null);
    setCreateSuccess(null);
    const titleValue = title.trim();
    if (!titleValue) {
      setCreateError("Title is required.");
      return;
    }
    const tickValue =
      mode === "NOW" ? state.tick : Math.max(1, Math.floor(Number(tick) || 1));
    const latNum = parseNum(lat);
    const lngNum = parseNum(lng);
    const targetLatNum = parseNum(targetLat);
    const targetLngNum = parseNum(targetLng);
    const deadlineNum = parseNum(deadlineTick);
    const nfzRadiusNum = parseNum(nfzRadiusKm);
    const dropRadiusNum = parseNum(dropZoneRadiusKm);
    const graceNum = parseNum(warningGraceTicks);

    if (injectKind === "TASK_RED_ASSET") {
      if (!Number.isFinite(targetLatNum) || !Number.isFinite(targetLngNum)) {
        setCreateError("TASK_RED_ASSET requires a target latitude and longitude.");
        return;
      }
    }
    if (injectKind === "CREATE_NFZ") {
      if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lngNum) ||
        !Number.isFinite(nfzRadiusNum)
      ) {
        setCreateError("CREATE_NFZ requires center coordinates and radius.");
        return;
      }
    }
    if (injectKind === "CREATE_DROP_ZONE") {
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        setCreateError("CREATE_DROP_ZONE requires center coordinates.");
        return;
      }
    }

    const appliesTo: Side[] = [];
    if (appliesToRed) appliesTo.push("RED");
    if (appliesToBlue) appliesTo.push("BLUE");

    setIsSubmittingCreate(true);
    try {
      const ok = await createAdminInject({
        injectKind,
        title: titleValue,
        content: content.trim() || undefined,
        tick: tickValue,
        type: injectType,
        priority,
        requiredResponse,
        deadlineTick: Number.isFinite(deadlineNum) ? deadlineNum : undefined,
        lat: Number.isFinite(latNum) ? latNum : undefined,
        lng: Number.isFinite(lngNum) ? lngNum : undefined,
        mapVisible,
        sidc: sidc.trim() || undefined,
        executeNow: mode === "NOW",
        targetLat: Number.isFinite(targetLatNum) ? targetLatNum : undefined,
        targetLng: Number.isFinite(targetLngNum) ? targetLngNum : undefined,
        targetGroupIds: targetGroupId === "ALL" ? [] : [targetGroupId],
        nfzRadiusKm: Number.isFinite(nfzRadiusNum) ? nfzRadiusNum : undefined,
        nfzAppliesTo: appliesTo.length > 0 ? appliesTo : ["RED"],
        warningGraceTicks: Number.isFinite(graceNum) ? graceNum : undefined,
        dropZoneRadiusKm: Number.isFinite(dropRadiusNum) ? dropRadiusNum : undefined,
      });
      if (!ok) {
        setCreateError("Unable to create inject. Check required fields.");
        return;
      }
      setCreateSuccess("Inject created successfully.");
      resetCreateForm();
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Create Inject</h2>
            <p className="text-sm text-muted-foreground">
              Create live injects for tasking, zones, or intel updates.
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Inject Kind
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={injectKind}
              onChange={(e) => setInjectKind(e.target.value as InjectKind)}
            >
              <option value="INFO_UPDATE">INFO_UPDATE</option>
              <option value="TASK_RED_ASSET">TASK_RED_ASSET</option>
              <option value="CREATE_NFZ">CREATE_NFZ</option>
              <option value="CREATE_DROP_ZONE">CREATE_DROP_ZONE</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Title
            <input
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Inject title"
            />
          </label>
          <label className="text-xs text-muted-foreground md:col-span-2">
            Content
            <textarea
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Threat/info update or task details"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Execute
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as "NOW" | "SCHEDULED")}
            >
              <option value="NOW">Now</option>
              <option value="SCHEDULED">Scheduled Tick</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Tick
            <input
              type="number"
              min={1}
              disabled={mode === "NOW"}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-60"
              value={tick}
              onChange={(e) => setTick(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Type
            <input
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={injectType}
              onChange={(e) => setInjectType(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Priority
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Required Response
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={requiredResponse}
              onChange={(e) =>
                setRequiredResponse(e.target.value as InjectResponseRequirement)
              }
            >
              <option value="NONE">NONE</option>
              <option value="MFR">MFR</option>
              <option value="COA">COA</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Deadline Tick (optional)
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={deadlineTick}
              onChange={(e) => setDeadlineTick(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Map Latitude
            <input
              type="number"
              step="0.0001"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Map Longitude
            <input
              type="number"
              step="0.0001"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            SIDC (optional)
            <input
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
              value={sidc}
              onChange={(e) => setSidc(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={mapVisible}
              onChange={(e) => setMapVisible(e.target.checked)}
            />
            Map visible
          </label>
        </div>

        {injectKind === "TASK_RED_ASSET" && (
          <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-3">
            <label className="text-xs text-muted-foreground">
              Target Latitude
              <input
                type="number"
                step="0.0001"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={targetLat}
                onChange={(e) => setTargetLat(e.target.value)}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Target Longitude
              <input
                type="number"
                step="0.0001"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={targetLng}
                onChange={(e) => setTargetLng(e.target.value)}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Target Group
              <select
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={targetGroupId}
                onChange={(e) => setTargetGroupId(e.target.value)}
              >
                <option value="ALL">ALL RED GROUPS</option>
                {hostileGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {injectKind === "CREATE_NFZ" && (
          <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-3">
            <label className="text-xs text-muted-foreground">
              Radius (km)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={nfzRadiusKm}
                onChange={(e) => setNfzRadiusKm(e.target.value)}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Warning Grace Ticks
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={warningGraceTicks}
                onChange={(e) => setWarningGraceTicks(e.target.value)}
              />
            </label>
            <div className="flex items-center gap-4 pt-5 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={appliesToRed}
                  onChange={(e) => setAppliesToRed(e.target.checked)}
                />
                RED
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={appliesToBlue}
                  onChange={(e) => setAppliesToBlue(e.target.checked)}
                />
                BLUE
              </label>
            </div>
          </div>
        )}

        {injectKind === "CREATE_DROP_ZONE" && (
          <div className="grid gap-3 rounded-lg border border-border/70 p-3 md:grid-cols-2">
            <label className="text-xs text-muted-foreground">
              Radius (km)
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
                value={dropZoneRadiusKm}
                onChange={(e) => setDropZoneRadiusKm(e.target.value)}
              />
            </label>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            {createError && <span className="text-red-400">{createError}</span>}
            {!createError && createSuccess && (
              <span className="text-emerald-400">{createSuccess}</span>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={isSubmittingCreate}
          >
            {isSubmittingCreate ? "Creating…" : "Create Inject"}
          </Button>
        </div>
      </div>

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
                  const requiresResponse =
                    t.required_response === "MFR" || t.required_response === "COA";
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
                        {requiresResponse ? (
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
                        ) : requiresResponse ? (
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
