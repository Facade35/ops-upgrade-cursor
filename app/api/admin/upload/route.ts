import { NextResponse } from "next/server";
import { getInitialTickRate, parseDefinition } from "@/lib/parse-game-definition";
import { loadDefinition } from "@/lib/simulation-store";
import type { GameDefinition } from "@/types/game";

export const dynamic = "force-dynamic";

function isParsedDefinition(obj: unknown): obj is GameDefinition {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "resources" in obj &&
    "bases" in obj &&
    "assets" in obj &&
    Array.isArray((obj as GameDefinition).bases) &&
    Array.isArray((obj as GameDefinition).assets)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      scenario?: unknown;
      definition?: unknown;
      fileName?: string;
      initialTickRate?: number;
    };
    const raw = body.definition ?? body.scenario ?? body;
    let definition: GameDefinition;
    let initialTickRate: number | undefined = body.initialTickRate;

    if (isParsedDefinition(raw)) {
      definition = raw;
    } else {
      definition = parseDefinition(raw);
      if (initialTickRate === undefined) initialTickRate = getInitialTickRate(raw);
    }

    const fileName = typeof body.fileName === "string" ? body.fileName : "scenario.json";
    loadDefinition(definition, fileName, initialTickRate);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid scenario JSON";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
