/**
 * Economy Warfare rules engine — PUBLIC API (the contract).
 *
 * This is the single entry point used by:
 *   - apps/server  (authoritative: validates + applies every intent)
 *   - apps/web     (local solitaire/hotseat; optimistic preview)
 *   - the Solo AI  (calls getLegalIntents + applyIntent to search/plan)
 *
 * The engine is PURE: applyIntent never mutates its input; it returns a new
 * state. No I/O, no Date.now(), no Math.random() (use Rng). No imports from
 * @ew/shared/ownership — gameplay is ownership-agnostic.
 *
 * The signatures here are the agreed contract — do not change them without
 * updating docs/ARCHITECTURE.md and pinging the web + server agents, since both
 * compile against this surface.
 */

import type {
  CardDef,
  DeckList,
  GameEvent,
  GameState,
  Intent,
  PlayerId,
  PlayerView,
  TargetRef,
} from "@ew/shared";
import type { DeckLegality } from "@ew/shared";
import { DECK_RULES } from "@ew/shared";

// Internal implementation modules. The public functions below are the frozen
// contract; they delegate here (reducer/economy/combat/state, plus the effects
// registry for card-specific behavior).
import * as stateImpl from "./state";
import * as reducer from "./reducer";
import * as economy from "./economy";
import * as combat from "./combat";

export { Rng } from "./rng";

// ---- Card data ------------------------------------------------------------

/** Indexed card definitions for O(1) lookup by id. */
export interface CardIndex {
  all: CardDef[];
  byId: Map<string, CardDef>;
}

/** Build a CardIndex from the parsed data/cards.json `cards` array. */
export function buildCardIndex(cards: CardDef[]): CardIndex {
  const byId = new Map<string, CardDef>();
  for (const c of cards) {
    if (byId.has(c.id)) {
      throw new Error(`[engine] buildCardIndex: duplicate card id "${c.id}"`);
    }
    byId.set(c.id, c);
  }
  return { all: cards, byId };
}

// ---- Game lifecycle -------------------------------------------------------

export interface NewGameOptions {
  gameId: string;
  cards: CardIndex;
  players: { id: PlayerId; name: string; deck: DeckList }[];
  rngSeed: number;
  startingPlayerId?: PlayerId; // default: random via seed
}

/** Create a fresh game: instantiate decks, shuffle, draw opening hands. */
export function createGame(opts: NewGameOptions): GameState {
  return stateImpl.createGame(opts);
}

// ---- Intents (the reducer) ------------------------------------------------

export interface ApplyResult {
  state: GameState;          // next state (input is never mutated)
  events: GameEvent[];       // what happened, for the log + animations
  error?: { code: string; message: string }; // set => state returned unchanged
}

/** Validate + apply a single intent. The ONLY way to advance the game. */
export function applyIntent(state: GameState, intent: Intent, cards: CardIndex): ApplyResult {
  return reducer.applyIntent(state, intent, cards);
}

/** Enumerate every legal intent for a player in the current state (drives UI + AI). */
export function getLegalIntents(state: GameState, player: PlayerId, cards: CardIndex): Intent[] {
  return reducer.getLegalIntents(state, player, cards);
}

// ---- Combat helpers (exposed for UI highlighting) -------------------------

/**
 * Legal attack targets for an attacker (see handoff §8.2).
 *
 * Implements the §8.2 algorithm via combat.ts: front-row first, Siege attackers
 * may also reach back-row Locations, and a direct (player) target is offered
 * only when the defender has no back-row cards.
 */
export function getLegalAttackTargets(
  state: GameState,
  attackerInstanceId: string,
  cards: CardIndex,
): TargetRef[] {
  return combat.getLegalAttackTargets(state, attackerInstanceId, cards);
}

// ---- Views / redaction ----------------------------------------------------

/** Produce a player-specific view with the opponent's hidden zones redacted. */
export function redactFor(state: GameState, player: PlayerId): PlayerView {
  const { state: view, youAre } = stateImpl.redactFor(state, player);
  return { state: view, youAre };
}

/** Produce a spectator view: both players' hands and decks are hidden. */
export function redactForSpectator(state: GameState): PlayerView {
  const { state: view, youAre } = stateImpl.redactForSpectator(state);
  return { state: view, youAre, spectator: true };
}

// ---- Win/loss -------------------------------------------------------------

/** Returns the losing player id if a loss condition is met at end of turn, else null. */
export function checkLoss(state: GameState, cards: CardIndex): PlayerId | null {
  return economy.checkLoss(state, cards);
}

// ---- Deck validation ------------------------------------------------------

/** Structural deck legality (size + copy limits per DECK_RULES). Ownership is separate. */
export function validateDeck(deck: DeckList, cards: CardIndex): DeckLegality {
  const reasons: string[] = [];
  const total = deck.cards.reduce((n, c) => n + c.count, 0);
  if (total !== DECK_RULES.size) {
    reasons.push(`Deck must have ${DECK_RULES.size} cards (has ${total}).`);
  }
  const seen = new Set<string>();
  for (const c of deck.cards) {
    if (seen.has(c.id)) {
      reasons.push(`Duplicate entry for "${c.id}" — combine counts into one entry.`);
    }
    seen.add(c.id);
    if (c.count < 1) {
      reasons.push(`Entry "${c.id}" has a non-positive count (${c.count}).`);
    }
    if (c.count > DECK_RULES.maxCopies) {
      reasons.push(`Too many copies of "${c.id}" (${c.count} > ${DECK_RULES.maxCopies}).`);
    }
    if (!cards.byId.has(c.id)) {
      reasons.push(`Unknown card id "${c.id}".`);
    }
  }
  // DECK_RULES.factionLocked is false (mixed factions allowed) — no faction gate.
  return { ok: reasons.length === 0, reasons };
}

export * from "./effects";
export { pickAIIntent } from "./ai";
export { pickSearchIntent, evaluatePosition } from "./search-ai";
export { frozenIncomeIds } from "./economy";
// Effective (aura/buff-adjusted) stats — single source of truth for combat math
// AND the UI's stat display, so the two can never drift.
export { effectiveAtk, effectiveDef } from "./combat";
