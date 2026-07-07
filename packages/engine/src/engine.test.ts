/**
 * WS1 engine-core unit tests (Vitest).
 *
 * Covers: setup/createGame, draw, income generation (incl. Governor-less
 * baseline), cost payment & money floor, recycle/resale once-per-turn, move
 * once-per-turn, deck validation, and the loss condition.
 *
 * Combat + card-specific effects are exercised in the "combat and effects"
 * block below and, more broadly, in mechanics.test.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyIntent,
  buildCardIndex,
  checkLoss,
  createGame,
  getLegalAttackTargets,
  getLegalIntents,
  redactFor,
  validateDeck,
  type CardIndex,
  type NewGameOptions,
} from "./index";
import { loadCardIndex, starterDeck } from "./cards";
import type { DeckList, GameState, Intent, PlayerId } from "@ew/shared";
import { SETUP } from "@ew/shared";
import { totalIncome, loseMoney, payCost, clampCost } from "./economy";
import { Rng } from "./rng";

let cards: CardIndex;

beforeEach(() => {
  cards = loadCardIndex();
});

const P1 = "p1";
const P2 = "p2";

function newGame(opts?: Partial<NewGameOptions>): GameState {
  const base: NewGameOptions = {
    gameId: "g1",
    cards,
    rngSeed: 12345,
    players: [
      { id: P1, name: "Alice", deck: starterDeck("systemx-mobilize-starter") },
      { id: P2, name: "Bob", deck: starterDeck("yoko-continuity-starter") },
    ],
    startingPlayerId: P1,
    ...opts,
  };
  return createGame(base);
}

// --------------------------------------------------------------------------
describe("buildCardIndex", () => {
  it("indexes all cards by id", () => {
    expect(cards.all.length).toBeGreaterThan(40);
    expect(cards.byId.get("data-yoko")?.name).toBe("Data Yoko");
  });
  it("throws on duplicate ids", () => {
    const dup = cards.all[0]!;
    expect(() => buildCardIndex([dup, dup])).toThrow(/duplicate/i);
  });
});

// --------------------------------------------------------------------------
describe("validateDeck", () => {
  it("accepts the starter decks (40 cards, <=4 copies)", () => {
    for (const id of [
      "yoko-continuity-starter",
      "spooky-reboot-starter",
      "linda-parallel-starter",
      "systemx-mobilize-starter",
    ]) {
      const res = validateDeck(starterDeck(id), cards);
      expect(res.ok, `${id}: ${res.reasons.join("; ")}`).toBe(true);
    }
  });

  it("rejects wrong size", () => {
    const deck: DeckList = { id: "d", name: "d", faction: "Neutral", cards: [{ id: "data-yoko", count: 4 }] };
    const res = validateDeck(deck, cards);
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/40 cards/);
  });

  it("rejects >4 copies", () => {
    const deck: DeckList = {
      id: "d",
      name: "d",
      faction: "Neutral",
      cards: [{ id: "data-yoko", count: 5 }, { id: "analyst-yoko", count: 35 }],
    };
    const res = validateDeck(deck, cards);
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/Too many copies of "data-yoko"/);
  });

  it("rejects unknown ids", () => {
    const deck: DeckList = {
      id: "d",
      name: "d",
      faction: "Neutral",
      cards: [{ id: "data-yoko", count: 4 }, { id: "not-a-card", count: 36 }],
    };
    const res = validateDeck(deck, cards);
    expect(res.ok).toBe(false);
    expect(res.reasons.join(" ")).toMatch(/Unknown card id "not-a-card"/);
  });
});

// --------------------------------------------------------------------------
describe("createGame / setup", () => {
  it("deals 5-card hands, 35-card decks, and the starting money", () => {
    const g = newGame();
    for (const pid of [P1, P2]) {
      const p = g.players[pid]!;
      expect(p.hand.length).toBe(5);
      expect(p.deck.length).toBe(35);
      expect(p.money).toBe(SETUP.startingMoney);
      expect(p.hasTakenFirstTurn).toBe(false);
      expect(p.frontRow).toEqual([]);
      expect(p.backRow).toEqual([]);
    }
  });

  it("honors an explicit starting player", () => {
    expect(newGame({ startingPlayerId: P2 }).activePlayerId).toBe(P2);
  });

  it("is deterministic for a given seed", () => {
    const a = newGame({ startingPlayerId: undefined, rngSeed: 99 });
    const b = newGame({ startingPlayerId: undefined, rngSeed: 99 });
    expect(a.players[P1]!.hand.map((c) => c.cardId)).toEqual(b.players[P1]!.hand.map((c) => c.cardId));
    expect(a.activePlayerId).toBe(b.activePlayerId);
  });

  it("gives each instance a unique id", () => {
    const g = newGame();
    const ids = new Set<string>();
    for (const pid of [P1, P2]) {
      const p = g.players[pid]!;
      for (const c of [...p.deck, ...p.hand]) {
        expect(ids.has(c.instanceId)).toBe(false);
        ids.add(c.instanceId);
      }
    }
  });

  it("throws on a deck referencing an unknown card", () => {
    const bad: DeckList = { id: "x", name: "x", faction: "Neutral", cards: [{ id: "nope", count: 40 }] };
    expect(() =>
      createGame({
        gameId: "g",
        cards,
        rngSeed: 1,
        players: [
          { id: P1, name: "A", deck: bad },
          { id: P2, name: "B", deck: starterDeck("systemx-mobilize-starter") },
        ],
      }),
    ).toThrow(/unknown card/i);
  });
});

/**
 * Bootstrap helper: the server runs the automatic phases (start/draw/income)
 * right after createGame to land the first player on their Build phase. Tests
 * reproduce that with the engine's settleToInteractive. A fresh game sits at
 * "start"; mulligan is the only start-phase intent, so settling advances
 * through draw + income to build.
 */
import { settleToInteractive } from "./reducer";
function forceSettle(s: GameState): GameState {
  const clone: GameState = JSON.parse(JSON.stringify(s));
  settleToInteractive(clone, cards);
  return clone;
}

// --------------------------------------------------------------------------
describe("phase machine + draw", () => {
  it("settles a fresh game's first player to the Build phase having drawn", () => {
    const s = forceSettle(newGame());
    expect(s.phase).toBe("build");
    expect(s.activePlayerId).toBe(P1);
    // P1 drew their draw-phase card: opening 5 -> 6.
    expect(s.players[P1]!.hand.length).toBe(6);
  });

  it("rejects endTurn from a non-interactive (start) phase", () => {
    const g = newGame(); // phase "start"
    const bad = applyIntent(g, { kind: "endTurn", player: P1 }, cards);
    expect(bad.error?.code).toBe("BAD_PHASE");
  });

  it("endTurn from build runs income for the opponent and lands them in build", () => {
    const s = forceSettle(newGame());
    const r = applyIntent(s, { kind: "endTurn", player: P1 }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.activePlayerId).toBe(P2);
    expect(r.state.phase).toBe("build");
    // P2 drew its draw-phase card: hand 5 -> 6.
    expect(r.state.players[P2]!.hand.length).toBe(6);
    // P1 is now marked as having taken their first turn.
    expect(r.state.players[P1]!.hasTakenFirstTurn).toBe(true);
  });

  it("advancePhase walks build -> combat, then end passes the turn", () => {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "advancePhase", player: P1 }, cards).state;
    expect(s.phase).toBe("combat");
    s = applyIntent(s, { kind: "advancePhase", player: P1 }, cards).state;
    // From combat, advancePhase runs end + passes the turn, settling P2 to build.
    expect(s.activePlayerId).toBe(P2);
    expect(s.phase).toBe("build");
  });
});

// --------------------------------------------------------------------------
describe("income (baseline, Governor-less)", () => {
  it("counts only back-row Characters/Locations with income > 0", () => {
    const g = newGame();
    const p = g.players[P1]!;
    // Hand-place income sources directly for a deterministic unit test.
    const inst = (cardId: string, row: "front" | "back") => {
      const c = makeInstance(p.id, cardId);
      c.row = row;
      return c;
    };
    p.backRow = [
      inst("assembly-worker-x", "back"), // Character income 1
      inst("strategic-reserve", "back"), // Location income 1
      inst("armor-platoon-x", "back"), // Character income 0 -> excluded
    ];
    p.frontRow = [inst("data-yoko", "front")]; // front row income excluded
    expect(totalIncome(g, p.id, cards)).toBe(2);
  });

  it("exhausted back-row income sources still earn (baseline)", () => {
    const g = newGame();
    const p = g.players[P1]!;
    const c = makeInstance(p.id, "assembly-worker-x");
    c.row = "back";
    c.exhausted = true;
    p.backRow = [c];
    expect(totalIncome(g, p.id, cards)).toBe(1);
  });

  it("runs the Income phase and adds money during a turn", () => {
    let s = forceSettle(newGame()); // P1 at build, starting money (no income sources yet)
    expect(s.players[P1]!.money).toBe(SETUP.startingMoney);
    // P1 plays an income card to back row next turn; for now end turn to P2,
    // then back to P1 whose income phase should add 0 (still no back row).
    const moneyBefore = s.players[P1]!.money;
    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state; // -> P2 build
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 build again
    // No income sources => money unchanged by income (P1 drew, played nothing).
    expect(s.players[P1]!.money).toBe(moneyBefore);
  });
});

// --------------------------------------------------------------------------
describe("cost payment & money floor", () => {
  it("clampCost never goes below 0", () => {
    expect(clampCost(-3)).toBe(0);
    expect(clampCost(2)).toBe(2);
  });

  it("payCost deducts and refuses when unaffordable", () => {
    const p = { money: 3 } as any;
    expect(payCost(p, 2)).toBe(true);
    expect(p.money).toBe(1);
    expect(payCost(p, 5)).toBe(false);
    expect(p.money).toBe(1);
  });

  it("loseMoney floors at 0 and returns the amount actually lost", () => {
    const p = { money: 2 } as any;
    expect(loseMoney(p, 5)).toBe(2);
    expect(p.money).toBe(0);
  });

  it("playCard pays the cost and rejects when too expensive", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    // Give P1 a known affordable + a too-expensive card in hand.
    const cheap = makeInstance(P1, "data-yoko"); // cost 2
    const pricey = makeInstance(P1, "endless-linda"); // cost 6
    p.hand = [cheap, pricey];
    p.money = 3;

    const r1 = applyIntent(s, { kind: "playCard", player: P1, instanceId: pricey.instanceId }, cards);
    expect(r1.error?.code).toBe("CANT_AFFORD");

    const r2 = applyIntent(s, { kind: "playCard", player: P1, instanceId: cheap.instanceId }, cards);
    expect(r2.error).toBeUndefined();
    expect(r2.state.players[P1]!.money).toBe(1);
    expect(r2.state.players[P1]!.frontRow.some((c) => c.instanceId === cheap.instanceId)).toBe(true);
  });

  it("places by type: Location->back, Ongoing->ongoing, Action->discard", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const loc = makeInstance(P1, "strategic-reserve"); // Location, cost 3
    const ong = makeInstance(P1, "predictive-shielding"); // Ongoing, cost 2
    const act = makeInstance(P1, "emergency-funding"); // Action, cost 1
    p.hand = [loc, ong, act];
    p.money = 10;

    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: loc.instanceId }, cards).state;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: ong.instanceId }, cards).state;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: act.instanceId }, cards).state;

    const pp = s.players[P1]!;
    expect(pp.backRow.some((c) => c.cardId === "strategic-reserve")).toBe(true);
    expect(pp.ongoing.some((c) => c.cardId === "predictive-shielding")).toBe(true);
    expect(pp.discard.some((c) => c.cardId === "emergency-funding")).toBe(true);
  });

  it("Data Relay Station enters exhausted (structural flag)", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const drs = makeInstance(P1, "data-relay-station");
    p.hand = [drs];
    p.money = 10;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: drs.instanceId }, cards).state;
    const placed = s.players[P1]!.backRow.find((c) => c.cardId === "data-relay-station")!;
    expect(placed.exhausted).toBe(true);
  });
});

// --------------------------------------------------------------------------
describe("recycle / resale once-per-turn", () => {
  it("recycle: discard 1, pay 1, draw 1; then blocked for the turn", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const handBefore = p.hand.length;
    const moneyBefore = p.money;
    const target = p.hand[0]!;
    const r = applyIntent(s, { kind: "recycle", player: P1, discardInstanceId: target.instanceId }, cards);
    expect(r.error).toBeUndefined();
    const pp = r.state.players[P1]!;
    expect(pp.money).toBe(moneyBefore - 1);
    expect(pp.hand.length).toBe(handBefore); // -1 discard +1 draw
    expect(pp.discard.some((c) => c.instanceId === target.instanceId)).toBe(true);
    expect(pp.usedRecycleOrResaleThisTurn).toBe(true);
    // Second recycle/resale is rejected.
    const again = applyIntent(r.state, { kind: "resale", player: P1, discardInstanceId: pp.hand[0]!.instanceId }, cards);
    expect(again.error?.code).toBe("RECYCLE_USED");
  });

  it("resale: discard 1, gain 1; then blocked", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const moneyBefore = p.money;
    const target = p.hand[0]!;
    const r = applyIntent(s, { kind: "resale", player: P1, discardInstanceId: target.instanceId }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P1]!.money).toBe(moneyBefore + 1);
    const again = applyIntent(r.state, { kind: "recycle", player: P1, discardInstanceId: r.state.players[P1]!.hand[0]!.instanceId }, cards);
    expect(again.error?.code).toBe("RECYCLE_USED");
  });

  it("recycle requires 1 money", () => {
    let s = forceSettle(newGame());
    s.players[P1]!.money = 0;
    const r = applyIntent(s, { kind: "recycle", player: P1, discardInstanceId: s.players[P1]!.hand[0]!.instanceId }, cards);
    expect(r.error?.code).toBe("CANT_AFFORD");
  });

  it("flags reset on the player's next turn", () => {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "resale", player: P1, discardInstanceId: s.players[P1]!.hand[0]!.instanceId }, cards).state;
    expect(s.players[P1]!.usedRecycleOrResaleThisTurn).toBe(true);
    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state; // -> P2
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 again
    expect(s.players[P1]!.usedRecycleOrResaleThisTurn).toBe(false);
  });
});

// --------------------------------------------------------------------------
describe("move once-per-turn", () => {
  it("moves a non-Vehicle character and blocks a second move", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const c1 = makeInstance(P1, "data-yoko");
    c1.row = "front";
    const c2 = makeInstance(P1, "assembly-worker-x");
    c2.row = "front";
    p.frontRow = [c1, c2];

    const r = applyIntent(s, { kind: "moveCharacter", player: P1, instanceId: c1.instanceId, toRow: "back" }, cards);
    expect(r.error).toBeUndefined();
    const pp = r.state.players[P1]!;
    expect(pp.backRow.some((c) => c.instanceId === c1.instanceId)).toBe(true);
    expect(pp.usedMoveThisTurn).toBe(true);

    const again = applyIntent(r.state, { kind: "moveCharacter", player: P1, instanceId: c2.instanceId, toRow: "back" }, cards);
    expect(again.error?.code).toBe("MOVE_USED");
  });

  it("rejects moving a Vehicle", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const v = makeInstance(P1, "demolisher-x");
    v.row = "front";
    p.frontRow = [v];
    const r = applyIntent(s, { kind: "moveCharacter", player: P1, instanceId: v.instanceId, toRow: "back" }, cards);
    expect(r.error?.code).toBe("NOT_MOVABLE");
  });
});

// --------------------------------------------------------------------------
describe("loss condition (handoff §7)", () => {
  it("checkLoss: money 0 and no income sources => loser", () => {
    const g = newGame();
    g.players[P1]!.money = 0;
    g.players[P1]!.backRow = [];
    g.players[P2]!.money = 5;
    expect(checkLoss(g, cards)).toBe(P1);
  });

  it("checkLoss: money 0 but a back-row income source => safe", () => {
    const g = newGame();
    const p = g.players[P1]!;
    p.money = 0;
    const src = makeInstance(P1, "assembly-worker-x");
    src.row = "back";
    p.backRow = [src];
    g.players[P2]!.money = 5;
    expect(checkLoss(g, cards)).toBeNull();
  });

  it("checkLoss: money > 0 with no income => safe", () => {
    const g = newGame();
    g.players[P1]!.money = 1;
    g.players[P1]!.backRow = [];
    expect(checkLoss(g, cards)).toBeNull();
  });

  it("checkLoss: money 0 but a FRONT-row income card => safe (income-anywhere default)", () => {
    const g = newGame();
    const p = g.players[P1]!;
    p.money = 0;
    p.backRow = [];
    const src = makeInstance(P1, "data-yoko"); // printed income 1
    src.row = "front";
    p.frontRow = [src];
    g.players[P2]!.money = 5;
    expect(checkLoss(g, cards)).toBeNull();
  });

  it("end phase sets winnerId when the active player collapses", () => {
    let s = forceSettle(newGame());
    // Strip P1 to a losing position, then end the turn so the end-phase loss
    // check fires.
    s.players[P1]!.money = 0;
    s.players[P1]!.backRow = [];
    const r = applyIntent(s, { kind: "endTurn", player: P1 }, cards);
    expect(r.state.winnerId).toBe(P2);
  });
});

// --------------------------------------------------------------------------
describe("concede", () => {
  it("ends the game with the opponent as winner", () => {
    const s = forceSettle(newGame());
    const r = applyIntent(s, { kind: "concede", player: P1 }, cards);
    expect(r.state.winnerId).toBe(P2);
  });
});

// --------------------------------------------------------------------------
describe("purity", () => {
  it("applyIntent never mutates its input state", () => {
    const s = forceSettle(newGame());
    const snapshot = JSON.stringify(s);
    applyIntent(s, { kind: "resale", player: P1, discardInstanceId: s.players[P1]!.hand[0]!.instanceId }, cards);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("rejected intents return the original state unchanged", () => {
    const s = forceSettle(newGame());
    const r = applyIntent(s, { kind: "playCard", player: P1, instanceId: "does-not-exist" }, cards);
    expect(r.error).toBeDefined();
    expect(r.state).toBe(s); // same reference on rejection
  });
});

// --------------------------------------------------------------------------
describe("redactFor", () => {
  it("hides opponent hand + both decks, keeps own hand + board visible", () => {
    const s = forceSettle(newGame());
    // Put a visible board card for P2.
    const board = makeInstance(P2, "data-yoko");
    board.row = "back";
    s.players[P2]!.backRow = [board];

    const view = redactFor(s, P1);
    expect(view.youAre).toBe(P1);
    // P1 sees their own hand contents.
    expect(view.state.players[P1]!.hand.every((c) => c.cardId !== "__hidden__")).toBe(true);
    // P2's hand is hidden but count preserved.
    expect(view.state.players[P2]!.hand.length).toBe(s.players[P2]!.hand.length);
    expect(view.state.players[P2]!.hand.every((c) => c.cardId === "__hidden__")).toBe(true);
    // Decks hidden for both.
    expect(view.state.players[P1]!.deck.every((c) => c.cardId === "__hidden__")).toBe(true);
    // Board zones remain visible.
    expect(view.state.players[P2]!.backRow[0]!.cardId).toBe("data-yoko");
  });
});

// --------------------------------------------------------------------------
describe("getLegalIntents (non-combat)", () => {
  it("offers mulligan at game start", () => {
    const g = newGame();
    const kinds = getLegalIntents(g, P1, cards).map((i) => i.kind);
    expect(kinds).toContain("mulligan");
  });

  it("offers playCard/move/recycle/resale/advance/end in build", () => {
    const s = forceSettle(newGame());
    const kinds = new Set(getLegalIntents(s, P1, cards).map((i) => i.kind));
    expect(kinds.has("advancePhase")).toBe(true);
    expect(kinds.has("endTurn")).toBe(true);
    expect(kinds.has("resale")).toBe(true);
    expect(kinds.has("concede")).toBe(true);
  });

  it("only offers concede to the non-active player", () => {
    const s = forceSettle(newGame());
    const kinds = getLegalIntents(s, P2, cards).map((i) => i.kind);
    expect(kinds).toEqual(["concede"]);
  });
});

// --------------------------------------------------------------------------
describe("combat and effects", () => {
  function combatState(): GameState {
    return applyIntent(forceSettle(newGame()), { kind: "advancePhase", player: P1 }, cards).state;
  }

  it("getLegalAttackTargets follows front/back/direct and Siege location rules", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const siege = makeInstance(P1, "demolisher-x");
    siege.row = "front";
    const normal = makeInstance(P1, "armor-platoon-x");
    normal.row = "front";
    const guard = makeInstance(P2, "data-yoko");
    guard.row = "front";
    const loc = makeInstance(P2, "strategic-reserve");
    loc.row = "back";
    p1.frontRow = [siege, normal];
    p2.frontRow = [guard];
    p2.backRow = [loc];

    expect(getLegalAttackTargets(s, normal.instanceId, cards)).toEqual([{ kind: "card", instanceId: guard.instanceId }]);
    expect(getLegalAttackTargets(s, siege.instanceId, cards)).toEqual([
      { kind: "card", instanceId: guard.instanceId },
      { kind: "card", instanceId: loc.instanceId },
    ]);

    p2.frontRow = [];
    expect(getLegalAttackTargets(s, normal.instanceId, cards)).toEqual([{ kind: "card", instanceId: loc.instanceId }]);
    p2.backRow = [];
    p2.hasTakenFirstTurn = true; // direct attack requires the defender to have taken a turn
    expect(getLegalAttackTargets(s, normal.instanceId, cards)).toEqual([{ kind: "player", playerId: P2 }]);
  });

  it("first-turn protection: cannot attack a player directly until they have taken a turn", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 3;
    p2.money = 5;
    p2.hasTakenFirstTurn = false;
    const attacker = makeInstance(P1, "phase-wraith"); // ATK 3, Raid 1
    attacker.row = "front";
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [];

    // While P2 is first-turn-protected, there is no legal direct attack.
    expect(getLegalAttackTargets(s, attacker.instanceId, cards)).toEqual([]);
    const blocked = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(blocked.error?.code).toBe("BAD_TARGET");

    // Once P2 has taken a turn, the direct attack is legal: 3 direct + 1 Raid.
    p2.hasTakenFirstTurn = true;
    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P2]!.money).toBe(1); // 5 - 3 - 1
    expect(r.state.players[P1]!.money).toBe(4); // stole 1
  });

  it("Raid steals once the defender has taken a first turn", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 3;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "phase-wraith");
    attacker.row = "front";
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [];

    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P2]!.money).toBe(1); // 3 direct + 1 Raid = 4 lost
    expect(r.state.players[P1]!.money).toBe(4); // stole 1
  });

  it("destroyed Reassemble cards can return once, exhausted in the back row with -1 DEF", () => {
    let s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 2;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x");
    attacker.row = "front";
    const linda = makeInstance(P2, "linda-husk");
    linda.row = "back";
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [linda];

    s = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    const intents = getLegalIntents(s, P2, cards);
    expect(intents).toContainEqual({ kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true });

    s = applyIntent(s, { kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true }, cards).state;
    const returned = s.players[P2]!.backRow.find((c) => c.instanceId === linda.instanceId)!;
    expect(returned.exhausted).toBe(true);
    expect(returned.currentDef).toBe(1);
    expect(returned.reassembledCount).toBe(1);
    expect(s.players[P2]!.money).toBe(1);
  });

  it("Strategic Reserve gains 1 money when it enters play", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const reserve = makeInstance(P1, "strategic-reserve");
    p.hand = [reserve];
    p.money = 3;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: reserve.instanceId }, cards).state;
    expect(s.players[P1]!.money).toBe(1); // paid 3, then gained 1
  });

  it("Infrastructure Audit X destroys a Location", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const audit = makeInstance(P1, "infrastructure-audit-x");
    const reserve = makeInstance(P2, "strategic-reserve");
    reserve.row = "back";
    p1.hand = [audit];
    p1.money = 10;
    p2.backRow = [reserve];

    s = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: audit.instanceId,
      targets: [{ kind: "card", instanceId: reserve.instanceId }],
    }, cards).state;
    expect(s.players[P2]!.backRow).toEqual([]);
    expect(s.players[P2]!.discard.some((c) => c.instanceId === reserve.instanceId)).toBe(true);
  });

  it("System Shutdown exhausts an enemy Character and Forced Liquidation destroys it", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const shutdown = makeInstance(P1, "system-shutdown");
    const liquidation = makeInstance(P1, "forced-liquidation");
    const enemy = makeInstance(P2, "data-yoko");
    enemy.row = "front";
    p1.hand = [shutdown, liquidation];
    p1.money = 10;
    p2.frontRow = [enemy];

    s = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: shutdown.instanceId,
      targets: [{ kind: "card", instanceId: enemy.instanceId }],
    }, cards).state;
    expect(s.players[P2]!.frontRow[0]!.exhausted).toBe(true);

    s = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: liquidation.instanceId,
      targets: [{ kind: "card", instanceId: enemy.instanceId }],
    }, cards).state;
    expect(s.players[P2]!.frontRow).toEqual([]);
    expect(s.players[P2]!.discard.some((c) => c.instanceId === enemy.instanceId)).toBe(true);
  });

  it("Data Relay Station does not generate income while exhausted", () => {
    const g = newGame();
    const p = g.players[P1]!;
    const relay = makeInstance(P1, "data-relay-station");
    relay.row = "back";
    relay.exhausted = true;
    p.backRow = [relay];
    expect(totalIncome(g, P1, cards)).toBe(0);
    relay.exhausted = false;
    expect(totalIncome(g, P1, cards)).toBe(2);
  });

  it("Governor adds +1 income to other back-row Characters", () => {
    const g = newGame();
    const p = g.players[P1]!;
    const governor = makeInstance(P1, "governor");
    governor.row = "back";
    const worker = makeInstance(P1, "assembly-worker-x");
    worker.row = "back";
    const reserve = makeInstance(P1, "strategic-reserve");
    reserve.row = "back";
    p.backRow = [governor, worker, reserve];
    expect(totalIncome(g, P1, cards)).toBe(4); // governor 1 + worker 2 + location 1
  });

  it("Forward Operating Base X discounts Vehicles, clamped at zero", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const base1 = makeInstance(P1, "forward-operating-base-x");
    const base2 = makeInstance(P1, "forward-operating-base-x");
    base1.row = "back";
    base2.row = "back";
    p.backRow = [base1, base2];
    const vehicle = makeInstance(P1, "demolisher-x");
    p.hand = [vehicle];
    p.money = 3;
    const r = applyIntent(s, { kind: "playCard", player: P1, instanceId: vehicle.instanceId }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P1]!.money).toBe(0);
    expect(r.state.players[P1]!.frontRow.some((c) => c.instanceId === vehicle.instanceId)).toBe(true);
  });

  it("getLegalIntents emits target-bearing action intents", () => {
    const s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const shutdown = makeInstance(P1, "system-shutdown");
    const enemy = makeInstance(P2, "data-yoko");
    enemy.row = "front";
    p1.hand = [shutdown];
    p1.money = 10;
    p2.frontRow = [enemy];

    expect(getLegalIntents(s, P1, cards)).toContainEqual({
      kind: "playCard",
      player: P1,
      instanceId: shutdown.instanceId,
      targets: [{ kind: "card", instanceId: enemy.instanceId }],
    });
  });

  it("Resource Reallocation grants one additional non-Vehicle move", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const realloc = makeInstance(P1, "resource-reallocation");
    realloc.row = "ongoing";
    const c1 = makeInstance(P1, "data-yoko");
    const c2 = makeInstance(P1, "assembly-worker-x");
    const c3 = makeInstance(P1, "phase-wraith");
    c1.row = "front";
    c2.row = "front";
    c3.row = "front";
    p.ongoing = [realloc];
    p.frontRow = [c1, c2, c3];

    s = applyIntent(s, { kind: "moveCharacter", player: P1, instanceId: c1.instanceId, toRow: "back" }, cards).state;
    const second = applyIntent(s, { kind: "moveCharacter", player: P1, instanceId: c2.instanceId, toRow: "back" }, cards);
    expect(second.error).toBeUndefined();
    const third = applyIntent(second.state, { kind: "moveCharacter", player: P1, instanceId: c3.instanceId, toRow: "back" }, cards);
    expect(third.error?.code).toBe("MOVE_USED");
  });

  it("System Audit taxes a chosen non-Location card until that player's end phase", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const audit = makeInstance(P1, "system-audit");
    const taxed = makeInstance(P2, "data-yoko");
    p1.hand = [audit];
    p1.money = 10;
    p2.hand = [taxed];
    p2.money = 2;

    s = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: audit.instanceId,
      targets: [{ kind: "card", instanceId: taxed.instanceId }],
    }, cards).state;
    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state;

    const denied = applyIntent(s, { kind: "playCard", player: P2, instanceId: taxed.instanceId }, cards);
    expect(denied.error?.code).toBe("CANT_AFFORD");
    s.players[P2]!.money = 3;
    const allowed = applyIntent(s, { kind: "playCard", player: P2, instanceId: taxed.instanceId }, cards);
    expect(allowed.error).toBeUndefined();
    expect(allowed.state.players[P2]!.money).toBe(0);
  });

  it("settleToInteractive pauses at Income when Optimize is available", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const analyst = makeInstance(P1, "analyst-yoko");
    analyst.row = "back";
    p1.backRow = [analyst];
    const moneyBefore = p1.money;

    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state;
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state;
    expect(s.activePlayerId).toBe(P1);
    expect(s.phase).toBe("income");
    expect(s.players[P1]!.money).toBe(moneyBefore + 1);
    expect(getLegalIntents(s, P1, cards)).toContainEqual({ kind: "optimize", player: P1, instanceId: analyst.instanceId });

    s = applyIntent(s, { kind: "optimize", player: P1, instanceId: analyst.instanceId }, cards).state;
    expect(s.players[P1]!.money).toBe(moneyBefore + 2);
    s = applyIntent(s, { kind: "advancePhase", player: P1 }, cards).state;
    expect(s.phase).toBe("build");
  });

  it("free Linda Reassemble legal intents do not mutate state", () => {
    let s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 0;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x");
    attacker.row = "front";
    const overseer = makeInstance(P2, "overseer-node");
    overseer.row = "back";
    const linda = makeInstance(P2, "linda-husk");
    linda.row = "back";
    p1.frontRow = [attacker];
    p2.backRow = [overseer, linda];
    p2.frontRow = [];

    s = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    const before = JSON.stringify(s);
    expect(getLegalIntents(s, P2, cards)).toContainEqual({ kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true });
    expect(JSON.stringify(s)).toBe(before);

    s = applyIntent(s, { kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true }, cards).state;
    expect(s.players[P2]!.money).toBe(0);
    expect(s.players[P2]!.backRow.some((c) => c.instanceId === linda.instanceId)).toBe(true);
  });

  it("Emergency Protocols discounts only the next Character after the first destruction each turn", () => {
    let s = forceSettle(newGame());
    const p = s.players[P1]!;
    const protocols = makeInstance(P1, "emergency-protocols");
    protocols.row = "ongoing";
    const victim1 = makeInstance(P1, "data-yoko");
    const victim2 = makeInstance(P1, "assembly-worker-x");
    victim1.row = "front";
    victim2.row = "front";
    victim1.exhausted = true;
    victim2.exhausted = true;
    const forced1 = makeInstance(P1, "forced-liquidation");
    const forced2 = makeInstance(P1, "forced-liquidation");
    const next1 = makeInstance(P1, "data-yoko");
    const next2 = makeInstance(P1, "data-yoko");
    p.ongoing = [protocols];
    p.frontRow = [victim1, victim2];
    p.hand = [forced1, forced2, next1, next2];
    p.money = 20;

    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: forced1.instanceId, targets: [{ kind: "card", instanceId: victim1.instanceId }] }, cards).state;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: next1.instanceId }, cards).state;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: forced2.instanceId, targets: [{ kind: "card", instanceId: victim2.instanceId }] }, cards).state;
    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: next2.instanceId }, cards).state;

    expect(s.players[P1]!.money).toBe(15); // cheap-actions experiment: Forced Liquidation now costs 1
  });

  it("Emergency Protocols keeps its next Character discount across turns", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const protocols = makeInstance(P1, "emergency-protocols");
    protocols.row = "ongoing";
    const victim = makeInstance(P1, "data-yoko");
    victim.row = "front";
    victim.exhausted = true;
    const liquidation = makeInstance(P1, "forced-liquidation");
    const next = makeInstance(P1, "data-yoko");
    p1.ongoing = [protocols];
    p1.frontRow = [victim];
    p1.hand = [liquidation];
    p1.money = 10;

    s = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: liquidation.instanceId,
      targets: [{ kind: "card", instanceId: victim.instanceId }],
    }, cards).state;
    expect(s.players[P1]!.money).toBe(9); // cheap-actions experiment: Forced Liquidation now costs 1

    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state;
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state;
    s.players[P1]!.hand = [next];
    s.players[P1]!.money = 2;

    const discounted = applyIntent(s, { kind: "playCard", player: P1, instanceId: next.instanceId }, cards);
    expect(discounted.error).toBeUndefined();
    expect(discounted.state.players[P1]!.money).toBe(1);
  });

  it("Reality Tumbler gains Raid 1 for the turn when moved to the front row", () => {
    let s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const tumbler = makeInstance(P1, "reality-tumbler");
    tumbler.row = "back";
    p1.backRow = [tumbler];
    p1.frontRow = [];
    p2.frontRow = [];
    p2.backRow = [];
    p1.money = 3;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;

    s = applyIntent(s, { kind: "moveCharacter", player: P1, instanceId: tumbler.instanceId, toRow: "front" }, cards).state;
    s = applyIntent(s, { kind: "advancePhase", player: P1 }, cards).state;
    s = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: tumbler.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;

    expect(s.players[P2]!.money).toBe(2); // 2 direct + 1 temporary Raid
    expect(s.players[P1]!.money).toBe(4);
  });
});

// --------------------------------------------------------------------------
// Test instance factory: builds a CardInstance for a card id without going
// through the deck. Mirrors the engine's instance shape.
let testSeq = 0;
function makeInstance(owner: PlayerId, cardId: string) {
  const def = cards.byId.get(cardId)!;
  return {
    instanceId: `test:${cardId}:${testSeq++}`,
    cardId,
    ownerId: owner,
    controllerId: owner,
    row: null as null | "front" | "back" | "ongoing",
    exhausted: false,
    currentDef: def.def,
  };
}

// Keep an Rng import referenced so the determinism intent is documented.
void Rng;
