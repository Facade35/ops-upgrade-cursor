"use client";

import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RemoteGameStateProvider } from "@/components/remote-game-state-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <RemoteGameStateProvider>{children}</RemoteGameStateProvider>
      </body>
    </html>
  );
}
