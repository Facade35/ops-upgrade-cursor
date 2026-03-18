"use client";

import Globe3D from "@/components/Globe3D";
import { PulseSidebar } from "@/components/pulse-sidebar";
import { triggerKey } from "@/components/inject-trigger-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntelArchive } from "@/components/intel-archive";
import { CadetActionsTab } from "@/components/cadet-actions-tab";
import { CadetDeploymentsTab } from "@/components/cadet-deployments-tab";
import { useRemoteGameState } from "@/components/remote-game-state-provider";

function DashboardContent() {
  const { state, injectResponses } = useRemoteGameState();

  const scenarioTitle = state.scenarioTitle ?? "Cadet Dashboard";
  const actionsBadgeCount = state.injectTriggers.filter((trigger) => {
    if (trigger.tick > state.tick) return false;
    if (!trigger.required_response) return false;
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {state.paused ? "Paused" : "Running"}
                </Badge>
                <Badge variant="outline">Tick {state.tick}</Badge>
                <Badge variant="outline">Blue Units {state.units.length}</Badge>
                <Badge variant="outline">Tracks {state.knownTracks.length}</Badge>
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
