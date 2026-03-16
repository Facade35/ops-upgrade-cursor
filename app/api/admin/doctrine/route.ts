import { NextResponse } from "next/server";
import {
  executeTransportMission,
  getState,
  initiateAerialRefuel,
} from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

interface DoctrineBody {
  action?: "initiate_refuel" | "execute_mission";
  unitId?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as DoctrineBody;
    if (!body.action || !body.unitId) {
      return NextResponse.json(
        { error: "Missing action or unitId" },
        { status: 400 }
      );
    }

    const ok =
      body.action === "initiate_refuel"
        ? initiateAerialRefuel(body.unitId)
        : executeTransportMission(body.unitId);

    if (!ok) {
      return NextResponse.json(
        { error: "Doctrine action not available for this unit state" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, state: getState() });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
