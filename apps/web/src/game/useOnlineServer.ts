import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  DeckList,
  Intent,
  PlayerId,
  PlayerView,
  ServerMessage,
  TableInfo,
} from "@ew/shared";

export type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface OnlineTransport {
  /** WS lifecycle. */
  status: ConnectionStatus;
  connected: boolean;
  /** Effective WebSocket URL used by the lobby. */
  serverUrl: string;
  /** Latest authoritative redacted view from the server. */
  view: PlayerView | null;
  /** Which seat this client occupies ("p1"/"p2"), once joined. */
  youAre: PlayerId | null;
  /** Room code in effect (server may MINT one when joining with an empty code). */
  roomId: string | null;
  /** True once a `joined` confirmation arrives but before the game starts. */
  inRoom: boolean;
  /** True once the first state broadcast (game start) has arrived. */
  gameStarted: boolean;
  /** True when watching a room as a non-seated spectator. */
  spectating: boolean;
  /** Browsable lobby snapshot (public tables), pushed by the server. */
  tables: TableInfo[];
  events: string[];
  error: string | null;
  gameOver: PlayerId | null;
  /** Join (or create, with empty roomId) a room with a deck. Optional seat side / private. */
  joinRoom: (roomId: string, playerName: string, deck: DeckList, opts?: { seat?: PlayerId; private?: boolean }) => void;
  /** Watch a room as a spectator (no seat). */
  spectateRoom: (roomId: string) => void;
  /** Submit an intent for the local player. */
  sendIntent: (intent: Intent) => void;
  /** Leave the current room (or stop spectating) and return to the lobby. */
  leaveRoom: () => void;
  /** Clear the current error banner. */
  clearError: () => void;
}

/**
 * Resolve the WebSocket server URL. Precedence:
 *   1. `?server=` query param (handy for the iframe host / quick testing)
 *   2. `VITE_WS_URL` build/env var
 *   3. Local dev: ws://<current host>:3100
 *   4. Deployed pages: same-origin /ew-ws/ reverse proxy
 */
export function resolveServerUrl(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("server");
    if (fromQuery) return toWebSocketUrl(fromQuery);
  }
  const fromEnv = import.meta.env?.VITE_WS_URL as string | undefined;
  if (fromEnv) return toWebSocketUrl(fromEnv);
  if (typeof window === "undefined") return "ws://localhost:3100";

  const host = window.location.hostname || "localhost";
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost");
  if (isLocal) return `ws://${host}:3100`;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ew-ws/`;
}

function toWebSocketUrl(value: string): string {
  if (value.startsWith("https://")) return `wss://${value.slice("https://".length)}`;
  if (value.startsWith("http://")) return `ws://${value.slice("http://".length)}`;
  if (value.startsWith("/") && typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${value}`;
  }
  return value;
}

function offlineMessage(url: string): string {
  return `Online server is not reachable at ${url}. Start it with npm run dev:server, then try again.`;
}

interface InternalState {
  status: ConnectionStatus;
  view: PlayerView | null;
  youAre: PlayerId | null;
  roomId: string | null;
  inRoom: boolean;
  gameStarted: boolean;
  spectating: boolean;
  tables: TableInfo[];
  events: string[];
  error: string | null;
  gameOver: PlayerId | null;
}

const INITIAL: InternalState = {
  status: "idle",
  view: null,
  youAre: null,
  roomId: null,
  inRoom: false,
  gameStarted: false,
  spectating: false,
  tables: [],
  events: [],
  error: null,
  gameOver: null,
};

/**
 * Online transport hook. Opens a WS connection (lazily — only once the caller
 * is ready to connect, signalled by `enabled`) and exposes a small imperative
 * API for the lobby + board. The server is authoritative; this hook never
 * mutates game state, it only relays Intents and renders the redacted views.
 */
export function useOnlineServer(enabled: boolean, url: string = resolveServerUrl()) {
  const wsRef = useRef<WebSocket | null>(null);
  // Remember the last join request so we can re-issue it on reconnect.
  const lastJoinRef = useRef<{ roomId: string; playerName: string; deck: DeckList; seat?: PlayerId; private?: boolean } | null>(null);
  // Remember a spectated room so a transient reconnect re-attaches the watcher.
  const lastSpectateRef = useRef<string | null>(null);
  const [state, setState] = useState<InternalState>(INITIAL);

  const rawSend = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let opened = false;
    setState((s) => ({ ...s, status: "connecting", error: null }));
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      if (cancelled) return;
      opened = true;
      setState((s) => ({ ...s, status: "open", error: null }));
      // Subscribe to the browsable lobby as soon as we connect.
      ws.send(JSON.stringify({ t: "listLobby" } satisfies ClientMessage));
      // Re-issue a pending join (covers reconnect after a transient drop).
      const pending = lastJoinRef.current;
      if (pending) {
        ws.send(
          JSON.stringify({
            t: "joinRoom",
            roomId: pending.roomId,
            playerName: pending.playerName,
            deck: pending.deck,
            seat: pending.seat,
            private: pending.private,
          } satisfies ClientMessage),
        );
      } else if (lastSpectateRef.current) {
        ws.send(JSON.stringify({ t: "spectateRoom", roomId: lastSpectateRef.current } satisfies ClientMessage));
      }
    });

    ws.addEventListener("close", () => {
      if (cancelled) return;
      setState((s) => ({
        ...s,
        status: "closed",
        error: opened ? s.error : offlineMessage(url),
      }));
    });

    ws.addEventListener("error", () => {
      if (cancelled) return;
      setState((s) => ({ ...s, status: "error", error: s.error ?? offlineMessage(url) }));
    });

    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      setState((s) => reduceMessage(s, msg));
    });

    return () => {
      cancelled = true;
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [enabled, url]);

  const joinRoom = useCallback(
    (roomId: string, playerName: string, deck: DeckList, opts?: { seat?: PlayerId; private?: boolean }) => {
      lastSpectateRef.current = null;
      lastJoinRef.current = { roomId, playerName, deck, seat: opts?.seat, private: opts?.private };
      setState((s) => ({ ...s, error: null }));
      rawSend({ t: "joinRoom", roomId, playerName, deck, seat: opts?.seat, private: opts?.private });
    },
    [rawSend],
  );

  const spectateRoom = useCallback(
    (roomId: string) => {
      lastJoinRef.current = null;
      lastSpectateRef.current = roomId;
      setState((s) => ({ ...s, error: null, spectating: true }));
      rawSend({ t: "spectateRoom", roomId });
    },
    [rawSend],
  );

  const sendIntent = useCallback(
    (intent: Intent) => {
      const roomId = lastJoinRef.current?.roomId;
      // Server routes by the socket's seat, so roomId here is advisory; send the
      // effective room code if we have one.
      rawSend({ t: "intent", roomId: stateRoomIdRef.current ?? roomId ?? "", intent });
    },
    [rawSend],
  );

  const leaveRoom = useCallback(() => {
    const roomId = stateRoomIdRef.current ?? lastSpectateRef.current ?? lastJoinRef.current?.roomId ?? "";
    rawSend({ t: "leaveRoom", roomId });
    lastJoinRef.current = null;
    lastSpectateRef.current = null;
    // Return to the lobby: clear the game/spectator fields, keep the connection,
    // and re-request a fresh lobby snapshot (we stay subscribed server-side).
    setState((s) => ({ ...INITIAL, status: s.status, tables: s.tables }));
    rawSend({ t: "listLobby" });
  }, [rawSend]);

  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  // Keep a ref of the live room code so sendIntent/leaveRoom use the minted code.
  const stateRoomIdRef = useRef<string | null>(null);
  stateRoomIdRef.current = state.roomId;

  const transport: OnlineTransport = {
    status: state.status,
    connected: state.status === "open",
    serverUrl: url,
    view: state.view,
    youAre: state.youAre,
    roomId: state.roomId,
    inRoom: state.inRoom,
    gameStarted: state.gameStarted,
    spectating: state.spectating,
    tables: state.tables,
    events: state.events,
    error: state.error,
    gameOver: state.gameOver,
    joinRoom,
    spectateRoom,
    sendIntent,
    leaveRoom,
    clearError,
  };
  return transport;
}

function reduceMessage(s: InternalState, msg: ServerMessage): InternalState {
  switch (msg.t) {
    case "joined":
      return { ...s, inRoom: true, spectating: false, roomId: msg.roomId, youAre: msg.youAre, error: null };
    case "spectating":
      return { ...s, spectating: true, roomId: msg.roomId, error: null };
    case "lobby":
      return { ...s, tables: msg.tables };
    case "state":
      return { ...s, view: msg.view, gameStarted: true, youAre: msg.view.youAre };
    case "event":
      return { ...s, events: [...s.events.slice(-49), msg.message] };
    case "error":
      return { ...s, error: msg.message };
    case "gameOver":
      return { ...s, gameOver: msg.winnerId };
    default:
      return s;
  }
}
