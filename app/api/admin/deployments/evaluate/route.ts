import { NextResponse } from "next/server";
import OpenAI from "openai";
import type { DeploymentRequest, GradingStrictness } from "@/types/game";

export const dynamic = "force-dynamic";

type EvaluateBody = {
  strictness?: GradingStrictness;
  request?: DeploymentRequest;
  context?: {
    tick?: number;
    airborneUnits?: Array<{ id: string; label: string; mission_type?: string }>;
    recentInjects?: Array<{ id: string; note?: string; tick?: number }>;
  };
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

function strictnessDescriptor(level: GradingStrictness | undefined): string {
  switch (level) {
    case "COACHING":
      return "Coaching. Favor learning value and practical guidance.";
    case "MISSION_READY":
      return "Mission-ready. Strongly enforce mission adequacy and doctrine.";
    case "ZERO_TOLERANCE":
      return "Zero-tolerance. Any major inconsistency should produce DENY.";
    case "BALANCED":
    default:
      return "Balanced. Enforce mission standards without over-penalizing minor style issues.";
  }
}

function containsCadetAuthorityBias(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    (normalized.includes("cadet") &&
      (normalized.includes("lack of authority") ||
        normalized.includes("lack authority") ||
        normalized.includes("lack of experience") ||
        normalized.includes("inexperience") ||
        normalized.includes("not authorized"))) ||
    normalized.includes("requested by a cadet")
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EvaluateBody;
    if (!body?.request) {
      return NextResponse.json({ error: "Missing tasking order request" }, { status: 400 });
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `You review military tasking orders and provide an advisory verdict only. ` +
            `Output JSON keys: verdict, summary, faults, recommendations. ` +
            `verdict must be APPROVE or DENY. ` +
            `Do not treat requester role (CADET) as a fault by itself. ` +
            `Never critique authority, rank, or experience of requester role; evaluate only plan quality, safety, feasibility, and mission doctrine. ` +
            strictnessDescriptor(body.strictness),
        },
        {
          role: "user",
          content: JSON.stringify({
            taskingOrder: body.request,
            simulationContext: body.context ?? {},
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 450,
    });

    const raw = completion.choices[0]?.message?.content;
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const verdict = parsed.verdict === "APPROVE" ? "APPROVE" : "DENY";
    let summary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : "AI review completed.";
    let faults = Array.isArray(parsed.faults)
      ? parsed.faults.filter((item): item is string => typeof item === "string")
      : [];
    if (containsCadetAuthorityBias(summary)) {
      summary = "Review based on mission feasibility, safety, and doctrine only.";
    }
    faults = faults.filter((fault) => !containsCadetAuthorityBias(fault));
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((item): item is string => typeof item === "string")
      : undefined;

    return NextResponse.json({ verdict, summary, faults, recommendations });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
