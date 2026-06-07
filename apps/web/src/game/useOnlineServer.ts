import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMessage,
  DeckList,
  Intent,
  PlayerId,
  PlayerView,
  ServerMessage,
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
  events: string[];
  error: string | null;
  gameOver: PlayerId | null;
  /** Join (or create, with empty roomId) a room with a deck. */
  joinRoom: (roomId: string, playerName: string, deck: DeckList) => void;
  /** Submit an intent for the local player. */
  sendIntent: (intent: Intent) => void;
  /** Leave the current room. */
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
  const lastJoinRef = useRef<{ roomId: string; playerName: string; deck: DeckList } | null>(null);
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
      // Re-issue a pending join (covers reconnect after a transient drop).
      const pending = lastJoinRef.current;
      if (pending) {
        ws.send(
          JSON.stringify({
            t: "joinRoom",
            roomId: pending.roomId,
            playerName: pending.playerName,
            deck: pending.deck,
          } satisfies ClientMessage),
        );
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
    (roomId: string, playerName: string, deck: DeckList) => {
      lastJoinRef.current = { roomId, playerName, deck };
      setState((s) => ({ ...s, error: null }));
      rawSend({ t: "joinRoom", roomId, playerName, deck });
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
    const roomId = stateRoomIdRef.current ?? lastJoinRef.current?.roomId ?? "";
    rawSend({ t: "leaveRoom", roomId });
    lastJoinRef.current = null;
    setState((s) => ({ ...INITIAL, status: s.status }));
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
    events: state.events,
    error: state.error,
    gameOver: state.gameOver,
    joinRoom,
    sendIntent,
    leaveRoom,
    clearError,
  };
  return transport;
}

function reduceMessage(s: InternalState, msg: ServerMessage): InternalState {
  switch (msg.t) {
    case "joined":
      return { ...s, inRoom: true, roomId: msg.roomId, youAre: msg.youAre, error: null };
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
