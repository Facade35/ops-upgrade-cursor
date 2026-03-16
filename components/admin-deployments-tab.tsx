"use client";

import { useState } from "react";
import { CheckCircle2, Inbox, XCircle } from "lucide-react";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function AdminDeploymentsTab() {
  const { state, decideDeploymentRequest } = useRemoteGameState();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = state.deploymentRequests.filter(
    (request) => request.status === "PENDING_APPROVAL"
  );

  const onDecision = async (requestId: string, decision: "approve" | "deny") => {
    setBusyId(requestId);
    await decideDeploymentRequest(requestId, decision);
    setBusyId(null);
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pending Sorties</h2>
          <p className="text-sm text-muted-foreground">
            Review cadet deployment requests and approve or deny.
          </p>
        </div>
        <Badge variant="outline">{pending.length}</Badge>
      </div>

      {pending.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-background/30 p-6 text-center">
          <Inbox className="mb-2 size-6 text-zinc-500" />
          <p className="text-sm font-medium text-muted-foreground">No pending sortie requests.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Cadet submissions will appear here for command review and approval.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((request) => (
            <div
              key={request.id}
              className="rounded border border-border bg-background/40 px-3 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{request.unit_label}</p>
                  <p className="text-xs text-muted-foreground">
                    {request.mission_type} -&gt; ({request.target_lat.toFixed(2)},{" "}
                    {request.target_lng.toFixed(2)}) at Tick {request.departure_tick}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Estimated Fuel: {request.estimated_fuel_required.toFixed(1)}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void onDecision(request.id, "approve")}
                    disabled={busyId === request.id}
                  >
                    <CheckCircle2 className="mr-1 size-4" />
                    APPROVE
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void onDecision(request.id, "deny")}
                    disabled={busyId === request.id}
                  >
                    <XCircle className="mr-1 size-4" />
                    DENY
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
