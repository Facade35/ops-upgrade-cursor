"use client";

import Globe3D from "@/components/Globe3D";
import { PulseSidebar } from "@/components/pulse-sidebar";
import { triggerKey } from "@/components/inject-trigger-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntelArchive } from "@/components/intel-archive";
import { CadetActionsTab } from "@/components/cadet-actions-tab";
import { CadetDeploymentsTab } from "@/components/cadet-deployments-tab";
import { getSimulationTimeDisplay } from "@/lib/simulation-time";
import { cn } from "@/lib/utils";
import { useRemoteGameState } from "@/components/remote-game-state-provider";

/** Status pills (plain divs — avoids Badge base `px-2.5` fighting custom padding). */
const dashboardStatusPill =
  "inline-flex items-center justify-center rounded-full border border-zinc-700/90 bg-zinc-800 px-8 py-2.5 text-xs font-medium leading-snug text-zinc-100 shadow-sm";

function DashboardContent() {
  const { state, injectResponses } = useRemoteGameState();

  const scenarioTitle = state.scenarioTitle ?? "Cadet Dashboard";
  const actionsBadgeCount = state.injectTriggers.filter((trigger) => {
    if (trigger.tick > state.tick) return false;
    if (trigger.required_response !== "MFR" && trigger.required_response !== "COA") {
      return false;
    }
    return !injectResponses[triggerKey(trigger)];
  }).length;
  const deploymentsBadgeCount = state.deploymentRequests.filter(
    (request) => request.status === "PENDING_APPROVAL"
  ).length;

  return (
    <main className="min-h-screen bg-black text-foreground">
      <PulseSidebar mode="cadet" />

      <section className="flex min-w-0 flex-1 flex-col gap-4 p-6 pl-[calc(33vw+16px)]">
        <Tabs defaultValue="map">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-[0.1em] uppercase">
                {scenarioTitle}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <div className={cn(dashboardStatusPill)} role="status">
                  {state.paused ? "Paused" : "Running"}
                </div>
                <div className={cn(dashboardStatusPill, "font-mono tabular-nums")} role="status">
                  {getSimulationTimeDisplay(
                    state.simulationStartTimeIso,
                    state.tick,
                    state.hoursPerTick
                  )}
                </div>
                <div className={cn(dashboardStatusPill)} role="status">
                  Blue Units {state.units.length}
                </div>
                <div className={cn(dashboardStatusPill)} role="status">
                  Tracks {state.knownTracks.length}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Read-only view. Intel and resources update in real time from the
                admin session.
              </p>
            </div>
            <TabsList>
              <TabsTrigger value="map">Tactical Map</TabsTrigger>
              <span className="relative inline-flex">
                <TabsTrigger value="actions">Actions</TabsTrigger>
                {actionsBadgeCount > 0 && (
                  <span className="pointer-events-none absolute left-full top-0 z-10 inline-flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-500 bg-zinc-800 px-1 text-[10px] font-semibold leading-none text-zinc-100">
                    {actionsBadgeCount}
                  </span>
                )}
              </span>
              <TabsTrigger value="deployments">
                <span className="inline-flex items-center gap-2">
                  Deployments
                  {deploymentsBadgeCount > 0 && (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                      {deploymentsBadgeCount}
                    </span>
                  )}
                </span>
              </TabsTrigger>
              <TabsTrigger value="intel">Intel Archive</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="map">
            <div className="mt-4">
              <Globe3D />
            </div>
          </TabsContent>

          <TabsContent value="actions">
            <div className="mt-4">
              <CadetActionsTab />
            </div>
          </TabsContent>

          <TabsContent value="deployments">
            <div className="mt-4">
              <CadetDeploymentsTab />
            </div>
          </TabsContent>

          <TabsContent value="intel">
            <div className="mt-4">
              <IntelArchive />
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
