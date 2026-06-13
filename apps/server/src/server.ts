import { WebSocketServer, WebSocket } from "ws";
import {
  applyIntent,
  buildCardIndex,
  createGame,
  redactFor,
  redactForSpectator,
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
  TableInfo,
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
  /** Non-seated watchers receiving redacted spectator views. */
  spectators: Set<WebSocket>;
  /** Private rooms are reachable by code but never listed in the public lobby. */
  isPrivate: boolean;
  state: GameState | null;
  cards: CardIndex;
  rngSeed: number;
  /** Ordered, replay-ready log of every accepted intent. */
  intentLog: Intent[];
}

const rooms = new Map<string, Room>();
/** Reverse index: which (room, seat) a given socket currently occupies. */
const wsToSeat = new Map<WebSocket, { roomId: string; playerId: PlayerId }>();
/** Sockets currently watching a room as spectators (room id per socket). */
const wsToSpectatedRoom = new Map<WebSocket, string>();
/** Sockets subscribed to browsable-lobby pushes (in the lobby, not yet in a game). */
const lobbySubscribers = new Set<WebSocket>();

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

/** Send a non-state message to everyone watching the room (seats + spectators). */
function broadcast(room: Room, msg: ServerMessage): void {
  for (const seat of room.seats.values()) {
    send(seat.ws, msg);
  }
  for (const ws of room.spectators) {
    send(ws, msg);
  }
}

function broadcastState(room: Room): void {
  if (!room.state) return;
  const watching = room.spectators.size;
  for (const [pid, seat] of room.seats) {
    if (!seat.ws) continue;
    const view = redactFor(room.state, pid);
    send(seat.ws, { t: "state", view: { ...view, spectators: watching } });
  }
  if (watching > 0) {
    const view = redactForSpectator(room.state);
    for (const ws of room.spectators) send(ws, { t: "state", view: { ...view, spectators: watching } });
  }
}

// ---- lobby (browsable rooms) ----------------------------------------------

function tableStatus(room: Room): TableInfo["status"] {
  if (room.state?.winnerId) return "over";
  if (room.state) return "live";
  return room.seats.size >= 1 ? "waiting" : "open";
}

/** Snapshot of all PUBLIC rooms for the browsable lobby. */
function buildLobby(): TableInfo[] {
  const tables: TableInfo[] = [];
  for (const room of rooms.values()) {
    if (room.isPrivate) continue;
    tables.push({
      code: room.id,
      seats: {
        p1: room.seats.get("p1")?.name ?? null,
        p2: room.seats.get("p2")?.name ?? null,
      },
      status: tableStatus(room),
      spectators: room.spectators.size,
    });
  }
  return tables;
}

function broadcastLobby(): void {
  if (lobbySubscribers.size === 0) return;
  const msg: ServerMessage = { t: "lobby", tables: buildLobby() };
  for (const ws of lobbySubscribers) send(ws, msg);
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
    spectators: new Set(),
    isPrivate: false,
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
  broadcastLobby(); // status flips to "live"
}

function handleJoinRoom(
  ws: WebSocket,
  requestedRoomId: string,
  playerName: string,
  deck: DeckList,
  preferredSeat?: PlayerId,
  isPrivate = false,
): void {
  const name = (playerName || "Player").trim();

  // Empty/blank roomId => "create room": mint a fresh code.
  const minting = requestedRoomId.trim() === "";
  const roomId = requestedRoomId.trim().toUpperCase() || mintRoomCode(randomSource);

  let room = rooms.get(roomId);
  if (!room) {
    room = createRoom(roomId);
    // Privacy is fixed at creation; only the minting client may request it.
    room.isPrivate = minting && isPrivate;
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
    send(ws, { t: "error", code: "GAME_STARTED", message: "Game already in progress. Spectate instead." });
    return;
  }

  // Honor the requested seat side if it's free; otherwise take the open one.
  const playerId: PlayerId =
    preferredSeat && !room.seats.has(preferredSeat)
      ? preferredSeat
      : room.seats.has("p1")
        ? "p2"
        : "p1";
  room.seats.set(playerId, { ws, name, deck, connected: true });
  wsToSeat.set(ws, { roomId, playerId });

  // Confirm the seat + code immediately so a "create room" client can show it.
  send(ws, { t: "joined", roomId, youAre: playerId });

  if (room.seats.size === 2) {
    startGame(room);
  } else {
    send(ws, { t: "event", message: `Waiting for opponent in room "${roomId}"...` });
  }
  broadcastLobby();
}

function handleSpectateRoom(ws: WebSocket, requestedRoomId: string): void {
  const roomId = requestedRoomId.trim().toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    send(ws, { t: "error", code: "NO_ROOM", message: "No such room." });
    return;
  }
  room.spectators.add(ws);
  wsToSpectatedRoom.set(ws, roomId);
  send(ws, { t: "spectating", roomId });
  if (room.state) {
    // Re-broadcast to everyone so the new watcher gets state and seats + existing
    // spectators see the updated spectator count.
    broadcastState(room);
  } else {
    send(ws, { t: "event", message: `Watching room "${roomId}" — waiting for the game to start.` });
  }
  broadcastLobby(); // spectator count changed
}

function handleListLobby(ws: WebSocket): void {
  lobbySubscribers.add(ws);
  send(ws, { t: "lobby", tables: buildLobby() });
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
    broadcastLobby(); // status flips to "over"
  }
}

function handleLeaveRoom(ws: WebSocket): void {
  // Spectator leaving: just stop watching; never touches seats or game state.
  const spectatedRoomId = wsToSpectatedRoom.get(ws);
  if (spectatedRoomId) {
    wsToSpectatedRoom.delete(ws);
    const room = rooms.get(spectatedRoomId);
    if (room) {
      room.spectators.delete(ws);
      // A spectated room with no seats left and no watchers can be reclaimed.
      if (room.seats.size === 0 && room.spectators.size === 0) {
        rooms.delete(room.id);
      } else {
        broadcastState(room); // remaining viewers see the decremented count
      }
      broadcastLobby(); // spectator count changed
    }
    return;
  }

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
  if (room.seats.size === 0 && room.spectators.size === 0) {
    rooms.delete(room.id);
  } else {
    broadcast(room, { t: "event", message: "Opponent left the room." });
  }
  broadcastLobby();
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
      handleJoinRoom(ws, msg.roomId, msg.playerName, msg.deck, msg.seat, msg.private);
      break;
    case "spectateRoom":
      handleSpectateRoom(ws, msg.roomId);
      break;
    case "listLobby":
      handleListLobby(ws);
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

/** Full teardown when a socket drops: unsubscribe lobby, stop spectating, free seat. */
function handleDisconnect(ws: WebSocket): void {
  lobbySubscribers.delete(ws);
  handleLeaveRoom(ws);
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
      ws.on("close", () => handleDisconnect(ws));
      ws.on("error", () => handleDisconnect(ws));
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
  wsToSpectatedRoom.clear();
  lobbySubscribers.clear();
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
