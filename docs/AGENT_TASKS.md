# Agent Task Breakdown & Coordination

> How to use this: each **workstream** below is sized for one agent and lists the
> files it OWNS (only that agent edits them) and its dependencies. Respect file
> ownership to avoid merge collisions. Shared contracts (`@ew/shared`, the engine
> public API in `packages/engine/src/index.ts`) are **frozen** — propose changes in
> a PR/note, don't edit unilaterally. Mark progress by checking boxes here.

## Sprint status

### Post-Sprint 3
- ✅ **Art mapping APPROVED by owner** (2026-06-03) — `docs/ART_MAP.md` is final, no review pending.
- ✅ **iframe modal embed validated** — reference host page at `apps/web/public/host-demo.html`
  (served at `/host-demo.html`). Verified live end-to-end: `ready` → host `init` → `resize`,
  and in-game ✕ → `requestClose` → host `close` → modal teardown. Zero console errors.
  (Dev double-fires `ready`/`resize` via React StrictMode only; single in production build.)

### Sprint 3 (combat UX + online + test backfill) — DONE & verified
- ✅ **Online e2e**: `apps/server` typecheck clean; **5/5 two-client integration tests pass**
  (room join, redacted views, illegal-intent rejection, turn passing, reconnect-by-rejoin).
  Fixed a test race (awaited "next broadcast" instead of the post-turn-pass state).
- ✅ **Engine test backfill**: **94/94 tests pass** (58 + 34 + 2 across `engine.test.ts` +
  `mechanics.test.ts` + `ai.test.ts`) covering auras, triggered money, Optimize/Deploy/Guardbreak/Siege/
  Reassemble, Black Market Exchange, free reassemble, conditional Raid, §8/§10 edges.
  Stale `TODO(WS3)` comments removed; no engine bugs found.
- ✅ **Combat UX + visual polish** (`apps/web/src/game`): on-board attack flow (select
  attacker → highlighted targets via `getLegalAttackTargets` → Guardbreak prompt → blocker
  assignment → damage preview), income/Optimize panel, Framer Motion (play, lunge, exhaust,
  destruction, money tick), hover-zoom, keyword tooltips. **Verified live**: typecheck +
  build clean, combat played end-to-end (direct attack = ATK, first-turn Raid protection),
  no console errors. Fixed post-merge: 5 type errors (dead combat-intent branches, duplicate
  `scale` key) + `CardSlot` converted to `forwardRef` (AnimatePresence needs the ref for
  exit/destruction animations).
- ✅ **AI-attacks-you blocker handoff**: covered by `ai.test.ts` regression tests. After
  a PLAYER_B attack, PLAYER_A receives block/skip intents, and the defender AI now
  prioritizes blocking Raid attackers after the defender has taken a turn.

### Sprint 1 (foundation)
- ✅ **WS1 — Engine core** DONE & verified (`tsc -b` clean, 41 Vitest tests pass).
  Implemented in `state.ts` / `economy.ts` / `reducer.ts` / `cards.ts`; `index.ts`
  bodies filled. Combat targeting (`getLegalAttackTargets`) intentionally returns `[]`
  as a WS3 seam; `EFFECTS` hooks referenced from the reducer as TODO(WS3) no-ops.
  **WS3:** the `EffectContext` extension point in `effects.ts` is your entry; the
  reducer fires `onEnterPlay`/`onPlayAction` seams where effects should resolve.
  Income requires `card.row === "back"` (zone array + `row` field must stay in sync).
- ✅ **A0 — Art mapping** DONE. All 48 `art` fields point to owner-provided
  `images/named/*.jpg` files (0 nulls, no duplicate refs, all files exist).
  `docs/ART_MAP.md` records the three intentional filename aliases.
- ✅ **WS2 — Web shell** DONE & verified (typecheck clean, `vite build` succeeds,
  art prebuild copies all 48 images to `apps/web/public/cards/`, app renders live).
  Vite+React SPA at `apps/web`; query-param router (`?mode=`), Context store, embed
  bridge (`src/embed.ts` + `docs/EMBED.md`), faction theme tokens, reusable `<Card/>`.
  Placeholders for WS4 (`src/deck/DeckEditor.tsx`) and WS5 (`src/game/GameBoard.tsx`)
  with documented prop interfaces. **Engine is aliased to TS source** (no dist build).
  Fixed post-merge: `src/router.ts` `getRoute()` now memoizes its snapshot (was
  returning a new object each call → `useSyncExternalStore` infinite loop / blank screen).
- ✅ **WS6 — Online server** DONE. `apps/server` is a Node + `ws` WebSocket
  server. Room-based (code join), authoritative game loop: receives `Intent`,
  validates via `applyIntent`, broadcasts `redactFor` to both players. Rejects
  illegal intents with error messages. Stores `rngSeed` + intent log per room.
  Clean disconnect/leave handling. Web client has an `OnlineScreen` lobby with
  room code + deck picker, and a `useOnlineServer` hook. `tsc -b` clean + build.
  Runs via `npm run dev:server` (tsx watch on port 3100).
- ✅ **WS4 — Deck editor** DONE. `apps/web/src/deck/DeckEditor.tsx` implements
  full 48-card pool browser with faction filters, text search, sort, click-to-add,
  deck list sidebar with count controls, live `validateDeck`, load starter/saved
  decks, save to localStorage, card detail overlay with valuation slot, play-solo
  launch. Added `@ew/shared/ownership` sub-path export + vite/tsconfig alias.
  `tsc -b` clean + `vite build` succeeds.
- ✅ **WS7 — Solo AI** DONE. `packages/engine/src/ai.ts` implements the §15
  heuristic priority list: spend down, prioritize income → attackers → ongoings,
  removal on high-value targets, move strongest to front, attack income first,
  block to protect economy and Raid exposure. Uses `getLegalIntents` + `pickAIIntent`. Wired into
  `GameBoard.tsx` — opponent auto-plays with timed delays (600ms build, 400ms
  combat). System X starter deck default. `tsc -b` clean + engine tests pass.
- 🟡 **WS3 — Engine keywords + effects** IN PROGRESS. Combat targeting/resolution,
  direct attack money loss, Raid, Guardbreak, Siege, Reassemble prompts, Black Market
  Exchange activation, key action effects, income gating/modifiers, cost modifiers,
  target-bearing legal `playCard` intents, Resource Reallocation's extra move,
  System Audit's temporary cost tax, reachable Optimize income prompts, Emergency
  Protocols persistent next-character discounting, and Reality Tumbler's move-trigger Raid are
  wired. Card-specific ETB/action effects now live in `packages/engine/src/effects.ts`
  behind a real `EffectContext`. Verified with 58 engine tests plus shared/engine/web
  project-reference typecheck. Remaining polish: broaden exhaustive per-card tests
  and refine UI-facing prompt ergonomics as WS5 integrates combat/effects.
- 🟡 **WS5 — In-game board UI** ADVANCED. `apps/web/src/game/GameBoard.tsx`
  creates a local solo game via the engine API. Phase-aware HUD with step
  indicator bar, both-player hands (face-up yours, card-back opponent), board
  zones with combat-role highlights (attacker/target/blocker glows), grouped
  action panel by category, Framer Motion layout animations + money tick,
  hover damage preview, animated log, winner overlay with play-again. `tsc -b`
  clean + `vite build` succeeds. Remaining polish: deeper Framer Motion card
  transition animations (card play lunge, exhaust rotate, destroy fade) and
  mobile touch refinements.

## Dependency order (what unblocks what)

```
DONE: shared contracts, card data, engine API surface, scaffold
        │
        ├── WS1 Engine core ──────────────┐ (unblocks everything gameplay)
        │                                  │
        ├── A0 Art mapping (independent) ──┤
        │                                  │
        └── WS2 Web shell/build/iframe ────┤
                                           ▼
                  WS3 Engine keywords ─▶ WS5 In-game UI ─▶ WS7 Solo AI
                  WS4 Deck editor ───────────────────────▶ WS6 Online server
```

Agents that can start **immediately in parallel**: WS1, WS2, A0, WS4 (deck editor
can build against `validateDeck` contract + UnlimitedOwnership with a mocked engine).

---

## A0 — Card ⇄ art mapping  *(independent, no code deps)*

**Problem:** `/images/0001..0048.(png|jpg)` are NOT in card-database order
(`0001.jpg` is a Spooky ghost, but card #1 in the DB is Data Yoko). The mapping is
unknown and must be established by **looking at each image**.

- [ ] Visually identify each image and map it to a `cards.json` `id`.
- [ ] Write the chosen filename into each card's `art` field in `data/cards.json`
      (e.g. `"art": "0007.png"`). Use the **png** (higher res) as the master; the
      web build can derive optimized webp.
- [ ] If some cards lack art or some art is unused, record it in a `docs/ART_MAP.md`.
- [ ] Add a generated step (script in `apps/web`) that copies/optimizes
      `/images/<art>` → `apps/web/public/cards/<id>.webp`.

Owner files: `data/cards.json` (art fields only), `docs/ART_MAP.md`.
**Coordinate:** only A0 writes the `art` fields; other agents read them.

---

## WS1 — Engine core (state + reducer + economy)  *(critical path)*

Implement the stubbed public API. Pure functions, no I/O, no `Math.random`.

- [ ] `state.ts`: `createGame` (instantiate decks → CardInstances, shuffle via Rng,
      draw 5, set money 3, random start player), zone move helpers, `redactFor`.
- [ ] `buildCardIndex`, `validateDeck` (DECK_RULES: 40 cards, ≤4 copies).
- [ ] `reducer.ts`: phase machine (start→draw→income→build→combat→end), `applyIntent`
      for: mulligan, playCard, moveCharacter, recycle, resale, advancePhase, endTurn,
      concede. Enforce once-per-turn move + once-per-turn recycle/resale.
- [ ] `economy.ts`: income phase (back-row Characters + Locations with income;
      exhausted still earns unless text says otherwise), cost payment (never < 0),
      money floor 0, `checkLoss` (money 0 AND no card with income > 0 in ANY row,
      end of turn — see handoff §7 income-anywhere rule; `LOSS_CONFIG.incomeAnywhereSaves`
      default true, set false for the legacy back-row-only rule).
- [ ] `getLegalIntents` for non-combat intents.
- [ ] Unit tests (Vitest) for setup, income, loss, recycle/resale, costs.

Owner files: `packages/engine/src/{state,reducer,economy}.ts`, their tests.
Depends on: contracts (done). **Unblocks:** WS3, WS5, WS6, WS7.

> Hand off to WS3 a clear `EffectContext` with helpers (chooseTarget, destroy,
> gainMoney, moveRow, drawCard, etc.) and document them in `effects.ts`.

## WS3 — Engine keywords + card effects  *(depends on WS1)*

Central keyword handling + the `EFFECTS[cardId]` registry.

- [ ] `combat.ts`: declare/target/block/damage per handoff §8; `getLegalAttackTargets`
      (front-first, Siege→Locations, direct only if no back row); Guardbreak choice;
      simultaneous damage; destroy at DEF ≤ 0; no damage stacking.
- [ ] Keywords: **Raid X** (steal on combat damage; first-turn protection;
      Black Budget reduction), **Reassemble** (once per instance default; pay cost;
      return exhausted back row -1 DEF; can't if DEF would be ≤0), **Optimize** /
      **Optimize(Linda)**, **Deploy**, **Guardbreak**, **Siege**, **Vehicle** (front,
      no move).
- [ ] `EFFECTS` entries for every non-vanilla card (see list in `effects.ts`).
- [ ] Combat-phase intents in `applyIntent` + `getLegalIntents`.
- [ ] Unit tests per keyword and per non-vanilla card.

Owner files: `packages/engine/src/{combat,effects}.ts` + tests.

### Rules ambiguities — USE THESE ANSWERS (handoff §18). Do not re-decide.

1. Direct attack removes money = ATK (not just Raid). ✅
2. Reassemble = strictly once per card instance. ✅
3. Infrastructure Audit X destroys a Location. ✅
4. Emergency Protocols discount persists until the next character you play. ✅
5. Phantom Pressure is an **Action**. ✅
6. Replication Loop is an **Action**. ✅

---

## WS2 — Web app shell, build, iframe bridge  *(parallel from start)*

- [ ] Scaffold `apps/web` (Vite + React 18 + TS + Framer Motion). Wire `@ew/engine`,
      `@ew/shared` via workspace + tsconfig paths.
- [ ] App routes/states: Home → (Deck Editor | Play Solo | Play Online).
- [ ] Read mode from query params (`?mode=solo|online&deck=<id>`), for iframe launch.
- [ ] **iframe/postMessage bridge** (`src/embed.ts`): handshake `ready`, host→`close`,
      game→`requestClose`, `resize`. Document the message schema in `docs/EMBED.md`.
- [ ] Responsive shell that looks right inside a constrained modal viewport.
- [ ] Visual design system: faction theming, card frame component baseline.

Owner files: `apps/web/**` (shell/build/embed; in-game board is WS5), `docs/EMBED.md`.

## WS5 — In-game board UI + animations  *(depends on WS1 contract; integrates WS3)*

- [ ] Board layout per handoff §14 (opp ongoing/back/front; your front/back/ongoing).
- [ ] `Card` component: name, faction, cost, type, ATK/DEF/income, keywords,
      exhausted state, current vs base DEF, row. Hover zoom, keyword tooltips.
- [ ] Phase HUD, money display, action log (from `events`), damage preview.
- [ ] Interaction flows: Build (play/move/recycle/resale/end), Combat (highlight
      attackers → targets → Guardbreak prompt → block assignment → damage preview),
      Income (breakdown + optional Optimize prompts).
- [ ] Framer Motion: card play, attack lunge, exhaust rotate, destroy, money tick.
- [ ] Drive everything by submitting `Intent`s through one dispatcher (so the same
      code path serves solitaire and online).

Owner files: `apps/web/src/game/**`.

## WS4 — Deck editor  *(parallel; depends on contracts + ownership stub)*

- [ ] Browse the 48-card pool with art, faction filters, search, card detail.
- [ ] Build/edit a 40-card deck; enforce `validateDeck` + `DECK_RULES`; live count.
- [ ] Load the 4 starter decks; save/duplicate user decks (localStorage now;
      pluggable persistence later).
- [ ] Use `CardOwnership` (`UnlimitedOwnership`) for `validateDeck` + show a
      `valuation` slot in the card detail UI (displays nothing meaningful yet, but
      the hook exists for the bonding-curve future).

Owner files: `apps/web/src/deck/**`.

## WS6 — Online server  *(depends on WS1; ideally WS3)*

- [x] `apps/server`: Node + `ws`. Rooms, join/leave, matchmaking (simple code-based).
- [x] Authoritative loop: receive `intent` → `applyIntent` → broadcast `redactFor`.
- [x] Reject illegal intents with `error`; never trust client state.
- [x] Reconnect handling; store `rngSeed` + intent log per room (replay-ready).
- [ ] (Stretch) SQLite for accounts/match history — keep behind an interface.

Owner files: `apps/server/**`.

## WS7 — Solo AI  *(depends on WS1 + WS3)*

- [x] Implement the §15 heuristic priority list as a bot that, given a `PlayerView`,
      returns an `Intent` (picked from `getLegalIntents`).
- [x] Spend money down, prioritize income → attackers → ongoings; removal on best
      target; sensible attacks/blocks (protect income, prevent Raid).
- [x] Start with System X (handoff §16). Difficulty toggles later.
- [x] Runs client-side for solitaire (no server needed).

Owner files: `packages/engine/src/ai.ts` (engine-hosted so server can use it too).

---

## Cross-cutting conventions

- Card identity: `CardDef.id` slugs are **permanent keys** (future market keys). Never reuse/renumber.
- All randomness via `Rng(seed)`. Engine stays pure.
- The engine never imports `@ew/shared/ownership`.
- Don't change the engine public API signatures or `@ew/shared` types without a note here + ping.
- Keep the handoff snapshot answers (§18) authoritative; flag genuinely new ambiguities here for the owner.

- ✅ **Root tsconfig.json** FIXED. `tsc -b` now discovers all sub-projects.

## Engine / shared-type changes from balance tuning (2026-06)

- **`@ew/shared` `CardInstance` gained `defBonusUntilNextTurn?` / `atkBonusUntilNextTurn?`**
  — buffs that survive the End-Phase temp-modifier clear and expire at the
  controller's next Start phase. Back Data Yoko **Fortify** (+1 DEF), Emergency
  Shielding (+2 DEF), and Assembly Worker X **Rally** (+1 ATK). Additive/optional;
  counted in `effectiveDef`/`effectiveAtk` and the search AI's eval.
  (See ARCHITECTURE.md → Card behavior.)
- **`checkLoss` income-anywhere rule** is now default (`LOSS_CONFIG.incomeAnywhereSaves`).
- Activated-ability dispatch in `doActivateAbility` is keyed by `(cardId, abilityId)`:
  `destroy-for-2` (Black Market Exchange), `fortify` (Data Yoko), `rally` (Assembly Worker X).
- AIs (`pickAIIntent`, `pickSearchIntent`) never voluntarily `concede`.
- **`effectiveAtk` / `effectiveDef` now exported** from the engine public API. The web UI
  (GameBoard + OnlineScreen) renders these instead of re-deriving stats — removed the
  duplicated `displayDefFor` copies that had drifted (missed `defBonusUntilNextTurn` and all
  ATK auras). `Card` gained a `currentAtk` prop; buffed/debuffed stats render green/red.

## Confirmed by owner (2026-06-02)

- ✅ Deck-building `maxCopies` = **4 per card**.
- ✅ **Mixed-faction decks are legal** (any factions + neutrals, no faction lock).

## Open questions for the owner (append as they arise)

- [ ] Hosting target for the WS server (affects deploy config in WS6).
