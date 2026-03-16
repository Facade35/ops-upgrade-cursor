import { NextResponse } from "next/server";
import { setGlobalTension, setPaused, setTickRate, stopSimulation } from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      tickRate?: number;
      paused?: boolean;
      globalTension?: number;
      stop?: boolean;
    };
    if (typeof body.tickRate === "number" && body.tickRate >= 1) {
      setTickRate(Math.min(10, Math.max(1, Math.round(body.tickRate))));
    }
    if (typeof body.paused === "boolean") {
      setPaused(body.paused);
    }
    if (typeof body.globalTension === "number") {
      setGlobalTension(body.globalTension);
    }
    if (body.stop === true) {
      stopSimulation();
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
