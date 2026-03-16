"use client";

import { useCallback, useRef, useState } from "react";

import { useGameState } from "@/hooks/use-game-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInitialTickRate, parseDefinition } from "@/lib/parse-game-definition";

export function JsonDropzone() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { state, loadDefinition, setError } = useGameState();

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".json")) {
        setError("Please upload a .json file.");
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text) as unknown;
        const parsed = parseDefinition(data);
        const initialTickRate = getInitialTickRate(data);
        loadDefinition(parsed, file.name, initialTickRate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to parse JSON.";
        setError(message);
      }
    },
    [loadDefinition, setError]
  );

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>GLP Definition Upload</CardTitle>
        <CardDescription>Drop a JSON file to load resources, assets, and timeline events.</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            const file = event.dataTransfer.files.item(0);
            if (file) {
              void handleFile(file);
            }
          }}
          className={`rounded-lg border border-dashed p-6 text-center transition ${
            isDragging ? "border-primary bg-primary/10" : "border-border bg-muted/30"
          }`}
        >
          <p className="text-sm text-muted-foreground">Drop JSON here or choose a file manually.</p>
          <Button className="mt-4" variant="secondary" onClick={() => fileRef.current?.click()}>
            Select JSON File
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
            }}
          />
        </div>

        <div className="mt-4 text-xs text-muted-foreground">
          Loaded: {state.loadedFileName ?? "No file loaded"}
          {state.error ? <p className="mt-1 text-destructive">{state.error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
