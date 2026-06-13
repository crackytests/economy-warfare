/**
 * Client <-> server wire protocol AND the engine's intent vocabulary.
 *
 * Design rule (server-authoritative): the client NEVER mutates game state.
 * It sends an Intent; the server validates + applies it via the engine and
 * broadcasts the resulting GameState (or a redacted PlayerView). The same
 * Intent type is what the engine's reducer consumes, so solitaire/local play
 * runs the identical code path with no network.
 */

import type { GameState, PlayerId } from "./types";

/** Player-specific redacted view (opponent hand/deck hidden). */
export interface PlayerView {
  state: GameState; // with opponent's hidden zones replaced by counts/face-down
  youAre: PlayerId;
  legalIntents?: Intent[]; // optional server hint for UI affordances
  spectator?: boolean; // true when this view is for a non-seated watcher (both hands hidden, read-only)
  spectators?: number; // how many spectators are currently watching this room
}

export type Intent =
  | { kind: "mulligan"; player: PlayerId; keep: boolean }
  | { kind: "playCard"; player: PlayerId; instanceId: string; targets?: TargetRef[] }
  | { kind: "moveCharacter"; player: PlayerId; instanceId: string; toRow: "front" | "back" }
  | { kind: "optimize"; player: PlayerId; instanceId: string }
  | { kind: "recycle"; player: PlayerId; discardInstanceId: string }
  | { kind: "resale"; player: PlayerId; discardInstanceId: string }
  | { kind: "activateAbility"; player: PlayerId; instanceId: string; abilityId: string; targets?: TargetRef[] }
  | { kind: "declareAttack"; player: PlayerId; attackerId: string; target: TargetRef }
  | { kind: "guardbreakChoice"; player: PlayerId; attackerId: string; cannotBlockId: string }
  | { kind: "declareBlock"; player: PlayerId; blockerId: string; attackerId: string }
  | { kind: "skipBlock"; player: PlayerId; attackerId: string }
  | { kind: "reassembleChoice"; player: PlayerId; instanceId: string; pay: boolean }
  | { kind: "resolveChoice"; player: PlayerId; optionIndex: number } // modal / opponent dilemma
  | { kind: "advancePhase"; player: PlayerId }   // e.g. End Build, end Combat
  | { kind: "endTurn"; player: PlayerId }
  | { kind: "concede"; player: PlayerId };

/** A target can be a card instance or the opposing player (direct attack). */
export type TargetRef =
  | { kind: "card"; instanceId: string }
  | { kind: "player"; playerId: PlayerId };

export const PLAYER_DIRECT = { kind: "player" } as const;

// ---- Lobby (browsable rooms) ----------------------------------------------

/** One row in the browsable lobby: a "table" with two seats. */
export interface TableInfo {
  code: string;
  /** Occupant display names per engine seat id, or null if the seat is open. */
  seats: { p1: string | null; p2: string | null };
  /** open = no players, waiting = one seated, live = game running, over = finished. */
  status: "open" | "waiting" | "live" | "over";
  /** How many spectators are currently watching. */
  spectators: number;
}

// ---- WebSocket envelope (server <-> client) -------------------------------

export type ClientMessage =
  | {
      t: "joinRoom";
      roomId: string;
      playerName: string;
      deck: import("./types").DeckList;
      /** Preferred seat side; server honors it if free, otherwise picks the open one. */
      seat?: PlayerId;
      /** When minting a room (empty roomId), keep it out of the public lobby. */
      private?: boolean;
    }
  | { t: "spectateRoom"; roomId: string }
  | { t: "listLobby" }            // subscribe to lobby pushes
  | { t: "intent"; roomId: string; intent: Intent }
  | { t: "rematch"; roomId: string; swapSides: boolean } // restart a finished game (optionally swapping seats)
  | { t: "leaveRoom"; roomId: string };

export type ServerMessage =
  | { t: "joined"; roomId: string; youAre: PlayerId }
  | { t: "spectating"; roomId: string }
  | { t: "lobby"; tables: TableInfo[] }
  | { t: "state"; view: PlayerView }
  | { t: "event"; message: string }     // transient toast / log line
  | { t: "error"; code: string; message: string }
  | { t: "gameOver"; winnerId: PlayerId };
