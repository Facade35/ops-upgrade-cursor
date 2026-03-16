import { NextResponse } from "next/server";
import {
  approveDeploymentRequest,
  createDeploymentRequest,
  denyDeploymentRequest,
  getState,
} from "@/lib/simulation-store";
import type { DeploymentMissionType } from "@/types/game";

export const dynamic = "force-dynamic";

type DeployAction = "request" | "approve" | "deny";

interface DeployBody {
  action?: DeployAction;
  unitId?: string;
  targetLat?: number;
  targetLng?: number;
  departureTick?: number;
  missionType?: DeploymentMissionType;
  requestId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DeployBody;
    if (!body.action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    if (body.action === "request") {
      if (
        !body.unitId ||
        typeof body.targetLat !== "number" ||
        typeof body.targetLng !== "number" ||
        typeof body.departureTick !== "number" ||
        !body.missionType
      ) {
        return NextResponse.json(
          { error: "Missing request fields" },
          { status: 400 }
        );
      }
      const created = createDeploymentRequest({
        unitId: body.unitId,
        targetLat: body.targetLat,
        targetLng: body.targetLng,
        departureTick: body.departureTick,
        missionType: body.missionType,
      });
      if (!created) {
        return NextResponse.json(
          { error: "Unable to create deployment request" },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, request: created, state: getState() });
    }

    if (!body.requestId) {
      return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    }

    const ok =
      body.action === "approve"
        ? approveDeploymentRequest(body.requestId)
        : denyDeploymentRequest(body.requestId);
    if (!ok) {
      return NextResponse.json({ error: "Request not actionable" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, state: getState() });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
