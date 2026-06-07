import { WebSocketServer, WebSocket } from "ws";
import {
  applyIntent,
  buildCardIndex,
  createGame,
  redactFor,
  type CardIndex,
} from "@ew/engine";
import type {
  CardDef,
  ClientMessage,
  DeckList,
  GameState,
  Intent,
  PlayerId,
  ServerMessage,
} from "@ew/shared";
import { ALL_CARDS } from "./cards.js";

/**
 * Economy Warfare online server — authoritative, server holds the only
 * unredacted GameState. Clients send Intents; the server validates + applies
 * every one through the pure engine and broadcasts a per-player redacted view.
 *
 * Room model
 * ----------
 * - A "room" is identified by a short code (e.g. "K7Q2"). A client may join a
 *   specific code, or send an empty roomId to have the server MINT a fresh code
 *   ("create room"). The minted/joined code is returned immediately in a
 *   `joined` message so the lobby can display it before an opponent arrives.
 * - The first player to a room waits; when the second joins, the game starts.
 *
 * Reconnect model (within the frozen protocol — no new message types)
 * -------------------------------------------------------------------
 * `joinRoom` carries only roomId + playerName + deck (no stable token). We
 * therefore key reconnect on (roomId, playerName): if a seat with that name
 * exists but its socket is gone/closed, a fresh joinRoom from the same name
 * RE-BINDS that seat to the new socket and immediately resends the current
 * redacted view. This lets a refreshed/disconnected client resume a match.
 */

interface Seat {
  ws: WebSocket | null; // null while disconnected (seat reserved for reconnect)
  name: string;
  deck: DeckList;
  connected: boolean;
}

interface Room {
  id: string;
  /** Seats keyed by engine PlayerId ("p1" / "p2"). */
  seats: Map<PlayerId, Seat>;
  state: GameState | null;
  cards: CardIndex;
  rngSeed: number;
  /** Ordered, replay-ready log of every accepted intent. */
  intentLog: Intent[];
}

const rooms = new Map<string, Room>();
/** Reverse index: which (room, seat) a given socket currently occupies. */
const wsToSeat = new Map<WebSocket, { roomId: string; playerId: PlayerId }>();

// Shared card index — base data is immutable, safe to share across rooms.
const CARD_INDEX: CardIndex = buildCardIndex(ALL_CARDS as CardDef[]);

// ---- room code minting ----------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars

function mintRoomCode(rng: () => number): string {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

/** Injectable randomness so tests stay deterministic if they wish. */
let randomSource: () => number = Math.random;
export function __setRandomSource(fn: () => number): void {
  randomSource = fn;
}

// ---- send helpers ----------------------------------------------------------

function send(ws: WebSocket | null, msg: ServerMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const seat of room.seats.values()) {
    send(seat.ws, msg);
  }
}

function broadcastState(room: Room): void {
  if (!room.state) return;
  for (const [pid, seat] of room.seats) {
    if (!seat.ws) continue;
    const view = redactFor(room.state, pid);
    send(seat.ws, { t: "state", view });
  }
}

function sendStateTo(room: Room, playerId: PlayerId): void {
  if (!room.state) return;
  const seat = room.seats.get(playerId);
  if (!seat?.ws) return;
  send(seat.ws, { t: "state", view: redactFor(room.state, playerId) });
}

// ---- room lifecycle --------------------------------------------------------

function createRoom(roomId: string): Room {
  // Server chooses the rng seed so matches are deterministic + replayable from
  // (seed, intentLog). Never derived from anything the client supplies.
  const rngSeed = (Math.floor(randomSource() * 0x7fffffff) ^ Date.now()) >>> 0;
  return {
    id: roomId,
    seats: new Map(),
    state: null,
    cards: CARD_INDEX,
    rngSeed,
    intentLog: [],
  };
}

function startGame(room: Room): void {
  if (room.seats.size !== 2) return;

  const [a, b] = [...room.seats.entries()];
  const [idA, seatA] = a!;
  const [idB, seatB] = b!;

  room.state = createGame({
    gameId: room.id,
    cards: room.cards,
    rngSeed: room.rngSeed,
    players: [
      { id: idA, name: seatA.name, deck: seatA.deck },
      { id: idB, name: seatB.name, deck: seatB.deck },
    ],
  });

  broadcast(room, { t: "event", message: "Both players ready — game on." });
  broadcastState(room);
}

function handleJoinRoom(
  ws: WebSocket,
  requestedRoomId: string,
  playerName: string,
  deck: DeckList,
): void {
  const name = (playerName || "Player").trim();

  // Empty/blank roomId => "create room": mint a fresh code.
  const roomId = requestedRoomId.trim().toUpperCase() || mintRoomCode(randomSource);

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
    rooms.set(roomId, room);
  }

  // ---- Reconnect path: a seat with this name exists but is disconnected. ----
  for (const [pid, seat] of room.seats) {
    if (seat.name === name && !seat.connected) {
      seat.ws = ws;
      seat.connected = true;
      // Refresh deck only if no game in progress (deck is locked once dealt).
      if (!room.state) seat.deck = deck;
      wsToSeat.set(ws, { roomId, playerId: pid });
      send(ws, { t: "joined", roomId, youAre: pid });
      if (room.state) {
        send(ws, { t: "event", message: "Reconnected — resuming match." });
        sendStateTo(room, pid);
        broadcast(room, { t: "event", message: `${name} reconnected.` });
      } else {
        send(ws, { t: "event", message: `Waiting for opponent in room "${roomId}"...` });
      }
      return;
    }
  }

  if (room.seats.size >= 2) {
    send(ws, { t: "error", code: "ROOM_FULL", message: "Room is full (2 players max)." });
    return;
  }
  if (room.state) {
    send(ws, { t: "error", code: "GAME_STARTED", message: "Game already in progress." });
    return;
  }

  const playerId: PlayerId = room.seats.has("p1") ? "p2" : "p1";
  room.seats.set(playerId, { ws, name, deck, connected: true });
  wsToSeat.set(ws, { roomId, playerId });

  // Confirm the seat + code immediately so a "create room" client can show it.
  send(ws, { t: "joined", roomId, youAre: playerId });

  if (room.seats.size === 2) {
    startGame(room);
  } else {
    send(ws, { t: "event", message: `Waiting for opponent in room "${roomId}"...` });
  }
}

function handleIntent(ws: WebSocket, roomId: string, intent: Intent): void {
  const mapping = wsToSeat.get(ws);
  if (!mapping) {
    send(ws, { t: "error", code: "NOT_IN_ROOM", message: "You are not in a room." });
    return;
  }
  // The room the socket actually occupies is authoritative; ignore client roomId
  // if it disagrees (never trust client-supplied routing).
  const room = rooms.get(mapping.roomId);
  if (!room || !room.state) {
    send(ws, { t: "error", code: "NO_GAME", message: "No active game." });
    return;
  }

  // A client may only submit intents for its own seat.
  if (intent.player !== mapping.playerId) {
    send(ws, { t: "error", code: "WRONG_PLAYER", message: "Intent player mismatch." });
    return;
  }

  const result = applyIntent(room.state, intent, room.cards);
  if (result.error) {
    // Illegal intent: reject and DO NOT advance state.
    send(ws, { t: "error", code: result.error.code, message: result.error.message });
    return;
  }

  // Accept: advance authoritative state + append to replay log.
  room.state = result.state;
  room.intentLog.push(intent);

  for (const ev of result.events) {
    broadcast(room, { t: "event", message: ev.message });
  }

  broadcastState(room);

  if (room.state.winnerId) {
    broadcast(room, { t: "gameOver", winnerId: room.state.winnerId });
  }
}

function handleLeaveRoom(ws: WebSocket): void {
  const mapping = wsToSeat.get(ws);
  if (!mapping) return;
  wsToSeat.delete(ws);

  const room = rooms.get(mapping.roomId);
  if (!room) return;

  const seat = room.seats.get(mapping.playerId);

  if (room.state && !room.state.winnerId) {
    // Mid-game: keep the seat reserved for reconnect; just mark it disconnected.
    if (seat) {
      seat.ws = null;
      seat.connected = false;
    }
    broadcast(room, { t: "event", message: `${seat?.name ?? "A player"} disconnected — they can rejoin with the room code.` });
    return;
  }

  // Pre-game or finished: free the seat outright.
  room.seats.delete(mapping.playerId);
  if (room.seats.size === 0) {
    rooms.delete(room.id);
  } else {
    broadcast(room, { t: "event", message: "Opponent left the room." });
  }
}

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(ws, { t: "error", code: "PARSE_ERROR", message: "Invalid JSON." });
    return;
  }

  switch (msg.t) {
    case "joinRoom":
      handleJoinRoom(ws, msg.roomId, msg.playerName, msg.deck);
      break;
    case "intent":
      handleIntent(ws, msg.roomId, msg.intent);
      break;
    case "leaveRoom":
      handleLeaveRoom(ws);
      break;
    default:
      send(ws, { t: "error", code: "UNKNOWN_MESSAGE", message: "Unknown message type." });
  }
}

export interface RunningServer {
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the WS server. Pass port 0 for an ephemeral port (tests). Resolves once
 * the server is actually listening so callers know the real port.
 */
export function startServer(port = 3100): Promise<RunningServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port });

    wss.on("connection", (ws) => {
      ws.on("message", (data) => {
        if (typeof data === "string") handleMessage(ws, data);
        else if (Buffer.isBuffer(data)) handleMessage(ws, data.toString("utf-8"));
        else if (Array.isArray(data)) handleMessage(ws, Buffer.concat(data).toString("utf-8"));
      });
      ws.on("close", () => handleLeaveRoom(ws));
      ws.on("error", () => handleLeaveRoom(ws));
    });

    wss.on("listening", () => {
      const addr = wss.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      // eslint-disable-next-line no-console
      console.log(`[ew-server] WebSocket server listening on ws://localhost:${actualPort}`);
      resolve({
        wss,
        port: actualPort,
        close: () =>
          new Promise<void>((res, rej) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

/** Test/util hook: drop all rooms (does not affect open sockets). */
export function __resetRooms(): void {
  rooms.clear();
  wsToSeat.clear();
}

// Run directly (tsx src/server.ts). Guarded so importing for tests is side-effect free.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /server\.(ts|js)$/.test(process.argv[1] ?? "");

if (invokedDirectly) {
  const port = parseInt(process.env.PORT ?? "3100", 10);
  void startServer(port);
}
