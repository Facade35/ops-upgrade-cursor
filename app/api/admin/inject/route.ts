import { NextResponse } from "next/server";
import { triggerEventNow, updateEventTick } from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "trigger" | "update";
      id?: string;
      tick?: number;
    };

    if (!body.id || !body.action) {
      return NextResponse.json({ error: "Missing id or action" }, { status: 400 });
    }

    if (body.action === "trigger") {
      triggerEventNow(body.id);
    } else if (body.action === "update") {
      if (typeof body.tick !== "number" || !Number.isInteger(body.tick) || body.tick < 1) {
        return NextResponse.json({ error: "Invalid tick" }, { status: 400 });
      }
      updateEventTick(body.id, body.tick);
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}

