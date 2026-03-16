"use client";
import Link from "next/link";
import { ExternalLink, FileClock, Plane, Timer } from "lucide-react";

import Globe3D from "@/components/Globe3D";
import { AdminJsonDropzone } from "@/components/admin-json-dropzone";
import { PulseSidebar } from "@/components/pulse-sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminInjectManager } from "@/components/admin-inject-manager";
import { AdminIntelTab } from "@/components/admin-intel-tab";
import { AdminDeploymentsTab } from "@/components/admin-deployments-tab";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { useAdminTickEngine } from "@/hooks/use-admin-tick-engine";

function AdminContent() {
  const { state } = useRemoteGameState();
  useAdminTickEngine();

  const scenarioTitle = state.scenarioTitle ?? "Admin Control";
  const pendingSorties = state.deploymentRequests.filter(
    (request) => request.status === "PENDING_APPROVAL"
  ).length;
  const upcomingInjects = state.injectTriggers
    .filter((trigger) => trigger.tick >= state.tick)
    .sort((a, b) => a.tick - b.tick);
  const nextInjectTick = upcomingInjects[0]?.tick ?? null;

  return (
    <main className="min-h-screen bg-black text-foreground">
      <PulseSidebar mode="admin" />

      <section className="flex min-w-0 flex-1 flex-col gap-4 p-6 pl-[calc(33vw+16px)]">
        <Tabs defaultValue="command">
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
                <Badge variant="outline">Units {state.units.length}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload scenario JSON and control the master game tick. Cadets
                see updates in real time on the dashboard.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">
                  View Cadet Dashboard
                  <ExternalLink className="ml-1.5 size-4" />
                </Link>
              </Button>
              <TabsList>
                <TabsTrigger value="command">Command Center</TabsTrigger>
                <TabsTrigger value="intel">Intel Triggers</TabsTrigger>
                <TabsTrigger value="deployments">Pending Sorties</TabsTrigger>
                <TabsTrigger value="injects">Inject Manager</TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="command">
            <div className="mt-4 flex flex-col gap-4">
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Plane className="size-4" />
                      Pending Sorties
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-3xl font-semibold">
                    {pendingSorties}
                  </CardContent>
                </Card>
                <Card className="bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <FileClock className="size-4" />
                      Next Inject
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-3xl font-semibold">
                    {nextInjectTick === null ? "None" : `Tick ${nextInjectTick}`}
                  </CardContent>
                </Card>
                <Card className="bg-card/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Timer className="size-4" />
                      Current Tick
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-3xl font-semibold">
                    {state.tick}
                  </CardContent>
                </Card>
              </div>
              <AdminJsonDropzone />
              <Globe3D />
            </div>
          </TabsContent>

          <TabsContent value="intel">
            <div className="mt-4">
              <AdminIntelTab />
            </div>
          </TabsContent>

          <TabsContent value="injects">
            <div className="mt-4">
              <AdminInjectManager />
            </div>
          </TabsContent>

          <TabsContent value="deployments">
            <div className="mt-4">
              <AdminDeploymentsTab />
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}

export default function AdminPage() {
  return <AdminContent />;
}
