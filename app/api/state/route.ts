import { NextResponse } from "next/server";
import { getState } from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getState();
  return NextResponse.json(state);
}
