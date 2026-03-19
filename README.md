## 1) Project Title & Overview

**Title:** JADC2 Simulation Sandbox  
**Overview:** A high-fidelity, Next.js web-based Command and Control (C2) simulation designed for a 14-cadet team. It tests logistics, delegation, and tactical decision-making during any* theater scenario.

---

## 2) Tech Stack & Architecture

### Frontend
- Next.js 14
- React
- Tailwind CSS
- Shadcn UI patterns (Radix primitives + utility components)

### 3D Rendering
- `react-globe.gl` for geospatial rendering
- `three` for custom tactical objects and AOE ring geometry
- `milsymbol` for NATO SIDC unit symbology

### Backend / State
- Supabase
  - PostgreSQL JSONB-backed session document (`simulation_state.state_data`)
  - Realtime WebSocket broadcast channel for live state fan-out

### Architecture Pattern (Current)
- **Single Brain authority model**
  - The `/admin` client is the simulation authority.
  - Admin runs the global tick engine and simulation math.
  - Admin broadcasts one unified JSON game state snapshot to cadet clients.
  - Cadet-facing clients subscribe and sync from that stream.
- This pattern intentionally bypasses serverless timeout constraints by keeping the authoritative tick loop client-side on Admin while persisting checkpoints to Supabase.

### Realtime Data Flow (Post-Migration)
1. Admin loads scenario definition and starts simulation state.
2. Tick engine advances state (`tick`, movement, fuel burn, inject actions, doctrine effects).
3. Updated state is:
   - Broadcast through Supabase Realtime (`tick_update` events).
   - Periodically persisted to Supabase (`simulation_state` table).
4. Cadet clients subscribe, receive updates, and overwrite stale local state.
5. On reconnect/reload, clients hydrate from persisted Supabase state (with local cache fallback).

---

## 3) Current Feature Status

- [x] **3D Geospatial Map**
  - Vector-based unit movement on globe.
  - Fixed parallax behavior via altitude-matched tactical rings.
  - Custom Three.js AOE rings mapped by unit role.
- [x] **Tick Engine**
  - Admin-authoritative game loop drives all progression.
- [x] **Distributed Logistics**
  - Multi-base model including U-Tapao, Changi, and Cesar Basa scenario support.
  - Localized base fuel reserves plus airborne fuel burn calculations.
- [x] **Cadet Deployments**
  - Sortie request workflow (target coordinates, departure tick, mission type).
  - Admin approve/deny control with state-safe transitions.
- [x] **Dynamic Injects**
  - Timeline-based intelligence/inject events (including SAR-style inject handling, e.g. Typhoon Francisco scenarios).
  - Cadet MFR/COA submission workflow persisted and shared.
- [x] **Realtime Sync**
  - Near-zero-latency updates via Supabase Broadcast.
  - Session persistence via Supabase JSON state snapshots.

---

## 4) Next Implementations (Roadmap)

- [ ] **Red Force AI**
  - Automated threat response layer.
  - Enemy interceptors spawn and execute interception vectors when Blue Force breaches threat boundaries.
- [ ] **AI MFR and COA Examination**
  - Automated grading and recommendation engine.
  - Admin receives AI-advised action suggestions for execution.
- [ ] **Doctrine Execution Expansion**
  - Extend interactive map doctrine so tanker-to-fighter fuel transfer and transport airdrop inject completion become richer, more automated mission interactions.
- [ ] **Advanced Map Filtering**
  - Cadet controls to hide/show unit roles, AOE rings, hostile tracks, and inject markers to reduce visual clutter.

---

## 5) Local Setup & Installation

### Prerequisites
- Node.js 18+ (recommended: current LTS)
- npm

### Install Dependencies

```bash
npm install
```

### Environment Variables

Create a `.env.local` file in the project root with:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Both variables are required for Supabase persistence and realtime channel sync.

### Run in Development

```bash
npm run dev
```

Then open the local URL shown in terminal (typically `http://localhost:3000`).

### Production Build

```bash
npm run build
npm run start
```

---

## Operational Notes

- Admin authority route: `/admin`
- Cadet operations route: `/dashboard`
- Simulation state is persisted under a single active session row (`id = active-session`) in `simulation_state`.
- Supabase Realtime events currently include `tick_update`, `hard_reset`, `response_submitted`, and `deployment_request`.

