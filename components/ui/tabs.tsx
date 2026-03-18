"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue: string;
}

export function Tabs({ defaultValue, className, children, ...props }: TabsProps) {
  const [value, setValue] = React.useState(defaultValue);

  const ctx = React.useMemo<TabsContextValue>(
    () => ({ value, setValue }),
    [value]
  );

  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn("w-full", className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const computedClassName = cn(
    "op-tabs-list inline-flex min-h-10 items-center justify-center gap-1 p-1",
    className
  );
  return (
    <div
      className={computedClassName}
      {...props}
    />
  );
}

interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error("TabsTrigger must be used within Tabs");
  }
  const isActive = ctx.value === value;
  const computedClassName = cn(
    "op-tabs-trigger inline-flex min-h-8 items-center justify-center whitespace-nowrap px-3 py-1.5 text-sm font-medium tracking-wide ring-offset-background transition-colors duration-150",
    isActive ? "is-active" : "",
    className
  );

  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={computedClassName}
      {...props}
    >
      {children}
    </button>
  );
}

interface TabsContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({
  value,
  className,
  children,
  ...props
}: TabsContentProps) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error("TabsContent must be used within Tabs");
  }

  if (ctx.value !== value) {
    return null;
  }

  return (
    <div
      className={cn("mt-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

