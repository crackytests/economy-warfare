# Economy Warfare — Architecture

> Read this first. It defines the boundaries every agent must respect so parallel
> work doesn't collide. Source-of-truth rules are in
> `economy_warfare_web_agent_handoff_v1_1.md` (kept in the repo root / Downloads).
> Lore/theme in `lore.md`.

## Product goals (from the owner)

1. **Deck editor** — build/save 40-card decks from the card pool.
2. **Online vs mode** — 1v1, server-authoritative.
3. **Semi-competent solitaire** — play vs a Solo AI locally.
4. **Strong visual presentation** — the art is good; the UI must do it justice.
5. **Embeddable as a modal on the owner's website** via **iframe**.
6. **Future (design for, do NOT build): bonding-curve collectibles.** Every card
   sits on its own bonding curve — more copies owned ⇒ higher value. We isolate
   this behind `@ew/shared/ownership` now so it can land later without touching
   gameplay.

## Decisions locked with the owner

| Topic | Decision |
|---|---|
| Embed method | **iframe** — game is a standalone SPA; the site opens it in a modal. |
| Online backend | **Node + WebSocket, server-authoritative.** Client sends intents only. |
| Collection model | **Abstract ownership layer; everything unlocked now** (`UnlimitedOwnership`). |
| Frontend | React + TypeScript SPA built with **Vite** (clean iframe target). |
| Animation/visuals | DOM + CSS with **Framer Motion** for card movement/flip. Cards are DOM, not canvas. |
| Rules engine | Pure TypeScript, shared by client (solitaire) and server (online). |
| Rules ambiguities | Use the handoff §18 snapshot answers. Do not silently invent rules. |

## Monorepo layout (npm workspaces — pnpm is NOT installed)

```
/data
  cards.json            # SINGLE SOURCE OF TRUTH for card base data (48 cards)
  starter_decks.json    # 4 starter decks (40 each)
/packages
  /shared               # @ew/shared — types, wire protocol, ownership interface. No deps.
    src/types.ts        #   CardDef, CardInstance, GameState, DeckList, DECK_RULES, SETUP
    src/protocol.ts     #   Intent union, TargetRef, Client/ServerMessage (WS envelope), TableInfo (lobby)
    src/ownership.ts    #   CardOwnership interface + UnlimitedOwnership stub (bonding-curve seam)
  /engine               # @ew/engine — pure rules. Depends only on @ew/shared (NOT ownership).
    src/index.ts        #   PUBLIC API (contract): createGame, applyIntent, getLegalIntents,
                        #   getLegalAttackTargets, redactFor, redactForSpectator, checkLoss, validateDeck, buildCardIndex
    src/rng.ts          #   seeded RNG (done) — never use Math.random in the engine
    src/effects.ts      #   EFFECTS registry: cardId -> per-card hooks (extension point)
    src/state.ts        #   (todo) createGame, redactFor, zone helpers
    src/reducer.ts      #   (todo) applyIntent, getLegalIntents, phase machine
    src/combat.ts       #   (todo) targeting, blocking, damage, Guardbreak/Siege/Raid
    src/economy.ts      #   (todo) income, Optimize, Recycle/Resale, loss check, costs
/apps
  /web                  # Vite + React SPA. Imports @ew/engine for solitaire + previews.
  /server               # Node WS server. Authoritative; imports @ew/engine.
/docs
  ARCHITECTURE.md       # this file
  AGENT_TASKS.md        # parallelizable work breakdown + ownership of files
/images                 # owner's source card art (0001..0048, png+jpg). NOT yet mapped to cards.
```

## The engine is the spine

Everything routes through the engine's public API in `packages/engine/src/index.ts`.
**Do not change those signatures** without updating this doc and notifying the web +
server agents — both compile against that surface.

Core contract:

- `applyIntent(state, intent, cards) -> { state, events, error? }` is the **only** way
  to mutate the game. It is **pure** (returns new state, never mutates input).
- The same `Intent` type is the WS payload *and* the engine input. So:
  - **Online:** client sends `Intent` → server `applyIntent` → broadcast `redactFor(state, p)`.
  - **Solitaire/hotseat:** the web app runs `applyIntent` locally; the AI is just a
    bot that picks an `Intent` via `getLegalIntents` and submits it the same way.
- `getLegalIntents` drives both UI affordances (what's clickable) and the AI's search.
- `effectiveAtk(state, card, cards)` / `effectiveDef(state, card, cards)` are exported as
  the **single source of truth** for aura/buff-adjusted stats — combat math AND the web's
  card-face display both call them, so the UI can never drift from the rules (it previously
  did, via a duplicated `displayDefFor`). Show effective stats in the UI, never re-derive.
- Determinism: shuffles/draws use `Rng(seed)`. Server stores the seed so matches replay.

### Card behavior model

`cards.json` = base stats + structural keyword tags. Generic keywords (Raid,
Reassemble, Optimize, Deploy, Guardbreak, Siege, Vehicle) are handled centrally in
`combat.ts`/`economy.ts` by reading tags. Card-SPECIFIC text (auras, ETB, blasts)
is implemented in `EFFECTS[cardId]` (`effects.ts`). Vanilla cards have no entry.

**Activated abilities** (Build phase) are dispatched in `doActivateAbility`
(`reducer.ts`) by `(cardId, abilityId)`, with their legal `activateAbility`
intents enumerated in `getLegalIntents`:
- `black-market-exchange` / `destroy-for-2` — sac a character, +2 money (1×/turn).
- `data-yoko` / `fortify` — exhaust to give a character +1 DEF **until your next
  turn**.
- `assembly-worker-x` / `rally` — exhaust to give a character +1 ATK **until your
  next turn** (offensive twin of Fortify).

The "until your next turn" duration uses optional `CardInstance` fields added to
`@ew/shared`: `defBonusUntilNextTurn` (counted in `effectiveDef`; also backs
Emergency Shielding) and `atkBonusUntilNextTurn` (counted in `effectiveAtk`).
Both are NOT wiped by the End-Phase `clearTempModifiers`, and are deleted at the
controller's next Start phase (`enterPhase` "start"). The search AI's eval counts
both so it values the buffs.

### Expansion systems ("The Reboot" set)
`EffectContext` gained `draw`, `discard`, `returnToHand` (bounce; resets the card,
exiles tokens), `recallFromDiscard` (Convergence), `createToken`, and `beginChoice`,
plus an optional **`onStartTurn`** hook fired in `enterPhase` "start". Tokens use
`CardInstance.isToken` (exiled, never Reassemble) and `tokenUntilEndOfTurn` (cleared
in `runEndPhase`); the **`Fork`** keyword spawns an on-enter token copy. Modal and
opponent-dilemma cards use a `pendingChoice` (internal.ts) resolved by the
**`resolveChoice`** intent: while one is pending, `getLegalIntents` offers only its
chooser the option list and blocks all else; the reducer applies a data-encoded
`ChoiceEffect[]`. "Who acts next" (sim `chooseActor`, search `nextActor`, web
`humanMustRespond`) routes to the chooser, exactly like the block/reassemble handoffs.

## The bonding-curve seam (future-proofing — read this)

- The rules engine **must never import `@ew/shared/ownership`**. A deck that is legal
  plays identically no matter how its cards were acquired.
- Deck editor + lobby call `CardOwnership` (`ownedCount`, `validateDeck`, `valuation`).
- Today the app wires in `UnlimitedOwnership` (own everything, price 0).
- Later: a real implementation backs `ownedCount`/`valuation` with the bonding curve
  (per-card supply → price). Deck legality may then add per-card ownership gates.
  Nothing in `engine` or the in-game UI changes.
- Keep card **identity** stable: `CardDef.id` slugs are permanent keys (they will be
  the on-chain/market keys later). Never renumber or reuse ids.

## Embedding as a website modal (iframe)

- `apps/web` builds to a static bundle servable at e.g. `/play`.
- The owner's site opens `<iframe src=".../play?mode=solo|online&deck=...">` in a modal.
- Requirements the web agent must honor:
  - Fully responsive; must look right in a constrained modal viewport (not just full screen).
  - No reliance on top-level navigation; all state in-app or via query params.
  - `postMessage` bridge for host↔game events (e.g. `close`, `ready`, `resize`) so the
    host page can size/close the modal. Define a tiny, documented message schema.
  - No global CSS leakage concerns (iframe isolates us) — but keep bundle lean.

## Online architecture

```
client (web)                     server (Node + ws)
  listLobby            ───────▶   subscribe to public-room list
                       ◀───────   lobby: TableInfo[]   (pushed on any seat/status change)
  joinRoom + DeckList  ───────▶   create/join room (optional seat side / private), build game
  spectateRoom         ───────▶   watch a live room as a non-seated viewer
  intent               ───────▶   engine.applyIntent (authoritative; rejected for spectators)
                       ◀───────   state: redactFor(state, you)   (opponent zones hidden)
                       ◀───────   state: redactForSpectator(state) (both hands hidden) — spectators
                       ◀───────   joined / spectating / gameOver / error
```

- **Browsable lobby:** the server keeps a set of lobby-subscriber sockets and pushes a
  `TableInfo[]` snapshot (code, per-seat names, status, spectator count) whenever a seat
  fills/empties or a game starts/ends. The client renders these as "tables" with two seats.
  Private rooms (minted with `private: true`) are reachable by code but never listed.
- **Seat choice:** `joinRoom` may carry a preferred `seat` ("p1"/"p2"); the server honors it
  if free. **Spectating:** `spectateRoom` attaches a non-seated viewer who receives
  `redactForSpectator` state (both players' hands/decks hidden) and whose intents are rejected.
- Server validates **every** intent with the engine; rejects illegal ones with `error`.
- Server is the only place the unredacted `GameState` lives during a match.
- Reconnect: room keeps state; on rejoin, resend current `redactFor` view.

## Tech/versions

- Node 20+ (dev box has v22). npm workspaces (no pnpm).
- TypeScript 5.6, `composite` project refs (`tsc -b`).
- Web: Vite + React 18 + Framer Motion. State mgmt: keep it light (Zustand or context).
- Server: `ws` (or `uWebSockets.js` if perf needed); plain Node, TS via tsx/esbuild.
- Tests: Vitest. The engine MUST have unit tests for every keyword + loss condition.
