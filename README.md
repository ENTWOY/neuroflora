# NEUROFLORA

> **Artificial Life Observation**
> A contemplative real-time simulation of an artificial biological entity.

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/cd99b45f-5ac9-49be-a98e-75ab30025b0b" />

Neuroflora is an interactive visual piece designed for observation: a procedural creature that reacts autonomously to luminous stimuli in a void-like space.

## Concept

The experience focuses on:

- Organic movement generated frame by frame
- Autonomous behavior with no player objectives
- Emergent interaction between tentacles, particles, and orbs
- Minimal presentation for large-format displays or digital installations

## Key Features

- **Autonomous procedural entity**: a synthetic plant with multiple IK-driven tentacles.
- **Inverse Kinematics (FABRIK)**: articulated chain solving for fluid, organic motion.
- **Trajectory prediction**: tentacles anticipate future orb positions to intercept them.
- **High-performance canvas**: simulation/render loop decoupled from React state for smooth animation.
- **Observation-first UX**: minimalist start screen with a soft transition (`Initialize`).
- **Reactive visual system**: trails, glow, and particles on contact.

## Tech Stack (Verified in Project)

- **Framework**: [Next.js 16.2.4](https://nextjs.org/) (App Router)
- **UI**: [React 19.2.4](https://react.dev/)
- **Lenguaje**: [TypeScript](https://www.typescriptlang.org/)
- **Render**: HTML5 Canvas 2D API
- **Styling**: Global CSS + Tailwind CSS v4 (via `@import "tailwindcss"`)
- **Typography**: [Geist Sans and Geist Mono](https://vercel.com/font)

## Architecture Overview

- `app/page.tsx`: start overlay and simulation initialization.
- `components/SimulationCanvas.tsx`: RAF loop and canvas rendering outside React state.
- `simulation/SimulationEngine.ts`: top-level update/render orchestration.
- `simulation/PlantController.ts`: tentacle behavior and IK (FABRIK).
- `simulation/CircleSpawner.ts`: orb generation and motion logic.
- `simulation/CollisionEngine.ts`: contact detection.
- `simulation/ParticleSystem.ts`: particle effects.

## Run Locally

### Requirements

- Node.js 18+
- pnpm (recommended)

### Installation

1. Install dependencies:

```bash
pnpm install
```

2. Start the development server:

```bash
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000)

## Scripts

- `pnpm dev`: development server.
- `pnpm build`: production build.
- `pnpm start`: production server.
- `pnpm lint`: ESLint checks.

## Roadmap

- [ ] Environmental variations that alter trajectories.
- [ ] Multiple entities in the same scene.
- [ ] Audio-reactive mode.
- [ ] Visual tuning and configurable palettes.

## License

MIT. See `LICENSE` for details.
