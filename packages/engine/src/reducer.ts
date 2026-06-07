/**
 * Reducer: the phase machine + applyIntent / getLegalIntents.
 *
 * Non-combat intents are handled here. Combat intents (declareAttack /
 * declareBlock / skipBlock / guardbreakChoice / reassembleChoice) are delegated
 * to combat.ts, and card-specific effect resolution lives in effects.ts (fired
 * here via the EFFECTS registry on play / ETB / action resolution).
 *
 * Purity: applyIntent clones the input state and mutates only the clone.
 */

import type {
  CardDef,
  CardInstance,
  GameState,
  Intent,
  PlayerId,
  PlayerState,
  Phase,
} from "@ew/shared";
import type { ApplyResult, CardIndex } from "./index";
import {
  cloneState,
  discardCard,
  drawCards,
  locate,
  opponentOf,
  pushEvent,
  removeFromZone,
  clearTempModifiers,
} from "./state";
import {
  canAfford,
  effectiveCost,
  gainMoney,
  payCost,
  runIncomePhase,
} from "./economy";
import { checkLoss } from "./economy";
// EFFECTS is the registry of card-specific behavior (ETB / Action / income /
// destruction hooks). The reducer fires the relevant hook where each applies.
import { EFFECTS } from "./effects";
import { Rng } from "./rng";
import {
  applyCombatIntent,
  beginCombat,
  clearCombat,
  destroyCard,
  destroyDead,
  legalCombatIntents,
  losePlayerMoney,
} from "./combat";
import { priv, resetTurnFlags } from "./internal";

// ---- Phase order ----------------------------------------------------------

const PHASE_ORDER: Phase[] = ["start", "draw", "income", "build", "combat", "end"];

function nextPhase(phase: Phase): Phase | null {
  const i = PHASE_ORDER.indexOf(phase);
  if (i < 0 || i === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[i + 1]!;
}

// ---- Small helpers --------------------------------------------------------

const err = (state: GameState, code: string, message: string): ApplyResult => ({
  state,
  events: [],
  error: { code, message },
});

function def(cards: CardIndex, card: CardInstance): CardDef | undefined {
  return cards.byId.get(card.cardId);
}

function controlsAnotherLinda(p: PlayerState, cards: CardIndex, exceptId: string): boolean {
  const all = [...p.frontRow, ...p.backRow, ...p.ongoing];
  return all.some((c) => {
    if (c.instanceId === exceptId) return false;
    const d = cards.byId.get(c.cardId);
    return d?.faction === "Linda Bioroids";
  });
}

function moveAllowance(p: PlayerState): number {
  return 1 + p.ongoing.filter((c) => c.cardId === "resource-reallocation").length;
}

function canOptimizeCard(p: PlayerState, card: CardInstance, cards: CardIndex): boolean {
  if (card.exhausted) return false;
  const d = def(cards, card);
  return (
    d?.keywords.includes("Optimize") === true ||
    (d?.keywords.includes("OptimizeLinda") === true && controlsAnotherLinda(p, cards, card.instanceId))
  );
}

function hasIncomeChoice(state: GameState, cards: CardIndex): boolean {
  if (state.phase !== "income") return false;
  const p = state.players[state.activePlayerId]!;
  return [...p.frontRow, ...p.backRow, ...p.ongoing].some((c) => canOptimizeCard(p, c, cards));
}

function playCardIntentsFor(state: GameState, player: PlayerState, card: CardInstance, cards: CardIndex): Intent[] {
  const d = def(cards, card);
  if (!d) return [];
  const base = { kind: "playCard" as const, player: player.id, instanceId: card.instanceId };
  if (d.type !== "Action") {
    // Deploy (§9): a Character with Deploy may, on entering play, immediately
    // move to the back row for free (does NOT consume the once-per-turn move).
    // Surface BOTH choices so the UI and AI can pick: play normally (front), or
    // play + Deploy. The deploy variant self-targets, which doDeployMove keys on.
    if (d.type === "Character" && d.keywords.includes("Deploy")) {
      return [base, { ...base, targets: [{ kind: "card" as const, instanceId: card.instanceId }] }];
    }
    return [base];
  }

  const opponent = state.players[opponentOf(state, player.id)]!;
  const allMine = [...player.frontRow, ...player.backRow, ...player.ongoing, ...player.discard];
  const allEnemy = [...opponent.frontRow, ...opponent.backRow, ...opponent.ongoing];
  const target = (c: CardInstance) => ({ ...base, targets: [{ kind: "card" as const, instanceId: c.instanceId }] });

  switch (d.id) {
    case "system-shutdown":
      return allEnemy.filter((c) => def(cards, c)?.type === "Character").map(target);
    case "forced-liquidation":
      return [...allMine, ...allEnemy].filter((c) => def(cards, c)?.type === "Character" && c.exhausted).map(target);
    case "protocol-purge":
      return [...allMine, ...allEnemy].filter((c) => def(cards, c)?.type === "Ongoing").map(target);
    case "infrastructure-audit-x":
      return [...allMine, ...allEnemy].filter((c) => def(cards, c)?.type === "Location").map(target);
    case "asset-freeze":
      return opponent.backRow.map(target);
    case "temporary-shutdown":
      return [...player.frontRow, ...opponent.frontRow].map(target);
    case "emergency-shielding":
      return [...player.frontRow, ...player.backRow].filter((c) => def(cards, c)?.type === "Character").map(target);
    case "repair-swarm":
      return [...player.frontRow, ...player.backRow].filter((c) => def(cards, c)?.faction === "Linda Bioroids").map(target);
    case "replication-loop":
      return player.discard.filter((c) => def(cards, c)?.faction === "Linda Bioroids").map(target);
    case "phantom-pressure":
      return [...player.frontRow, ...player.backRow].filter((c) => def(cards, c)?.type === "Character").map(target);
    case "system-audit":
      return opponent.hand.filter((c) => def(cards, c)?.type !== "Location").map(target);
    default:
      return [base];
  }
}

// ---- Phase machine --------------------------------------------------------

/**
 * Run the entry behavior for a phase on the active player. Some phases are
 * "automatic" (start/draw/income/end) and run their effects on entry; build
 * and combat are interactive and wait for intents.
 */
function enterPhase(state: GameState, phase: Phase, cards: CardIndex): void {
  state.phase = phase;
  const p = state.players[state.activePlayerId]!;

  switch (phase) {
    case "start": {
      // Reset per-turn flags.
      p.usedMoveThisTurn = false;
      p.usedRecycleOrResaleThisTurn = false;
      resetTurnFlags(state, p.id);
      // Ready cards, honoring cannotReadyNextStart (clear flag instead). Also
      // expire "until your next turn" DEF buffs now that the controller's next
      // turn has arrived (Data Yoko Fortify).
      for (const zone of [p.frontRow, p.backRow, p.ongoing]) {
        for (const c of zone) {
          delete c.defBonusUntilNextTurn;
          delete c.atkBonusUntilNextTurn;
          if (c.cannotReadyNextStart) {
            c.cannotReadyNextStart = false; // skip readying once, then clears
          } else {
            c.exhausted = false;
          }
        }
      }
      // No card in the v1.1 pool has a start-of-turn trigger; if one is added,
      // resolve it here via an EFFECTS start-of-turn hook.
      pushEvent(state, "phase", `${p.name}: Start phase.`, { playerId: p.id });
      break;
    }
    case "draw": {
      const drawn = drawCards(p, 1);
      pushEvent(state, "phase", `${p.name}: Draw phase (drew ${drawn.length}).`, {
        playerId: p.id,
      });
      break;
    }
    case "income": {
      runIncomePhase(state, cards);
      break;
    }
    case "build": {
      pushEvent(state, "phase", `${p.name}: Build phase.`, { playerId: p.id });
      break;
    }
    case "combat": {
      beginCombat(state);
      pushEvent(state, "phase", `${p.name}: Combat phase.`, { playerId: p.id });
      break;
    }
    case "end": {
      runEndPhase(state, cards);
      break;
    }
  }
}

/** End phase: clear temp modifiers, check loss, mark first turn, pass turn. */
function runEndPhase(state: GameState, cards: CardIndex): void {
  clearCombat(state);
  // Clear temporary (end-of-turn) modifiers on ALL in-play cards.
  for (const pid of state.turnOrder) {
    const pp = state.players[pid]!;
    for (const zone of [pp.frontRow, pp.backRow, pp.ongoing]) {
      for (const c of zone) clearTempModifiers(c);
    }
  }
  // No card in the v1.1 pool has an end-of-turn trigger beyond clearing temp
  // modifiers (handled above); add an EFFECTS end-of-turn hook here if one is.

  const active = state.players[state.activePlayerId]!;
  const taxes = priv(state).systemAuditTaxes;
  if (taxes) {
    for (const [instanceId, tax] of Object.entries(taxes)) {
      if (tax?.expiresFor === active.id) delete taxes[instanceId];
    }
  }

  // Loss check (handoff §7) runs at end of turn.
  const loser = checkLoss(state, cards);
  if (loser) {
    const winner = opponentOf(state, loser);
    state.winnerId = winner;
    pushEvent(state, "gameOver", `${state.players[loser]!.name} has no money and no income — they lose.`, {
      playerId: loser,
      data: { loserId: loser, winnerId: winner },
    });
    pushEvent(state, "phase", `${active.name}: End phase.`, { playerId: active.id });
    return; // game over; do not pass the turn.
  }

  // Active player has now taken their first turn.
  active.hasTakenFirstTurn = true;

  pushEvent(state, "phase", `${active.name}: End phase.`, { playerId: active.id });
}

/** Advance to the next phase, or to the next player's start phase after end. */
function advance(state: GameState, cards: CardIndex): void {
  if (state.winnerId) return;
  const np = nextPhase(state.phase);
  if (np) {
    enterPhase(state, np, cards);
    return;
  }
  // We were in `end`: pass the turn to the opponent and begin their start phase.
  const next = opponentOf(state, state.activePlayerId);
  state.activePlayerId = next;
  state.turnNumber += 1;
  enterPhase(state, "start", cards);
}

/**
 * Run the automatic phases up to the next interactive stop (build or combat),
 * or until the game ends. Used after createGame and after endTurn so the active
 * player lands on an actionable phase. start/draw/income auto-run; build is the
 * first interactive stop.
 */
export function settleToInteractive(state: GameState, cards: CardIndex): void {
  // Phases where the engine waits for player intents.
  const interactive = new Set<Phase>(["build", "combat"]);
  let guard = 0;
  while (!state.winnerId && !interactive.has(state.phase) && !hasIncomeChoice(state, cards) && guard++ < 64) {
    advance(state, cards);
  }
}

// ---- applyIntent ----------------------------------------------------------

export function applyIntent(state: GameState, intent: Intent, cards: CardIndex): ApplyResult {
  if (state.winnerId) {
    return err(state, "GAME_OVER", "The game is already over.");
  }

  // Pure boundary: operate on a clone.
  const draft = cloneState(state);
  const logStart = draft.log.length;

  const result = route(draft, intent, cards);
  if (result?.error) {
    // Reject: return the ORIGINAL untouched state with the error.
    return { state, events: [], error: result.error };
  }

  const events = draft.log.slice(logStart);
  return { state: draft, events };
}

/** Returns an error object on rejection, or null on success. */
type RouteResult = { error: { code: string; message: string } } | null;

function route(state: GameState, intent: Intent, cards: CardIndex): RouteResult {
  // Turn/ownership gating: only the active player may act (concede excepted).
  const defenderCombatIntent =
    intent.kind === "declareBlock" ||
    intent.kind === "skipBlock" ||
    intent.kind === "reassembleChoice";
  if (intent.kind !== "concede" && !defenderCombatIntent && intent.player !== state.activePlayerId) {
    return { error: { code: "NOT_ACTIVE", message: "It is not your turn." } };
  }

  switch (intent.kind) {
    case "mulligan":
      return doMulligan(state, intent, cards);
    case "playCard":
      return doPlayCard(state, intent, cards);
    case "moveCharacter":
      return doMoveCharacter(state, intent, cards);
    case "recycle":
      return doRecycle(state, intent, cards);
    case "resale":
      return doResale(state, intent, cards);
    case "advancePhase":
      return doAdvancePhase(state, cards);
    case "endTurn":
      return doEndTurn(state, cards);
    case "concede":
      return doConcede(state, intent);

    // ---- Combat / activated-ability intents -------------------------------
    case "declareAttack":
    case "declareBlock":
    case "skipBlock":
    case "guardbreakChoice":
    case "reassembleChoice": {
      const result = applyCombatIntent(state, intent, cards);
      return result?.error ? { error: result.error } : null;
    }
    case "optimize":
      return doOptimize(state, intent, cards);
    case "activateAbility":
      return doActivateAbility(state, intent, cards);

    default: {
      const _exhaustive: never = intent;
      return { error: { code: "UNKNOWN_INTENT", message: `Unknown intent ${(_exhaustive as Intent).kind}` } };
    }
  }
}

// ---- Intent handlers ------------------------------------------------------

function doMulligan(state: GameState, intent: Extract<Intent, { kind: "mulligan" }>, cards: CardIndex): RouteResult {
  if (state.phase !== "start") {
    return { error: { code: "BAD_PHASE", message: "Mulligan is only legal at the start of the game." } };
  }
  const p = state.players[intent.player]!;
  if (p.hasTakenFirstTurn) {
    return { error: { code: "BAD_PHASE", message: "Mulligan is no longer available." } };
  }
  if (!intent.keep) {
    // Shuffle hand back into deck and draw drawAfterMulligan. Order: put hand
    // on top, then we cannot re-shuffle without the Rng/seed advancing
    // deterministically. We reconstruct an Rng from the seed and re-shuffle the
    // whole deck so it stays pure + replayable.
    p.deck.push(...p.hand.splice(0, p.hand.length).map((c) => ({ ...c, row: null })));
    // Reset instance rows already null; reshuffle deterministically.
    // NOTE: importing Rng lazily to keep state.ts the owner of shuffling concerns.
    reshuffleDeck(state, p);
    drawCards(p, 4);
    pushEvent(state, "mulligan", `${p.name} mulligans and draws 4.`, { playerId: p.id });
  } else {
    pushEvent(state, "mulligan", `${p.name} keeps their hand.`, { playerId: p.id });
  }
  settleToInteractive(state, cards);
  return null;
}

function reshuffleDeck(state: GameState, p: PlayerState): void {
  // Deterministic reshuffle: derive a sub-seed from the game seed + player id so
  // it is reproducible from the stored seed. Engine never uses Math.random.
  let h = state.rngSeed >>> 0;
  for (let i = 0; i < p.id.length; i++) h = (Math.imul(h, 31) + p.id.charCodeAt(i)) >>> 0;
  // local mulberry32 step matching Rng to avoid coupling (Rng is imported below).
  const rng = new Rng(h);
  rng.shuffle(p.deck);
}

function doPlayCard(state: GameState, intent: Extract<Intent, { kind: "playCard" }>, cards: CardIndex): RouteResult {
  if (state.phase !== "build") {
    return { error: { code: "BAD_PHASE", message: "Cards are played during the Build phase." } };
  }
  const p = state.players[intent.player]!;
  const card = p.hand.find((c) => c.instanceId === intent.instanceId);
  if (!card) {
    return { error: { code: "NOT_IN_HAND", message: "That card is not in your hand." } };
  }
  const d = def(cards, card);
  if (!d) {
    return { error: { code: "UNKNOWN_CARD", message: `Unknown card def ${card.cardId}.` } };
  }

  const cost = effectiveCost(d, state, p.id, card);
  if (!canAfford(p, cost)) {
    return { error: { code: "CANT_AFFORD", message: `Not enough money (need ${cost}, have ${p.money}).` } };
  }

  // Remove from hand and pay.
  removeFromZone(p.hand, card.instanceId);
  payCost(p, cost);
  const meta = priv(state);
  if (d.type === "Character" && (meta.emergencyDiscount?.[p.id] ?? 0) > 0) {
    meta.emergencyDiscount![p.id] = Math.max(0, (meta.emergencyDiscount![p.id] ?? 0) - 1);
  }
  meta.playedThisTurn ??= {};
  meta.playedThisTurn[p.id] = (meta.playedThisTurn[p.id] ?? 0) + 1;
  // Mark that this turn's first Action has been played (Production Overseer X
  // makes only the first Action free; later Actions pay full price).
  if (d.type === "Action") {
    meta.firstActionPlayedThisTurn ??= {};
    meta.firstActionPlayedThisTurn[p.id] = true;
  }

  // Placement per handoff §5.
  switch (d.type) {
    case "Character": {
      card.row = "front";
      card.exhausted = false;
      card.currentDef = d.def;
      p.frontRow.push(card);
      pushEvent(state, "play", `${p.name} plays ${d.name} to the front row.`, {
        playerId: p.id,
        data: { instanceId: card.instanceId, cardId: d.id },
      });
      // ETB effects fire via EFFECTS[d.id].onEnterPlay; Deploy (optional
      // immediate move that does NOT use the once-per-turn move) is opt-in by
      // passing a card target, handled by doDeployMove below.
      fireEnterPlay(state, card, d, cards);
      if (d.keywords.includes("Deploy") && intent.targets?.[0]?.kind === "card") {
        // Target self with a card ref to opt into the immediate Deploy move.
        doDeployMove(state, card, p, cards);
      }
      break;
    }
    case "Vehicle": {
      card.row = "front"; // Vehicles enter front and cannot move.
      card.exhausted = false;
      card.currentDef = d.def;
      p.frontRow.push(card);
      pushEvent(state, "play", `${p.name} plays Vehicle ${d.name} to the front row.`, {
        playerId: p.id,
        data: { instanceId: card.instanceId, cardId: d.id },
      });
      fireEnterPlay(state, card, d, cards);
      break;
    }
    case "Location": {
      card.row = "back";
      // Data Relay Station enters exhausted (structural flag on the def).
      card.exhausted = d.entersExhausted === true;
      card.currentDef = d.def;
      p.backRow.push(card);
      pushEvent(state, "play", `${p.name} plays ${d.name} to the back row.`, {
        playerId: p.id,
        data: { instanceId: card.instanceId, cardId: d.id, entersExhausted: card.exhausted },
      });
      // ETB effects (e.g. Strategic Reserve gains 2 money) via onEnterPlay.
      fireEnterPlay(state, card, d, cards);
      break;
    }
    case "Ongoing": {
      card.row = "ongoing";
      card.exhausted = false;
      card.currentDef = null;
      p.ongoing.push(card);
      pushEvent(state, "play", `${p.name} plays Ongoing ${d.name}.`, {
        playerId: p.id,
        data: { instanceId: card.instanceId, cardId: d.id },
      });
      // Continuous auras (Predictive Shielding, Network Bloom, etc.) are read
      // on demand by combat/economy from the ongoing zone; ETB hooks fire here.
      fireEnterPlay(state, card, d, cards);
      break;
    }
    case "Action": {
      // Actions resolve immediately then go to discard: EFFECTS[d.id].onPlayAction
      // resolves the card's text (targets in intent.targets) BEFORE discarding.
      pushEvent(state, "play", `${p.name} plays Action ${d.name}.`, {
        playerId: p.id,
        data: { instanceId: card.instanceId, cardId: d.id },
      });
      firePlayAction(state, card, d, cards, intent.targets ?? []);
      discardCard(state, card);
      break;
    }
  }

  return null;
}

/** Fire a card's ETB effect, if it has one (no-op otherwise). */
function fireEnterPlay(state: GameState, card: CardInstance, def: CardDef, cards: CardIndex): void {
  const effect = EFFECTS[def.id];
  if (effect?.onEnterPlay) {
    effect.onEnterPlay(makeEffectContext(state, card, cards, []));
  }
}

/** Resolve an Action card's effect, if it has one, then clean up the dead. */
function firePlayAction(state: GameState, card: CardInstance, def: CardDef, cards: CardIndex, targets: import("@ew/shared").TargetRef[] = []): void {
  const effect = EFFECTS[def.id];
  if (effect?.onPlayAction) {
    effect.onPlayAction(makeEffectContext(state, card, cards, targets));
  }
  destroyDead(state, cards);
}

function makeEffectContext(
  state: GameState,
  card: CardInstance,
  cards: CardIndex,
  targets: import("@ew/shared").TargetRef[],
): import("./effects").EffectContext {
  const firstTarget = () => {
    const t = targets[0];
    if (!t || t.kind !== "card") return null;
    return locate(state, t.instanceId)?.card ?? null;
  };
  return {
    state,
    self: card,
    controllerId: card.controllerId,
    cards,
    targets,
    emit: (message, data) => pushEvent(state, "effect", message, { playerId: card.controllerId, data }),
    def: (c) => def(cards, c),
    firstTarget,
    destroy: (target) => destroyCard(state, target, cards),
    gainMoney: (playerId, amount) => gainMoney(state.players[playerId]!, amount),
    loseMoney: (playerId, amount, reason) => losePlayerMoney(state, playerId, amount, cards, { reason }),
    setFrozenIncome: (instanceId) => {
      const frozen = (priv(state).frozenIncome ??= {});
      frozen[instanceId] = true;
    },
    setSkipIncome: (playerId) => {
      const skipIncome = (priv(state).skipIncomeOnce ??= {});
      skipIncome[playerId] = true;
    },
    setCostTax: (instanceId, expiresFor) => {
      const taxes = (priv(state).systemAuditTaxes ??= {});
      taxes[instanceId] = { expiresFor };
    },
  };
}

function doDeployMove(state: GameState, card: CardInstance, p: PlayerState, cards: CardIndex): void {
  const d = def(cards, card);
  if (!d || d.type !== "Character") return;
  const moved = removeFromZone(p.frontRow, card.instanceId);
  if (!moved) return;
  moved.row = "back";
  p.backRow.push(moved);
  pushEvent(state, "deploy", `${d.name} deploys to the back row.`, {
    playerId: p.id,
    data: { instanceId: moved.instanceId },
  });
}

function firstCardTarget(state: GameState, targets: import("@ew/shared").TargetRef[]): CardInstance | null {
  const t = targets[0];
  if (!t || t.kind !== "card") return null;
  return locate(state, t.instanceId)?.card ?? null;
}

function doMoveCharacter(state: GameState, intent: Extract<Intent, { kind: "moveCharacter" }>, cards: CardIndex): RouteResult {
  if (state.phase !== "build") {
    return { error: { code: "BAD_PHASE", message: "Characters move during the Build phase." } };
  }
  const p = state.players[intent.player]!;
  const meta = priv(state);
  const movesUsed = meta.moveCountThisTurn?.[p.id] ?? (p.usedMoveThisTurn ? 1 : 0);
  if (movesUsed >= moveAllowance(p)) {
    return { error: { code: "MOVE_USED", message: "You have already moved a character this turn." } };
  }
  const loc = locate(state, intent.instanceId);
  if (!loc || loc.controller.id !== p.id || (loc.zone !== "front" && loc.zone !== "back")) {
    return { error: { code: "BAD_TARGET", message: "That is not a character you control on the battlefield." } };
  }
  const d = def(cards, loc.card);
  if (!d || d.type !== "Character") {
    return { error: { code: "NOT_MOVABLE", message: "Only Characters can move between rows." } };
  }
  if (d.type === "Character" && d.keywords.includes("Vehicle")) {
    return { error: { code: "NOT_MOVABLE", message: "Vehicles cannot move." } };
  }
  const fromRow = loc.zone === "front" ? "front" : "back";
  if (fromRow === intent.toRow) {
    return { error: { code: "NO_OP_MOVE", message: "That character is already in that row." } };
  }
  const fromZone = fromRow === "front" ? p.frontRow : p.backRow;
  const toZone = intent.toRow === "front" ? p.frontRow : p.backRow;
  const moved = removeFromZone(fromZone, loc.card.instanceId)!;
  moved.row = intent.toRow;
  if (moved.cardId === "reality-tumbler" && intent.toRow === "front") {
    (moved as CardInstance & { tempRaidValue?: number }).tempRaidValue = 1;
  }
  toZone.push(moved);
  meta.moveCountThisTurn ??= {};
  const nextMoveCount = movesUsed + 1;
  meta.moveCountThisTurn[p.id] = nextMoveCount;
  p.usedMoveThisTurn = nextMoveCount >= 1;
  pushEvent(state, "move", `${p.name} moves ${d.name} to the ${intent.toRow} row.`, {
    playerId: p.id,
    data: { instanceId: moved.instanceId, toRow: intent.toRow },
  });
  return null;
}

function doOptimize(state: GameState, intent: Extract<Intent, { kind: "optimize" }>, cards: CardIndex): RouteResult {
  if (state.phase !== "income") {
    return { error: { code: "BAD_PHASE", message: "Optimize is used during the Income phase." } };
  }
  const p = state.players[intent.player]!;
  const loc = locate(state, intent.instanceId);
  if (!loc || loc.controller.id !== p.id || loc.card.exhausted) {
    return { error: { code: "BAD_TARGET", message: "Choose a ready card you control." } };
  }
  const d = def(cards, loc.card);
  if (!canOptimizeCard(p, loc.card, cards)) {
    return { error: { code: "NO_OPTIMIZE", message: "That card does not have Optimize right now." } };
  }
  loc.card.exhausted = true;
  gainMoney(p, 1);
  pushEvent(state, "optimize", `${p.name} optimizes ${d?.name ?? loc.card.cardId} for 1 money.`, {
    playerId: p.id,
    data: { instanceId: loc.card.instanceId },
  });
  return null;
}

function doActivateAbility(state: GameState, intent: Extract<Intent, { kind: "activateAbility" }>, cards: CardIndex): RouteResult {
  if (state.phase !== "build") {
    return { error: { code: "BAD_PHASE", message: "Activated abilities are used during Build." } };
  }
  const p = state.players[intent.player]!;
  const loc = locate(state, intent.instanceId);
  if (!loc || loc.controller.id !== p.id) {
    return { error: { code: "BAD_TARGET", message: "Choose an ability source you control." } };
  }
  const source = loc.card;

  // Black Market Exchange — once per turn: destroy a character you control, +2.
  if (source.cardId === "black-market-exchange" && intent.abilityId === "destroy-for-2") {
    const abilityKey = `${p.id}:${source.instanceId}:${intent.abilityId}`;
    const meta = priv(state);
    meta.usedAbilitiesThisTurn ??= {};
    if (meta.usedAbilitiesThisTurn[abilityKey]) {
      return { error: { code: "ABILITY_USED", message: "That ability has already been used this turn." } };
    }
    const target = firstCardTarget(state, intent.targets ?? []);
    if (!target || target.controllerId !== p.id || def(cards, target)?.type !== "Character") {
      return { error: { code: "BAD_TARGET", message: "Destroy one character you control." } };
    }
    destroyCard(state, target, cards);
    gainMoney(p, 2);
    meta.usedAbilitiesThisTurn[abilityKey] = true;
    pushEvent(state, "ability", `${p.name} uses Black Market Exchange.`, {
      playerId: p.id,
      data: { sourceId: source.instanceId, targetId: target.instanceId },
    });
    return null;
  }

  // Data Yoko Fortify — exhaust: give a character you control +1 DEF until your
  // next turn (the exhaust cost gates it to once per ready Data Yoko per turn).
  if (source.cardId === "data-yoko" && intent.abilityId === "fortify") {
    if (source.exhausted) {
      return { error: { code: "ABILITY_USED", message: "Data Yoko is exhausted." } };
    }
    const target = firstCardTarget(state, intent.targets ?? []);
    if (!target || target.controllerId !== p.id || def(cards, target)?.type !== "Character") {
      return { error: { code: "BAD_TARGET", message: "Choose a character you control." } };
    }
    source.exhausted = true;
    target.defBonusUntilNextTurn = (target.defBonusUntilNextTurn ?? 0) + 1;
    pushEvent(state, "ability", `${p.name}: Data Yoko fortifies ${def(cards, target)?.name ?? "a character"} (+1 DEF).`, {
      playerId: p.id,
      data: { sourceId: source.instanceId, targetId: target.instanceId },
    });
    return null;
  }

  // Assembly Worker X Rally — exhaust: give a character you control +1 ATK until
  // your next turn (offensive twin of Data Yoko's Fortify; exhaust gates it).
  if (source.cardId === "assembly-worker-x" && intent.abilityId === "rally") {
    if (source.exhausted) {
      return { error: { code: "ABILITY_USED", message: "Assembly Worker X is exhausted." } };
    }
    const target = firstCardTarget(state, intent.targets ?? []);
    if (!target || target.controllerId !== p.id || def(cards, target)?.type !== "Character") {
      return { error: { code: "BAD_TARGET", message: "Choose a character you control." } };
    }
    source.exhausted = true;
    target.atkBonusUntilNextTurn = (target.atkBonusUntilNextTurn ?? 0) + 1;
    pushEvent(state, "ability", `${p.name}: Assembly Worker X rallies ${def(cards, target)?.name ?? "a character"} (+1 ATK).`, {
      playerId: p.id,
      data: { sourceId: source.instanceId, targetId: target.instanceId },
    });
    return null;
  }

  return { error: { code: "UNKNOWN_ABILITY", message: "Unknown activated ability." } };
}

function doRecycle(state: GameState, intent: Extract<Intent, { kind: "recycle" }>, _cards: CardIndex): RouteResult {
  if (state.phase !== "build") {
    return { error: { code: "BAD_PHASE", message: "Recycle is a Build-phase action." } };
  }
  const p = state.players[intent.player]!;
  if (p.usedRecycleOrResaleThisTurn) {
    return { error: { code: "RECYCLE_USED", message: "You have already used Recycle or Resale this turn." } };
  }
  if (p.money < 1) {
    return { error: { code: "CANT_AFFORD", message: "Recycle costs 1 money." } };
  }
  const card = p.hand.find((c) => c.instanceId === intent.discardInstanceId);
  if (!card) {
    return { error: { code: "NOT_IN_HAND", message: "Choose a card from your hand to discard." } };
  }
  removeFromZone(p.hand, card.instanceId);
  discardCard(state, card);
  p.money -= 1;
  const drawn = drawCards(p, 1);
  p.usedRecycleOrResaleThisTurn = true;
  pushEvent(state, "recycle", `${p.name} recycles: discard 1, pay 1, draw ${drawn.length}.`, {
    playerId: p.id,
  });
  return null;
}

function doResale(state: GameState, intent: Extract<Intent, { kind: "resale" }>, _cards: CardIndex): RouteResult {
  if (state.phase !== "build") {
    return { error: { code: "BAD_PHASE", message: "Resale is a Build-phase action." } };
  }
  const p = state.players[intent.player]!;
  if (p.usedRecycleOrResaleThisTurn) {
    return { error: { code: "RECYCLE_USED", message: "You have already used Recycle or Resale this turn." } };
  }
  const card = p.hand.find((c) => c.instanceId === intent.discardInstanceId);
  if (!card) {
    return { error: { code: "NOT_IN_HAND", message: "Choose a card from your hand to discard." } };
  }
  removeFromZone(p.hand, card.instanceId);
  discardCard(state, card);
  gainMoney(p, 1);
  p.usedRecycleOrResaleThisTurn = true;
  pushEvent(state, "resale", `${p.name} resells: discard 1, gain 1 money.`, { playerId: p.id });
  return null;
}

function doAdvancePhase(state: GameState, cards: CardIndex): RouteResult {
  // From income -> build, build -> combat, or combat -> end (then turn passes via end handling).
  if (state.phase !== "income" && state.phase !== "build" && state.phase !== "combat") {
    return { error: { code: "BAD_PHASE", message: "Nothing to advance from here." } };
  }
  advance(state, cards);
  // If we advanced into an automatic phase chain (end), settle through it and
  // hand the turn to the opponent, landing them on their first interactive stop.
  settleToInteractive(state, cards);
  return null;
}

function doEndTurn(state: GameState, cards: CardIndex): RouteResult {
  if (state.phase !== "build" && state.phase !== "combat") {
    return { error: { code: "BAD_PHASE", message: "You can only end your turn during Build or Combat." } };
  }
  // Fast-forward to the end phase, run it, pass the turn, and settle the next
  // player's automatic phases up to their Build phase.
  let guard = 0;
  // Cast: advance() mutates state.phase, but TS narrowed it to "build"|"combat"
  // from the guard above and can't see the mutation across the call.
  while ((state.phase as string) !== "end" && !state.winnerId && guard++ < 16) {
    advance(state, cards);
  }
  if (!state.winnerId) {
    // We are now at end (just run); advance() one more time to pass the turn.
    advance(state, cards);
    settleToInteractive(state, cards);
  }
  return null;
}

function doConcede(state: GameState, intent: Extract<Intent, { kind: "concede" }>): RouteResult {
  const p = state.players[intent.player];
  if (!p) return { error: { code: "BAD_PLAYER", message: "Unknown player." } };
  const winner = opponentOf(state, intent.player);
  state.winnerId = winner;
  pushEvent(state, "gameOver", `${p.name} concedes.`, {
    playerId: intent.player,
    data: { loserId: intent.player, winnerId: winner },
  });
  return null;
}

// ---- getLegalIntents (non-combat) -----------------------------------------

/**
 * Enumerate every legal intent for a player in the current state. Drives UI
 * affordances and the Solo AI's search.
 *
 * Includes the non-combat set (play/move/recycle/resale/optimize/activateAbility
 * /phase-control/concede) plus the combat-phase intents (declareAttack /
 * declareBlock / skipBlock / guardbreakChoice / reassembleChoice), the latter
 * sourced from legalCombatIntents in combat.ts.
 */
export function getLegalIntents(state: GameState, player: PlayerId, cards: CardIndex): Intent[] {
  const out: Intent[] = [];
  if (state.winnerId) return out;

  // Concede is always available to either player.
  out.push({ kind: "concede", player });

  out.push(...legalCombatIntents(state, player, cards));

  if (player !== state.activePlayerId) return out;
  const p = state.players[player]!;

  switch (state.phase) {
    case "start": {
      // Mulligan only before a player has taken their first turn.
      if (!p.hasTakenFirstTurn) {
        out.push({ kind: "mulligan", player, keep: true });
        out.push({ kind: "mulligan", player, keep: false });
      }
      break;
    }
    case "build": {
      // Play any affordable card from hand.
      for (const c of p.hand) {
        const d = def(cards, c);
        if (!d) continue;
        const cost = effectiveCost(d, state, p.id, c);
        if (canAfford(p, cost)) {
          out.push(...playCardIntentsFor(state, p, c, cards));
        }
      }
      // Move non-Vehicle characters; Resource Reallocation grants extra allowance.
      const movesUsed = priv(state).moveCountThisTurn?.[p.id] ?? (p.usedMoveThisTurn ? 1 : 0);
      if (movesUsed < moveAllowance(p)) {
        for (const c of p.frontRow) {
          const d = def(cards, c);
          if (d?.type === "Character" && !d.keywords.includes("Vehicle")) {
            out.push({ kind: "moveCharacter", player, instanceId: c.instanceId, toRow: "back" });
          }
        }
        for (const c of p.backRow) {
          const d = def(cards, c);
          if (d?.type === "Character" && !d.keywords.includes("Vehicle")) {
            out.push({ kind: "moveCharacter", player, instanceId: c.instanceId, toRow: "front" });
          }
        }
      }
      // Recycle / Resale (once per turn, mutually exclusive).
      if (!p.usedRecycleOrResaleThisTurn) {
        for (const c of p.hand) {
          if (p.money >= 1) out.push({ kind: "recycle", player, discardInstanceId: c.instanceId });
          out.push({ kind: "resale", player, discardInstanceId: c.instanceId });
        }
      }
      for (const source of p.backRow.filter((c) => c.cardId === "black-market-exchange")) {
        for (const c of [...p.frontRow, ...p.backRow]) {
          if (def(cards, c)?.type === "Character") {
            out.push({
              kind: "activateAbility",
              player,
              instanceId: source.instanceId,
              abilityId: "destroy-for-2",
              targets: [{ kind: "card", instanceId: c.instanceId }],
            });
          }
        }
      }
      // Data Yoko Fortify (+1 DEF) / Assembly Worker X Rally (+1 ATK) — a ready
      // source (any row) may exhaust to buff a character you control until your
      // next turn.
      const buffSources: Array<{ id: string; ability: string }> = [
        { id: "data-yoko", ability: "fortify" },
        { id: "assembly-worker-x", ability: "rally" },
      ];
      for (const { id, ability } of buffSources) {
        for (const source of [...p.frontRow, ...p.backRow].filter((c) => c.cardId === id && !c.exhausted)) {
          for (const c of [...p.frontRow, ...p.backRow]) {
            if (def(cards, c)?.type === "Character") {
              out.push({
                kind: "activateAbility",
                player,
                instanceId: source.instanceId,
                abilityId: ability,
                targets: [{ kind: "card", instanceId: c.instanceId }],
              });
            }
          }
        }
      }
      out.push({ kind: "advancePhase", player });
      out.push({ kind: "endTurn", player });
      break;
    }
    case "income": {
      for (const c of [...p.frontRow, ...p.backRow, ...p.ongoing]) {
        if (canOptimizeCard(p, c, cards)) {
          out.push({ kind: "optimize", player, instanceId: c.instanceId });
        }
      }
      out.push({ kind: "advancePhase", player });
      break;
    }
    case "combat": {
      out.push({ kind: "advancePhase", player });
      out.push({ kind: "endTurn", player });
      break;
    }
    default:
      // draw / income / end are automatic; no interactive intents besides concede.
      break;
  }
  return out;
}
