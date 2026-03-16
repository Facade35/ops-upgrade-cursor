import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

import type { GameState } from "@/components/game-state-provider";



const SIMULATION_TABLE = "simulation_state";
const ACTIVE_SESSION_ID = "active-session";

let clientSingleton: any = null;

function getConfiguredClient() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export function getSupabaseClient() {
  if (clientSingleton) return clientSingleton;
  clientSingleton = getConfiguredClient();
  return clientSingleton;
}

export async function fetchSimulationState(): Promise<GameState | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(SIMULATION_TABLE)
    .select("state_data")
    .eq("id", ACTIVE_SESSION_ID)
    .maybeSingle();

  if (error) throw error;
  return ((data as { state_data?: GameState | null } | null)?.state_data ??
    null) as GameState | null;
}

export async function persistSimulationState(state: GameState): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(SIMULATION_TABLE).upsert(
    {
      id: ACTIVE_SESSION_ID,
      state_data: state,
    },
    { onConflict: "id" }
  );

  if (error) throw error;
}

export async function clearSimulationState(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(SIMULATION_TABLE)
    .update({ state_data: {} })
    .eq("id", ACTIVE_SESSION_ID);

  if (error) throw error;
}

export function simulationChannel(channelName = "simulation"): RealtimeChannel {
  return getSupabaseClient().channel(channelName);
}
