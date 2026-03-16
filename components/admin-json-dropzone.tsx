"use client";

import { useCallback, useRef, useState } from "react";
import { useRemoteGameState } from "@/components/remote-game-state-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInitialTickRate, parseDefinition } from "@/lib/parse-game-definition";

export function AdminJsonDropzone() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { state, loadDefinition, setError } = useRemoteGameState();

  const handleFile = useCallback(
    async (file: File) => {
      // Validation: Ensure it's a JSON file
      if (!file.name.toLowerCase().endsWith(".json")) {
        setError("Please upload a .json file.");
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text) as unknown;
        
        // Parsing the definition from your lib
        const parsed = parseDefinition(data);
        const initialTickRate = getInitialTickRate(data);

        // Load into the global remote state
        await loadDefinition(parsed, file.name, initialTickRate);
        setError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse JSON.";
        setError(message);
      }
    },
    [loadDefinition, setError]
  );

  return (
    <Card className="border-dashed bg-muted/10">
      <CardHeader>
        <CardTitle className="font-sans">Scenario Upload (Admin)</CardTitle>
        <CardDescription className="font-mono text-xs">
          Upload scenario JSON to drive the master game tick and resources for all cadets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files.item(0);
            if (file) void handleFile(file);
          }}
          className={`rounded-lg border border-dashed p-10 text-center transition-all ${
            isDragging ? "border-primary bg-primary/10 scale-[1.02]" : "border-border bg-muted/30"
          }`}
        >
          <p className="text-sm font-mono text-muted-foreground">
            DRAG & DROP SCENARIO JSON OR SELECT MANUALLY
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => fileRef.current?.click()}>
            Browse Files
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              // Allow selecting the same file again on the next open.
              e.currentTarget.value = "";
            }}
          />
        </div>
        
        <div className="mt-4 flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider">
          <div className="flex justify-between">
            <span className="text-muted-foreground">STATUS:</span>
            <span className={state.loadedFileName ? "text-primary" : "text-yellow-500"}>
              {state.loadedFileName ? "SCENARIO LOADED" : "AWAITING DEFINITION"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">FILE:</span>
            <span>{state.loadedFileName ?? "NONE"}</span>
          </div>
          {state.error && (
            <p className="mt-2 text-destructive border-t border-destructive/20 pt-1">
              ERROR: {state.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}