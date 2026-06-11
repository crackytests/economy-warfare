/**
 * Economy Warfare — shared domain types.
 *
 * This package is the contract between the engine, the web client, and the server.
 * It has NO runtime dependencies and NO knowledge of ownership / bonding-curve economy.
 * (Ownership lives in ./ownership.ts and is consumed only by deck-building / matchmaking,
 *  never by the rules engine.)
 */

export type Faction =
  | "Yoko Imperium"
  | "Spooky Ones"
  | "Linda Bioroids"
  | "System X"
  | "Neutral";

export type CardType =
  | "Character"
  | "Vehicle"
  | "Location"
  | "Action"
  | "Ongoing";

export type Keyword =
  | "Raid"
  | "Reassemble"
  | "Optimize"
  | "OptimizeLinda"
  | "Deploy"
  | "Guardbreak"
  | "Siege"
  | "Vehicle"
  | "Fork"; // on enter, create a token copy of this character (exiled on leave)

export type Row = "front" | "back" | "ongoing";

export type Phase =
  | "start"
  | "draw"
  | "income"
  | "build"
  | "combat"
  | "end";

/**
 * Static card definition, loaded from data/cards.json.
 * Immutable reference data — never mutated at runtime.
 */
export interface CardDef {
  id: string;            // stable slug, e.g. "phase-wraith"
  name: string;
  faction: Faction;
  type: CardType;
  cost: number;
  atk: number | null;
  def: number | null;    // base DEF (null for cards without DEF)
  income: number | null;
  keywords: Keyword[];
  text: string;          // human-readable rules text
  art: string | null;    // filename under public/cards/, null until mapping pass (task A0)

  // Optional structured keyword params (engine uses these; absent when N/A)
  raidValue?: number;        // X for Raid X
  reassembleCost?: number;   // default 1
  entersExhausted?: boolean; // e.g. Data Relay Station
}

/**
 * Mutable per-game card instance. One per physical copy in a game.
 */
export interface CardInstance {
  instanceId: string;    // unique within a game
  cardId: string;        // -> CardDef.id
  ownerId: PlayerId;     // who it belongs to (deck owner)
  controllerId: PlayerId;// who currently controls it (usually == owner)

  row: Row | null;       // null while in deck/hand/discard
  exhausted: boolean;
  cannotReadyNextStart?: boolean;

  currentDef: number | null; // tracked separately from base for damage/buffs

  // Reassemble bookkeeping
  reassembledCount?: number;
  defPenaltyFromReassemble?: number;

  // Temporary (end-of-turn) modifiers
  tempAtkModifier?: number;
  tempDefModifier?: number;
  tempIncomeModifier?: number;

  // Longer-duration buffs that SURVIVE the End-Phase clear and expire at the
  // controller's next Start phase ("until your next turn"). DEF backs Data Yoko's
  // Fortify / Emergency Shielding; ATK backs Assembly Worker X's Rally.
  defBonusUntilNextTurn?: number;
  atkBonusUntilNextTurn?: number;

  // Flags set by effects
  cannotAttack?: boolean;
  cannotBlock?: boolean;

  // A token (created by Fork / copy effects). Exiled (removed, not discarded)
  // when it leaves play; cannot Reassemble. May be temporary (until end of turn).
  isToken?: boolean;
  tokenUntilEndOfTurn?: boolean;   // removed in the End Phase of the turn it was made
  tokenUntilNextTurn?: boolean;    // removed at the controller's next Start phase
}

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;

  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];

  money: number;

  frontRow: CardInstance[];
  backRow: CardInstance[];
  ongoing: CardInstance[];

  hasTakenFirstTurn: boolean;
  usedMoveThisTurn: boolean;
  usedRecycleOrResaleThisTurn: boolean;
}

export interface GameState {
  id: string;
  players: Record<PlayerId, PlayerState>;
  turnOrder: [PlayerId, PlayerId];
  activePlayerId: PlayerId;
  phase: Phase;
  turnNumber: number;
  winnerId: PlayerId | null;

  // append-only log of resolved events (drives the action log UI + replays)
  log: GameEvent[];

  // RNG seed so server + clients can produce identical shuffles/draws for replay
  rngSeed: number;
}

export interface GameEvent {
  type: string;
  playerId?: PlayerId;
  message: string;       // human-readable for the action log
  data?: Record<string, unknown>;
  at: number;            // monotonic sequence index
}

/** A deck as authored in the deck editor / stored for a player. */
export interface DeckList {
  id: string;
  name: string;
  faction: Faction | "Mixed";
  cards: { id: string; count: number }[]; // ids -> cards.json
}

/** Deck-building constraints. Owner-confirmed: 40 cards, max 4 copies, mixed factions allowed. */
export const DECK_RULES = {
  size: 40,
  maxCopies: 4,
  factionLocked: false,
} as const;

export const SETUP = {
  startingHandSize: 5,
  drawAfterMulligan: 4,
  startingMoney: 5,
  defaultReassembleCost: 1,
} as const;
