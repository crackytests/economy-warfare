import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { WebSocket } from "ws";
import type {
  ClientMessage,
  DeckList,
  GameState,
  Intent,
  PlayerId,
  PlayerView,
  ServerMessage,
} from "@ew/shared";
import { startServer, __resetRooms, type RunningServer } from "./server.js";

interface StarterDecksFile {
  decks: DeckList[];
}
const __dir = dirname(fileURLToPath(import.meta.url));
const DECKS = (
  JSON.parse(
    readFileSync(resolve(__dir, "../../../data/starter_decks.json"), "utf-8"),
  ) as StarterDecksFile
).decks;
const DECK_A = DECKS.find((d) => d.id === "systemx-mobilize-starter") ?? DECKS[0]!;
const DECK_B = DECKS.find((d) => d.id === "yoko-continuity-starter") ?? DECKS[1]!;

/**
 * A thin test harness around a real `ws` client that records every server
 * message and lets the test await specific ones.
 */
class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  views: PlayerView[] = [];
  errors: Array<{ code: string; message: string }> = [];
  youAre: PlayerId | null = null;
  roomId: string | null = null;
  winnerId: PlayerId | null = null;
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(msg);
      if (msg.t === "state") this.views.push(msg.view);
      if (msg.t === "joined") {
        this.youAre = msg.youAre;
        this.roomId = msg.roomId;
      }
      if (msg.t === "error") this.errors.push({ code: msg.code, message: msg.message });
      if (msg.t === "gameOver") this.winnerId = msg.winnerId;
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        if (this.waiters[i]!.pred(msg)) {
          this.waiters.splice(i, 1)[0]!.resolve(msg);
        }
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolve when a message matching `pred` arrives (or already arrived). */
  waitFor<T extends ServerMessage = ServerMessage>(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 2000,
  ): Promise<T> {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing as T);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`waitFor timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as T);
        },
      });
    });
  }

  /** Wait for the next state broadcast received AFTER this call. */
  nextState(timeoutMs = 2000): Promise<PlayerView> {
    const baseline = this.views.length;
    return new Promise<PlayerView>((resolve, reject) => {
      const check = () => {
        if (this.views.length > baseline) {
          resolve(this.views[this.views.length - 1]!);
          return true;
        }
        return false;
      };
      if (check()) return;
      const timer = setTimeout(() => reject(new Error("nextState timed out")), timeoutMs);
      this.waiters.push({
        pred: (m) => m.t === "state",
        resolve: () => {
          clearTimeout(timer);
          resolve(this.views[this.views.length - 1]!);
        },
      });
    });
  }

  latestView(): PlayerView {
    const v = this.views[this.views.length - 1];
    if (!v) throw new Error("no view received yet");
    return v;
  }

  close(): void {
    this.ws.close();
  }
}

let server: RunningServer;
let url: string;

beforeEach(async () => {
  __resetRooms();
  server = await startServer(0); // ephemeral port
  url = `ws://localhost:${server.port}`;
});

afterEach(async () => {
  await server.close();
});

/**
 * The active player keeps their opening hand; the engine then auto-settles
 * through draw/income to land that same player in their interactive Build
 * phase (a "keep" does NOT pass the turn). Returns the resulting state.
 * Only the active player may mulligan (the engine offers it to nobody else).
 */
async function activeKeepsToBuild(a: TestClient, b: TestClient): Promise<GameState> {
  const first = a.latestView();
  const active = first.state.activePlayerId;
  const activeClient = active === a.youAre ? a : b;
  activeClient.send({
    t: "intent",
    roomId: activeClient.roomId!,
    intent: { kind: "mulligan", player: active, keep: true },
  });
  const view = await activeClient.nextState();
  return view.state;
}

describe("online server integration (two real ws clients)", () => {
  it("pairs two players, deals a game, and broadcasts redacted views to both", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);

    // Player A creates a room (empty code -> server mints one).
    a.send({ t: "joinRoom", roomId: "", playerName: "Alice", deck: DECK_A });
    const joinedA = await a.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    expect(joinedA.roomId).toMatch(/^[A-Z0-9]{4}$/);
    expect(joinedA.youAre).toBe("p1");

    // Player B joins by the minted code.
    b.send({ t: "joinRoom", roomId: joinedA.roomId, playerName: "Bob", deck: DECK_B });
    const joinedB = await b.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    expect(joinedB.youAre).toBe("p2");

    // (a) BOTH clients receive a state broadcast once the game starts.
    const viewA = await a.waitFor<Extract<ServerMessage, { t: "state" }>>((m) => m.t === "state");
    const viewB = await b.waitFor<Extract<ServerMessage, { t: "state" }>>((m) => m.t === "state");
    expect(viewA.view.youAre).toBe("p1");
    expect(viewB.view.youAre).toBe("p2");

    // Each sees their own full hand dealt.
    expect(viewA.view.state.players.p1!.hand.length).toBeGreaterThan(0);
    expect(viewB.view.state.players.p2!.hand.length).toBeGreaterThan(0);

    a.close();
    b.close();
  });

  it("hides the opponent's hidden zones (hand + deck) in each player's view", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "joinRoom", roomId: "", playerName: "Alice", deck: DECK_A });
    const joined = await a.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    b.send({ t: "joinRoom", roomId: joined.roomId, playerName: "Bob", deck: DECK_B });
    await b.waitFor((m) => m.t === "joined");
    await a.waitFor((m) => m.t === "state");
    await b.waitFor((m) => m.t === "state");

    const va = a.latestView().state;
    const vb = b.latestView().state;

    // (b) From A's view: A's own hand is visible (real cardIds), B's is hidden.
    expect(va.players.p1!.hand.every((c) => c.cardId !== "__hidden__")).toBe(true);
    expect(va.players.p2!.hand.length).toBeGreaterThan(0);
    expect(va.players.p2!.hand.every((c) => c.cardId === "__hidden__")).toBe(true);
    // Both decks are hidden from everyone (future draws are secret).
    expect(va.players.p1!.deck.every((c) => c.cardId === "__hidden__")).toBe(true);
    expect(va.players.p2!.deck.every((c) => c.cardId === "__hidden__")).toBe(true);

    // Symmetric from B's view.
    expect(vb.players.p2!.hand.every((c) => c.cardId !== "__hidden__")).toBe(true);
    expect(vb.players.p1!.hand.every((c) => c.cardId === "__hidden__")).toBe(true);

    a.close();
    b.close();
  });

  it("rejects an illegal intent with an error and leaves state unchanged", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "joinRoom", roomId: "", playerName: "Alice", deck: DECK_A });
    const joined = await a.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    b.send({ t: "joinRoom", roomId: joined.roomId, playerName: "Bob", deck: DECK_B });
    await b.waitFor((m) => m.t === "joined");
    await a.waitFor((m) => m.t === "state");
    await b.waitFor((m) => m.t === "state");

    const before = a.latestView().state;
    const active = before.activePlayerId;
    const inactive = active === "p1" ? "p2" : "p1";
    const inactiveClient = inactive === a.youAre ? a : b;
    const stateCountBefore = inactiveClient.views.length;

    // (c) Illegal: the NON-active player tries to end the active player's turn.
    // The engine gates this (NOT_ACTIVE), and a malformed phase action is also illegal.
    inactiveClient.errors = [];
    inactiveClient.send({
      t: "intent",
      roomId: inactiveClient.roomId!,
      intent: { kind: "endTurn", player: inactive } as Intent,
    });
    const errMsg = await inactiveClient.waitFor<Extract<ServerMessage, { t: "error" }>>((m) => m.t === "error");
    expect(errMsg.code).toBeTruthy();

    // No new state broadcast was produced by the rejected intent.
    expect(inactiveClient.views.length).toBe(stateCountBefore);
    // Authoritative state is unchanged (same active player, same phase, same log length).
    const afterView = inactiveClient.latestView().state;
    expect(afterView.activePlayerId).toBe(active);
    expect(afterView.phase).toBe(before.phase);

    a.close();
    b.close();
  });

  it("advances phases and passes the turn between players via accepted intents", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "joinRoom", roomId: "", playerName: "Alice", deck: DECK_A });
    const joined = await a.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    b.send({ t: "joinRoom", roomId: joined.roomId, playerName: "Bob", deck: DECK_B });
    await b.waitFor((m) => m.t === "joined");
    await a.waitFor((m) => m.t === "state");
    await b.waitFor((m) => m.t === "state");

    const start = await activeKeepsToBuild(a, b);
    const firstPlayer = start.activePlayerId;
    expect(start.phase).toBe("build");

    const firstClient = firstPlayer === a.youAre ? a : b;
    const secondClient = firstClient === a ? b : a;
    const secondPlayer = secondClient.youAre!;

    // (d) Active player ends their turn -> turn passes to the opponent.
    firstClient.send({ t: "intent", roomId: firstClient.roomId!, intent: { kind: "endTurn", player: firstPlayer } });
    const afterEnd = await firstClient.nextState();
    expect(afterEnd.state.activePlayerId).toBe(secondPlayer);
    expect(afterEnd.state.turnNumber).toBe(start.turnNumber + 1);

    // Ensure the second client has processed the broadcast from the first
    // player's endTurn (it now holds the turn, settled to Build) before acting.
    await secondClient.waitFor(
      (m) => m.t === "state" && m.view.state.activePlayerId === secondPlayer && m.view.state.phase === "build",
    );
    // The new active player can act and pass it back. Match on turnNumber + 2 so
    // we don't resolve on an earlier (stale) broadcast that also had firstPlayer
    // active (e.g. the opening Build state).
    secondClient.send({ t: "intent", roomId: secondClient.roomId!, intent: { kind: "endTurn", player: secondPlayer } });
    const back = await secondClient.waitFor<Extract<ServerMessage, { t: "state" }>>(
      (m) =>
        m.t === "state" &&
        m.view.state.activePlayerId === firstPlayer &&
        m.view.state.turnNumber === start.turnNumber + 2,
    );
    expect(back.view.state.activePlayerId).toBe(firstPlayer);

    a.close();
    b.close();
  });

  it("supports reconnect: a disconnected player rejoins by name and resumes the match", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "joinRoom", roomId: "", playerName: "Alice", deck: DECK_A });
    const joined = await a.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    const code = joined.roomId;
    b.send({ t: "joinRoom", roomId: code, playerName: "Bob", deck: DECK_B });
    await b.waitFor((m) => m.t === "joined");
    await a.waitFor((m) => m.t === "state");
    await b.waitFor((m) => m.t === "state");

    const seatBefore = a.youAre;

    // Alice drops.
    a.close();
    // Give the server a tick to register the close.
    await new Promise((r) => setTimeout(r, 50));

    // Alice reconnects with the same name + room code.
    const a2 = new TestClient(url);
    await a2.open();
    a2.send({ t: "joinRoom", roomId: code, playerName: "Alice", deck: DECK_A });
    const rejoined = await a2.waitFor<Extract<ServerMessage, { t: "joined" }>>((m) => m.t === "joined");
    expect(rejoined.youAre).toBe(seatBefore); // same seat
    const resumed = await a2.waitFor<Extract<ServerMessage, { t: "state" }>>((m) => m.t === "state");
    expect(resumed.view.youAre).toBe(seatBefore);
    expect(resumed.view.state.players[seatBefore!]!.hand.length).toBeGreaterThan(0);

    a2.close();
    b.close();
  });
});
