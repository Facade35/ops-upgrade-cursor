"use client";

import { useContext } from "react";
import { GameStateContext } from "@/components/game-state-provider";
import { RemoteGameStateContext } from "@/components/remote-game-state-provider";

export function useGameState() {
  const local = useContext(GameStateContext);
  const remote = useContext(RemoteGameStateContext);
  if (local) return local;
  if (remote) return remote;
  throw new Error("useGameState must be used within GameStateProvider or RemoteGameStateProvider.");
}
