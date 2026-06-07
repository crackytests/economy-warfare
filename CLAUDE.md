# Economy Warfare — repo guide for agents

Browser card game (deck editor + online 1v1 + solitaire vs AI), embeddable as a
**modal via iframe** on the owner's website. Strong visual presentation is a goal.

## Start here
- `docs/ARCHITECTURE.md` — boundaries, decisions, the engine contract, the
  bonding-curve seam, iframe embedding. **Read before writing code.**
- `docs/AGENT_TASKS.md` — parallel workstreams, per-file ownership, task checkboxes.
- `economy_warfare_web_agent_handoff_v1_1.md` — authoritative rules spec.
- `lore.md` — theme/flavor for visual + copy decisions.

## Non-negotiables
- The **rules engine is pure** (`packages/engine`): no I/O, no `Date.now`, no
  `Math.random` (use `Rng`). `applyIntent` returns new state, never mutates input.
- The engine **never** imports `@ew/shared/ownership`. Gameplay is ownership-agnostic.
- `CardDef.id` slugs are **permanent keys** (future bonding-curve/market keys). Never reuse.
- Don't change `@ew/shared` types or the engine public API (`packages/engine/src/index.ts`)
  without updating `docs/ARCHITECTURE.md` and noting it in `docs/AGENT_TASKS.md`.
- Server is **authoritative**: client sends `Intent`s only; server validates with the engine.
- Honor the rules-ambiguity answers in handoff §18 (mirrored in AGENT_TASKS); don't re-decide.

## Stack
npm workspaces (NO pnpm). TypeScript 5.6 project refs. Web: Vite + React + Framer
Motion. Server: Node + ws. Tests: Vitest. Node 20+ (box has 22).

## Layout
`data/` (cards.json + starter_decks.json = source of truth) · `packages/shared`
(contracts) · `packages/engine` (rules) · `apps/web` · `apps/server` · `images/`
(source art, not yet mapped — see task A0).

## Commands
- `npm install` (root) — install workspaces.
- `npm run typecheck` — `tsc -b` across packages.
- `npm run dev:web` / `npm run dev:server`.

## Windows / PowerShell notes
Dev box is Windows + PowerShell. Use PowerShell syntax in terminal (`$env:VAR`,
`$null`). Paths use backslashes; keep cross-platform paths in code (posix `/`).
