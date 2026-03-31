import { NextResponse } from "next/server";
import OpenAI from "openai";
import { promises as fs } from "node:fs";

import type {
  EvalContext,
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
  evalContext?: EvalContext;
};

function normalizeVerdict(value: unknown): EvaluationGrade["verdict"] {
  if (typeof value !== "string") return "resubmit";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "accept") return "accept";
  if (
    normalized === "accept_with_inject" ||
    normalized === "acceptwithinject"
  ) {
    return "accept_with_inject";
  }
  if (normalized === "resubmit") return "resubmit";
  return "resubmit";
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.round(fallback)));
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeEnum(
  value: unknown,
  allowedValues: string[],
  fallback: string
): string {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim().toUpperCase();
  return allowedValues.includes(candidate) ? candidate : fallback;
}

function normalizeInjectProposal(
  proposal: unknown,
  body: EvalBody
): InjectProposal | undefined {
  if (!proposal || typeof proposal !== "object") return undefined;
  const source = proposal as Partial<InjectProposal>;
  const constraints = body.evalContext?.constraints;
  const nowTick =
    typeof body.tick === "number" && Number.isFinite(body.tick) ? Math.round(body.tick) : 0;

  const tickMin = constraints?.tickWindow?.min ?? nowTick + 1;
  const tickMax = constraints?.tickWindow?.max ?? nowTick + 40;
  const deadlineMinBase = constraints?.deadlineWindow?.min ?? nowTick + 2;
  const deadlineMax = constraints?.deadlineWindow?.max ?? nowTick + 80;
  const fallbackTick = nowTick + 3;
  const tick = clampInt(source.tick, tickMin, tickMax, fallbackTick);
  const deadlineMin = Math.max(tick, deadlineMinBase);
  const fallbackDeadline = tick + 8;
  const deadline_tick = clampInt(source.deadline_tick, deadlineMin, deadlineMax, fallbackDeadline);

  const allowedTypes = constraints?.allowedTypes?.length
    ? constraints.allowedTypes.map((value) => value.toUpperCase())
    : ["INTEL", "OPS", "ADMIN"];
  const allowedPriorities = constraints?.allowedPriorities?.length
    ? constraints.allowedPriorities.map((value) => value.toUpperCase())
    : ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const allowedRequiredResponses = constraints?.allowedRequiredResponses?.length
    ? constraints.allowedRequiredResponses.map((value) => value.toUpperCase())
    : ["MFR", "COA", "NONE"];
  const allowedInjectKinds = [
    "INFO_UPDATE",
    "TASK_RED_ASSET",
    "CREATE_NFZ",
    "CREATE_DROP_ZONE",
    "SPAWN_HOSTILE_GROUP",
  ];

  const title =
    typeof source.title === "string" && source.title.trim().length > 0
      ? source.title.trim()
      : body.missedDeadline
        ? "Deadline Missed - Cadet Pressure Inject"
        : "Follow-up Inject";
  const content =
    typeof source.content === "string" && source.content.trim().length > 0
      ? source.content.trim()
      : body.missedDeadline
        ? "Cadet response missed suspense. Escalate pressure and require immediate corrective action."
        : "Request a concise follow-up update to validate execution details.";
  const type = normalizeEnum(source.type, allowedTypes, "OPS");
  const priority = normalizeEnum(source.priority, allowedPriorities, "MEDIUM");
  const required_response = normalizeEnum(
    source.required_response,
    allowedRequiredResponses,
    "NONE"
  ) as InjectProposal["required_response"];
  const inject_kind = normalizeEnum(source.inject_kind, allowedInjectKinds, "INFO_UPDATE") as
    | InjectProposal["inject_kind"]
    | undefined;

  const lat =
    typeof source.lat === "number" && Number.isFinite(source.lat) ? source.lat : undefined;
  const lng =
    typeof source.lng === "number" && Number.isFinite(source.lng) ? source.lng : undefined;
  const spawnGroupSource =
    source.spawn_group && typeof source.spawn_group === "object"
      ? source.spawn_group
      : undefined;
  const spawn_group =
    inject_kind === "SPAWN_HOSTILE_GROUP"
      ? {
          id:
            typeof spawnGroupSource?.id === "string" && spawnGroupSource.id.trim().length > 0
              ? spawnGroupSource.id.trim()
              : undefined,
          label:
            typeof spawnGroupSource?.label === "string" && spawnGroupSource.label.trim().length > 0
              ? spawnGroupSource.label.trim()
              : "AI Spawn Group",
          home_base:
            typeof spawnGroupSource?.home_base === "string" &&
            spawnGroupSource.home_base.trim().length > 0
              ? spawnGroupSource.home_base.trim()
              : undefined,
          quantity: clampInt(spawnGroupSource?.quantity, 1, 12, 2),
          role:
            spawnGroupSource?.role === "FIGHTER" ||
            spawnGroupSource?.role === "ISR" ||
            spawnGroupSource?.role === "TRANSPORT" ||
            spawnGroupSource?.role === "TANKER"
              ? spawnGroupSource.role
              : "FIGHTER",
          sidc:
            typeof spawnGroupSource?.sidc === "string" && spawnGroupSource.sidc.trim().length > 0
              ? spawnGroupSource.sidc.trim()
              : "130601000011010000000000000000",
          max_fuel: clampInt(spawnGroupSource?.max_fuel, 2000, 120000, 15000),
          fuel_burn_rate: clampInt(spawnGroupSource?.fuel_burn_rate, 1, 120, 12),
          speed: clampInt(spawnGroupSource?.speed, 1, 6, 2),
          aoe_radius: clampInt(spawnGroupSource?.aoe_radius, 1, 500, 80),
          sensor_range_km: clampInt(spawnGroupSource?.sensor_range_km, 10, 1200, 180),
          engagement_range_km: clampInt(
            spawnGroupSource?.engagement_range_km,
            5,
            800,
            45
          ),
          combat_rating: clampInt(spawnGroupSource?.combat_rating, 1, 100, 60),
          signature: clampInt(spawnGroupSource?.signature, 1, 100, 45),
          route: Array.isArray(spawnGroupSource?.route)
            ? spawnGroupSource.route
                .filter(
                  (point) =>
                    typeof point?.lat === "number" &&
                    Number.isFinite(point.lat) &&
                    typeof point?.lng === "number" &&
                    Number.isFinite(point.lng)
                )
                .slice(0, 5)
                .map((point) => ({ lat: point.lat, lng: point.lng }))
            : undefined,
        }
      : undefined;

  return {
    title,
    content,
    tick,
    inject_kind,
    type,
    priority,
    required_response,
    deadline_tick,
    lat,
    lng,
    map_visible: typeof source.map_visible === "boolean" ? source.map_visible : true,
    sidc: typeof source.sidc === "string" ? source.sidc.trim() || undefined : undefined,
    spawn_group,
  };
}

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
    const contextJson = body.evalContext ? JSON.stringify(body.evalContext) : "{}";

    const prompt = `You are an Air Force evaluator grading Memorandums for Record (MFR) and Courses of Action (COA).
Always reply with a single JSON object. (This sentence intentionally contains the word json.)
Schema: {"summary": string, "Verdict": "Accept"|"Accept With Inject"|"Resubmit", "Faults": string[], "Recommendations"?: string[], "injectProposal"?: {"title": string, "content"?: string, "inject_kind"?: "INFO_UPDATE"|"TASK_RED_ASSET"|"CREATE_NFZ"|"CREATE_DROP_ZONE"|"SPAWN_HOSTILE_GROUP", "tick"?: number, "type"?: string, "priority"?: string, "required_response"?: "MFR"|"COA"|"NONE", "deadline_tick"?: number, "lat"?: number, "lng"?: number, "map_visible"?: boolean, "sidc"?: string, "spawn_group"?: {"id"?: string, "label"?: string, "home_base"?: string, "quantity"?: number, "role"?: "FIGHTER"|"ISR"|"TRANSPORT"|"TANKER", "sidc"?: string, "max_fuel"?: number, "fuel_burn_rate"?: number, "speed"?: number, "aoe_radius"?: number, "sensor_range_km"?: number, "engagement_range_km"?: number, "combat_rating"?: number, "signature"?: number, "route"?: {"lat": number, "lng": number}[]}}}
Apply the strictness policy: ${strictnessDescriptor(body.strictness)}
Mission/Scenario: ${body.scenarioTitle ?? "unknown"}; Current tick: ${body.tick ?? "n/a"}.
If missedDeadline is true, the submission was not provided on time. Propose an adverse inject the admin can approve that stresses the cadet.
Ground your evaluation in the provided evalContext whenever available (trigger details, mission risks, relevant assets, recent injects, and constraints). Keep recommendations actionable.

Provide in JSON fields:
- summary (2-3 sentences)
- verdict: one of [Accept, Accept with Inject, Resubmit]
- faults: array of concise bullet strings
- recommendations: array (optional)
- injectProposal (optional) when verdict=accept_with_inject OR missedDeadline=true. Keep it short (title/content), set tick a few steps ahead if missing.

Be decisive and keep wording concise for on-screen UI.`;

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: prompt },
        { role: "system", content: `evalContext:\n${contextJson}` },
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
    let parsed: Partial<EvaluationGrade & { injectProposal: InjectProposal }> & {
      Verdict?: string;
      Summary?: string;
      Faults?: string[];
      Recommendations?: string[];
      InjectProposal?: InjectProposal;
    }; // loose parse
    try {
      parsed = raw ? (JSON.parse(raw) as any) : {};
    } catch {
      parsed = {};
    }

    const grade: EvaluationGrade = {
      summary:
        (typeof parsed.summary === "string" ? parsed.summary : undefined) ??
        (typeof parsed.Summary === "string" ? parsed.Summary : "") ??
        "",
      verdict: normalizeVerdict(parsed.verdict ?? parsed.Verdict),
      faults: Array.isArray(parsed.faults)
        ? parsed.faults
        : Array.isArray(parsed.Faults)
          ? parsed.Faults
          : [],
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : Array.isArray(parsed.Recommendations)
          ? parsed.Recommendations
          : undefined,
    };

    const shouldIncludeProposal =
      grade.verdict === "accept_with_inject" || body.missedDeadline === true;
    const injectProposal = shouldIncludeProposal
      ? normalizeInjectProposal(parsed.injectProposal ?? parsed.InjectProposal, body)
      : undefined;

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
