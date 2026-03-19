# Master Context Memory

## 1. Project Overview
This is a Next.js web-based Command and Control (C2) simulation for a 14-cadet team, testing logistics and tactical decision-making in custom environments.

## 2. Core Architecture
- **Stack:** Next.js 14, React, Tailwind CSS, Shadcn UI.
- **State Management:** Server-authoritative (or persistent BroadcastChannel) syncing between a master `/admin` panel and multiple `/client` dashboards.
- **Single Source of Truth:** The engine is hydrated exclusively by `test6.json`, which is the single source of truth.
- **Template File Check Rule:** Agents must check whether `test6.json` or `test7.json` exists before making assumptions about available scenario data. Current status: neither file exists.
- **Tick Engine (Critical):** The simulation runs on a global `current_tick` system. Do not use standard real-time `setInterval` for game logic; everything must tie to the global tick.

## 3. Visual Engine (react-globe.gl & Three.js)
- **Icons:** Rendered via the `milsymbol` library using NATO standard SIDC.
- **Movement:** Vector-based interpolation across the globe over time.
- **AOE Rings:** Rendered as `customThreeObject` using Three.js `RingGeometry`. Their altitudes MUST precisely match the asset marker altitudes to prevent 3D parallax illusions. Ring colors map to unit role.

## 4. Mechanics & Doctrine
- **Logistics:** Units have `fuel_reserves`. AIRBORNE units burn fuel based on vector distance. GROUNDED units subtract fuel from their base's master reserves.
- **Deployments:** Cadets use a Sortie Request form. The Admin approves it, establishing a `departure_tick` and `target_coords`.
- **Refueling:** Tankers have an `aoe_radius` to refuel airborne units dynamically.
- **Injects:** Timeline events have specific trigger ticks and remain hidden until that tick is reached.

## 5. AI Autonomy Rules (CRITICAL FOR FUTURE PROMPTS)
- **Rule A:** Never modify `test6.json` unless explicitly asked.
- **Rule B:** Always maintain the `Tactical Dark` (`#0a0a0a`) Joint Operations Center (JOC) visual aesthetic with `JetBrains Mono` font.
- **Rule C:** If proposing a new mechanic, ensure it hooks into the `current_tick` system.
- **Rule D:** Feel free to update `memory.md` with more pertinent information that may be useful to new agents.