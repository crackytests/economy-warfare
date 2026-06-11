/**
 * Game state construction, cloning, redaction, and zone-move helpers.
 *
 * Owned by WS1 (engine core). Pure: no I/O, no Date.now(), no Math.random()
 * (uses Rng). createGame instantiates DeckLists into CardInstances, shuffles
 * deterministically from the seed, draws opening hands, and seats players.
 */

import type {
  CardInstance,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  Row,
} from "@ew/shared";
import { SETUP } from "@ew/shared";
import { Rng } from "./rng";
import type { CardIndex, NewGameOptions } from "./index";

// ---- Cloning --------------------------------------------------------------

/**
 * Deep structural clone of game state. The engine is pure — every reducer call
 * clones the input at the boundary and mutates only the copy. GameState is
 * plain JSON-shaped data (no Dates, Maps, functions), so structuredClone is
 * exact and fast. Falls back to JSON round-trip if structuredClone is absent.
 */
export function cloneState(state: GameState): GameState {
  if (typeof structuredClone === "function") return structuredClone(state);
  return JSON.parse(JSON.stringify(state)) as GameState;
}

// ---- Event helpers --------------------------------------------------------

/** Append an event to the log, assigning the monotonic sequence index. */
export function pushEvent(
  state: GameState,
  type: string,
  message: string,
  extra?: { playerId?: PlayerId; data?: Record<string, unknown> },
): GameEvent {
  const ev: GameEvent = {
    type,
    message,
    at: state.log.length,
    ...(extra?.playerId !== undefined ? { playerId: extra.playerId } : {}),
    ...(extra?.data !== undefined ? { data: extra.data } : {}),
  };
  state.log.push(ev);
  return ev;
}

// ---- Lookups --------------------------------------------------------------

export function opponentOf(state: GameState, player: PlayerId): PlayerId {
  return state.turnOrder[0] === player ? state.turnOrder[1] : state.turnOrder[0];
}

/** All in-play zones for a player (front, back, ongoing). */
export function inPlayZones(p: PlayerState): CardInstance[][] {
  return [p.frontRow, p.backRow, p.ongoing];
}

/** Find a card instance anywhere in the game, plus where it lives. */
export interface Located {
  card: CardInstance;
  owner: PlayerState;
  controller: PlayerState;
  zone: "deck" | "hand" | "discard" | "front" | "back" | "ongoing";
}

export function locate(state: GameState, instanceId: string): Located | null {
  for (const pid of state.turnOrder) {
    const p = state.players[pid]!;
    const zones: [Located["zone"], CardInstance[]][] = [
      ["deck", p.deck],
      ["hand", p.hand],
      ["discard", p.discard],
      ["front", p.frontRow],
      ["back", p.backRow],
      ["ongoing", p.ongoing],
    ];
    for (const [zone, arr] of zones) {
      const card = arr.find((c) => c.instanceId === instanceId);
      if (card) {
        const controller = state.players[card.controllerId] ?? p;
        return { card, owner: p, controller, zone };
      }
    }
  }
  return null;
}

// ---- Zone-move helpers ----------------------------------------------------

/** Remove a card instance from a zone array by id; returns it or null. */
export function removeFromZone(zone: CardInstance[], instanceId: string): CardInstance | null {
  const idx = zone.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return null;
  return zone.splice(idx, 1)[0]!;
}

/** Map a board Row to the controller's matching zone array. */
export function zoneForRow(p: PlayerState, row: Row): CardInstance[] {
  switch (row) {
    case "front":
      return p.frontRow;
    case "back":
      return p.backRow;
    case "ongoing":
      return p.ongoing;
  }
}

/** Draw n cards from a player's deck into hand. Returns the cards drawn. */
export function drawCards(p: PlayerState, n: number): CardInstance[] {
  const drawn: CardInstance[] = [];
  for (let i = 0; i < n; i++) {
    const card = p.deck.shift();
    if (!card) break; // empty deck: no deck-out loss in v1.1 rules; just stop.
    card.row = null;
    p.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

/** Send a card to its owner's discard, clearing transient board state. */
export function discardCard(state: GameState, card: CardInstance): void {
  const owner = state.players[card.ownerId]!;
  card.row = null;
  card.exhausted = false;
  card.currentDef = null;
  clearTempModifiers(card);
  card.controllerId = card.ownerId;
  owner.discard.push(card);
}

/**
 * Return an in-play card to its owner's hand ("reboot" / bounce). Resets it to a
 * pristine state (no damage, ready, no Reassemble history). Tokens are EXILED
 * (removed entirely) instead of going to hand. No-op for cards not in play.
 */
export function returnToHand(state: GameState, card: CardInstance): void {
  const loc = locate(state, card.instanceId);
  if (!loc || (loc.zone !== "front" && loc.zone !== "back" && loc.zone !== "ongoing")) return;
  const removed = removeFromZone(zoneForRow(loc.controller, loc.zone), card.instanceId);
  if (!removed) return;
  removed.row = null;
  removed.exhausted = false;
  removed.currentDef = null;
  removed.controllerId = removed.ownerId;
  clearTempModifiers(removed);
  delete removed.defPenaltyFromReassemble;
  delete removed.reassembledCount;
  delete removed.cannotReadyNextStart;
  if (removed.isToken) return; // tokens vanish rather than return to hand
  state.players[removed.ownerId]!.hand.push(removed);
}

/** Return a card from its owner's discard to their hand (Convergence / recall). */
export function recallFromDiscard(state: GameState, card: CardInstance): boolean {
  const owner = state.players[card.ownerId]!;
  const removed = removeFromZone(owner.discard, card.instanceId);
  if (!removed) return false;
  removed.row = null;
  owner.hand.push(removed);
  return true;
}

/** Clear end-of-turn temporary modifiers on a single instance. */
export function clearTempModifiers(card: CardInstance): void {
  delete card.tempAtkModifier;
  delete card.tempDefModifier;
  delete card.tempIncomeModifier;
  delete (card as CardInstance & { tempGuardbreak?: boolean }).tempGuardbreak;
  delete (card as CardInstance & { tempRaidValue?: number }).tempRaidValue;
}

// ---- createGame -----------------------------------------------------------

let instanceCounter = 0;

function makeInstanceId(playerId: PlayerId, cardId: string, seq: number): string {
  return `${playerId}:${cardId}:${seq}`;
}

/**
 * Instantiate a DeckList into CardInstances (one per copy) for a player.
 * instanceIds are deterministic and unique within the game.
 */
function instantiateDeck(
  cards: CardIndex,
  playerId: PlayerId,
  deckCards: { id: string; count: number }[],
): CardInstance[] {
  const out: CardInstance[] = [];
  let seq = 0;
  for (const { id, count } of deckCards) {
    const def = cards.byId.get(id);
    if (!def) throw new Error(`[engine] createGame: unknown card id "${id}"`);
    for (let i = 0; i < count; i++) {
      out.push({
        instanceId: makeInstanceId(playerId, id, seq++),
        cardId: id,
        ownerId: playerId,
        controllerId: playerId,
        row: null,
        exhausted: false,
        currentDef: null,
      });
    }
  }
  return out;
}

/** Create a fresh game: instantiate decks, shuffle, draw opening hands, seat. */
export function createGame(opts: NewGameOptions): GameState {
  if (opts.players.length !== 2) {
    throw new Error(`[engine] createGame requires exactly 2 players, got ${opts.players.length}`);
  }
  // RNG is seeded; advancing it during setup keeps shuffles deterministic.
  const rng = new Rng(opts.rngSeed);

  const [a, b] = opts.players as [
    NewGameOptions["players"][number],
    NewGameOptions["players"][number],
  ];

  const buildPlayer = (p: NewGameOptions["players"][number]): PlayerState => {
    const deck = instantiateDeck(opts.cards, p.id, p.deck.cards);
    rng.shuffle(deck);
    const ps: PlayerState = {
      id: p.id,
      name: p.name,
      deck,
      hand: [],
      discard: [],
      money: SETUP.startingMoney,
      frontRow: [],
      backRow: [],
      ongoing: [],
      hasTakenFirstTurn: false,
      usedMoveThisTurn: false,
      usedRecycleOrResaleThisTurn: false,
    };
    drawCards(ps, SETUP.startingHandSize);
    return ps;
  };

  const playerA = buildPlayer(a);
  const playerB = buildPlayer(b);

  // Choose starting player. Default random via seed (consume one int so it is
  // tied to the seed); honor an explicit override if provided.
  const coin = rng.int(2);
  let startingId: PlayerId;
  if (opts.startingPlayerId !== undefined) {
    if (opts.startingPlayerId !== a.id && opts.startingPlayerId !== b.id) {
      throw new Error(`[engine] startingPlayerId "${opts.startingPlayerId}" is not a player`);
    }
    startingId = opts.startingPlayerId;
  } else {
    startingId = coin === 0 ? a.id : b.id;
  }

  const state: GameState = {
    id: opts.gameId,
    players: { [playerA.id]: playerA, [playerB.id]: playerB },
    turnOrder: [a.id, b.id],
    activePlayerId: startingId,
    phase: "start",
    turnNumber: 1,
    winnerId: null,
    log: [],
    rngSeed: opts.rngSeed,
  };

  pushEvent(state, "gameStart", `Game started. ${state.players[startingId]!.name} goes first.`, {
    playerId: startingId,
  });

  return state;
}

// ---- redactFor ------------------------------------------------------------

/**
 * Produce a player-specific view. The opponent's hidden zones (hand, deck)
 * have their contents replaced with face-down placeholders so counts/animation
 * survive but card identities are hidden. Board zones stay fully visible. The
 * viewing player sees their own everything (deck order is hidden by shuffling a
 * copy? No — we keep the viewer's own deck contents present but order is not a
 * secret the engine guarantees; for safety we also face-down the viewer's deck
 * contents to avoid leaking future draws over the wire).
 */
export function redactFor(state: GameState, player: PlayerId): {
  state: GameState;
  youAre: PlayerId;
} {
  const view = cloneState(state);
  for (const pid of view.turnOrder) {
    const p = view.players[pid]!;
    const isOpponent = pid !== player;
    // Deck contents are secret to everyone (future draws). Replace with hidden
    // placeholders preserving count + ownership.
    p.deck = p.deck.map((c) => hideCard(c));
    // Opponent hand is hidden; the viewer keeps their own hand.
    if (isOpponent) {
      p.hand = p.hand.map((c) => hideCard(c));
    }
  }
  return { state: view, youAre: player };
}

/** Replace a card's identity with a face-down placeholder, keeping ownership. */
function hideCard(c: CardInstance): CardInstance {
  return {
    instanceId: c.instanceId,
    cardId: "__hidden__",
    ownerId: c.ownerId,
    controllerId: c.controllerId,
    row: null,
    exhausted: false,
    currentDef: null,
  };
}
