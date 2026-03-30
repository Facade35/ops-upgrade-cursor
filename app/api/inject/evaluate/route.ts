import { NextResponse } from "next/server";
import OpenAI from "openai";
import { promises as fs } from "node:fs";

import type {
  EvaluationGrade,
  GradingStrictness,
  InjectProposal,
} from "@/types/game";

export const dynamic = "force-dynamic";

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

function strictnessDescriptor(level: GradingStrictness | undefined): string {
  switch (level) {
    case "COACHING":
      return "Coaching: gentle, formative feedback; minor faults tolerated if intent is sound.";
    case "MISSION_READY":
      return "Mission-Ready: firm on doctrine and math; minor formatting allowed, operational soundness required.";
    case "ZERO_TOLERANCE":
      return "Zero-Tolerance: strict adherence to doctrine, formatting, and tactical math; any gap triggers resubmission or adverse inject.";
    case "BALANCED":
    default:
      return "Balanced: professional tone, enforce doctrine and math, allow minor style issues.";
  }
}

async function loadTongueQuill(): Promise<{ text: string | null; note: string }> {
  const path = process.env.TONGUE_QUILL_PATH;
  if (!path) return { text: null, note: "Reference path not provided." };
  try {
    if (path.toLowerCase().endsWith(".pdf")) {
      return { text: null, note: "PDF provided at TONGUE_QUILL_PATH; text extraction is skipped." };
    }
    const buf = await fs.readFile(path, "utf8");
    return { text: buf.slice(0, 120_000), note: "Reference loaded." };
  } catch (err) {
    return {
      text: null,
      note: `Reference unavailable: ${(err as Error)?.message ?? "unknown"}`,
    };
  }
}

type EvalBody = {
  triggerId?: string;
  responseType: "MFR" | "COA";
  content: string;
  strictness?: GradingStrictness;
  scenarioTitle?: string | null;
  tick?: number;
  missedDeadline?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as EvalBody;
    if (!body || !body.responseType || !body.content) {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
    }

    const tq = await loadTongueQuill();
    const client = new OpenAI({ apiKey });

    const prompt = `You are an Air Force evaluator grading Memorandums for Record (MFR) and Courses of Action (COA).
Always reply with a single JSON object. (This sentence intentionally contains the word json.)
Schema: {"summary": string, "verdict": "accept"|"accept_with_inject"|"resubmit", "faults": string[], "recommendations"?: string[], "injectProposal"?: {"title": string, "content"?: string, "tick"?: number, "type"?: string, "priority"?: string, "required_response"?: "MFR"|"COA"|"NONE", "deadline_tick"?: number, "lat"?: number, "lng"?: number, "map_visible"?: boolean, "sidc"?: string}}
Apply the strictness policy: ${strictnessDescriptor(body.strictness)}
Mission/Scenario: ${body.scenarioTitle ?? "unknown"}; Current tick: ${body.tick ?? "n/a"}.
If missedDeadline is true, the submission was not provided on time. Propose an adverse inject the admin can approve that stresses the cadet.

Provide in JSON fields:
- summary (2-3 sentences)
- verdict: one of [accept, accept_with_inject, resubmit]
- faults: array of concise bullet strings
- recommendations: array (optional)
- injectProposal (optional) when verdict=accept_with_inject OR missedDeadline=true. Keep it short (title/content), set tick a few steps ahead if missing.

Be decisive and keep wording concise for on-screen UI.`;

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        tq.text
          ? { role: "system", content: `Reference: Air Force Tongue and Quill (excerpt):\n${tq.text}` }
          : { role: "system", content: tq.note },
        {
          role: "user",
          content: `Submission type: ${body.responseType}\nMissed deadline: ${body.missedDeadline ? "yes" : "no"}\nContent:\n${body.content}`,
        },
      ],
      temperature: 0.4,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content;
    let parsed: Partial<EvaluationGrade & { injectProposal: InjectProposal }>; // loose parse
    try {
      parsed = raw ? (JSON.parse(raw) as any) : {};
    } catch {
      parsed = {};
    }

    const grade: EvaluationGrade = {
      summary: parsed.summary ?? "",
      verdict: (parsed.verdict as any) ?? "resubmit",
      faults: Array.isArray(parsed.faults) ? parsed.faults : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : undefined,
    };

    const injectProposal: InjectProposal | undefined = parsed.injectProposal;

    return NextResponse.json({
      // Admin owns final disposition; AI only provides recommendation.
      status: "graded",
      grade,
      injectProposal,
      strictness: body.strictness ?? "BALANCED",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("/api/inject/evaluate error", message, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
