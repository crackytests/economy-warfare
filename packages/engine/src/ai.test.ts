import { describe, it, expect, beforeEach } from "vitest";
import {
  applyIntent,
  createGame,
  getLegalIntents,
  pickAIIntent,
  type CardIndex,
  type NewGameOptions,
} from "./index";
import { loadCardIndex, starterDeck } from "./cards";
import { settleToInteractive } from "./reducer";
import { effectiveCost } from "./economy";
import type { CardInstance, GameState, PlayerId } from "@ew/shared";

let cards: CardIndex;

beforeEach(() => {
  cards = loadCardIndex();
});

const P1 = "p1";
const P2 = "p2";

function newGame(opts?: Partial<NewGameOptions>): GameState {
  return createGame({
    gameId: "ai-test",
    cards,
    rngSeed: 2468,
    startingPlayerId: P2,
    players: [
      { id: P1, name: "Alice", deck: starterDeck("system-x-starter") },
      { id: P2, name: "Bob", deck: starterDeck("yoko-imperium-starter") },
    ],
    ...opts,
  });
}

function forceSettle(s: GameState): GameState {
  const clone: GameState = JSON.parse(JSON.stringify(s));
  settleToInteractive(clone, cards);
  return clone;
}

let testSeq = 0;
function makeInstance(owner: PlayerId, cardId: string, row: null | "front" | "back" | "ongoing" = null): CardInstance {
  const def = cards.byId.get(cardId)!;
  return {
    instanceId: `ai:${cardId}:${testSeq++}`,
    cardId,
    ownerId: owner,
    controllerId: owner,
    row,
    exhausted: false,
    currentDef: def.def,
  };
}

function opponentCombatState(): GameState {
  const s = forceSettle(newGame());
  return applyIntent(s, { kind: "advancePhase", player: P2 }, cards).state;
}

describe("solo AI combat handoff", () => {
  it("leaves legal defender choices when the AI attacks the human", () => {
    const s = opponentCombatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P2, "phase-wraith", "front");
    const blocker = makeInstance(P1, "firewall-yoko", "front");

    p1.money = 3;
    p1.hasTakenFirstTurn = true;
    p1.frontRow = [blocker];
    p1.backRow = [];
    p2.frontRow = [attacker];
    p2.backRow = [];

    const aiAttack = pickAIIntent(s, P2, cards);
    expect(aiAttack).toMatchObject({
      kind: "declareAttack",
      player: P2,
      attackerId: attacker.instanceId,
    });

    const pending = applyIntent(s, aiAttack!, cards).state;
    const defenderIntents = getLegalIntents(pending, P1, cards);

    expect(defenderIntents).toContainEqual({
      kind: "declareBlock",
      player: P1,
      blockerId: blocker.instanceId,
      attackerId: attacker.instanceId,
    });
    expect(defenderIntents).toContainEqual({
      kind: "skipBlock",
      player: P1,
      attackerId: attacker.instanceId,
    });
  });

  it("prioritizes blocking Raid attackers once the defender has taken a turn", () => {
    const s = opponentCombatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P2, "phase-wraith", "front");
    const blocker = makeInstance(P1, "firewall-yoko", "front");

    p1.money = 6;
    p1.hasTakenFirstTurn = true;
    p1.frontRow = [blocker];
    p1.backRow = [];
    p2.frontRow = [attacker];
    p2.backRow = [];

    const pending = applyIntent(s, {
      kind: "declareAttack",
      player: P2,
      attackerId: attacker.instanceId,
      target: { kind: "card", instanceId: blocker.instanceId },
    }, cards).state;

    expect(pickAIIntent(pending, P1, cards)).toEqual({
      kind: "declareBlock",
      player: P1,
      blockerId: blocker.instanceId,
      attackerId: attacker.instanceId,
    });
  });
});

describe("solo AI self-preservation (economy)", () => {
  it("sells a spare card (Resale) when broke with no income, to avoid the loss check", () => {
    const s = forceSettle(newGame()); // P2 active, Build
    const p2 = s.players[P2]!;
    p2.money = 0;
    p2.frontRow = [];
    p2.backRow = []; // no income source
    p2.ongoing = [];
    p2.hand = [makeInstance(P2, "firewall-yoko")]; // spare card, unaffordable at $0

    const intent = pickAIIntent(s, P2, cards);
    expect(intent?.kind).toBe("resale");
  });

  it("does NOT recycle its last $1 to $0 with no income (a guaranteed loss); it banks money instead", () => {
    const s = forceSettle(newGame());
    const p2 = s.players[P2]!;
    p2.money = 1;
    p2.frontRow = [];
    p2.backRow = []; // no income
    p2.ongoing = [];
    // Hand of cards it cannot afford at $1, so it can't just play something.
    p2.hand = [makeInstance(P2, "firewall-yoko"), makeInstance(P2, "governor")];

    const intent = pickAIIntent(s, P2, cards);
    expect(intent?.kind).not.toBe("recycle");
    expect(intent?.kind).toBe("resale");
  });

  it("holds (does not dump cards) when it has an income source and a small buffer", () => {
    const s = forceSettle(newGame());
    const p2 = s.players[P2]!;
    p2.money = 2;
    p2.frontRow = [];
    p2.backRow = [makeInstance(P2, "assembly-worker-x", "back")]; // income source in play
    p2.ongoing = [];
    p2.hand = [makeInstance(P2, "governor")]; // can't afford ($5), but safe — keep it

    const intent = pickAIIntent(s, P2, cards);
    // With income + a buffer and nothing affordable, it should just end the turn,
    // not sell/recycle away a useful card.
    expect(["endTurn", "advancePhase"]).toContain(intent?.kind);
  });

  it("Reassembles a destroyed Linda Bioroid when it can afford the cost", () => {
    let s = forceSettle(newGame()); // P2 active, Build
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // pass to P1 (now in Build)

    const attacker = makeInstance(P1, "armor-platoon-x", "front"); // ATK 3, no Raid (keeps test focused on Reassemble)
    const husk = makeInstance(P2, "linda-husk", "front"); // DEF 2, Reassemble
    s.players[P1]!.frontRow = [attacker];
    s.players[P1]!.backRow = [];
    s.players[P2]!.frontRow = [husk];
    s.players[P2]!.backRow = [];
    s.players[P2]!.money = 2; // enough to pay Reassemble (cost 1)
    s.players[P2]!.hasTakenFirstTurn = true;

    s = applyIntent(s, { kind: "advancePhase", player: P1 }, cards).state; // Build -> Combat
    s = applyIntent(
      s,
      { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: husk.instanceId } },
      cards,
    ).state;
    s = applyIntent(s, { kind: "skipBlock", player: P2, attackerId: attacker.instanceId }, cards).state;

    // The Husk is destroyed and waiting to Reassemble — the AI should pay.
    const choice = pickAIIntent(s, P2, cards);
    expect(choice).toMatchObject({
      kind: "reassembleChoice",
      player: P2,
      instanceId: husk.instanceId,
      pay: true,
    });
  });
});

describe("AI: Black Market Exchange (smart sac, not blind)", () => {
  // Put P1 in their Build phase with an empty hand so the Black Market decision
  // is isolated (no playCard / reassemble / guardbreak ahead of it).
  function buildPhaseForP1(): GameState {
    let s = forceSettle(newGame()); // P2 active, Build
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 Build
    s.players[P1]!.hand = [];
    s.players[P1]!.hasTakenFirstTurn = true;
    return s;
  }

  it("does NOT sac a healthy, valuable body just because it can", () => {
    const s = buildPhaseForP1();
    const bm = makeInstance(P1, "black-market-exchange", "back");
    const income = makeInstance(P1, "analyst-yoko", "back"); // income, no activated ability
    const healthy = makeInstance(P1, "armor-platoon-x", "front"); // 3/4 at full DEF
    s.players[P1]!.backRow = [bm, income];
    s.players[P1]!.frontRow = [healthy];
    s.players[P1]!.money = 4;

    const intent = pickAIIntent(s, P1, cards);
    expect(intent?.kind).not.toBe("activateAbility");
  });

  it("DOES sac a damaged, dying non-income body for 2 money", () => {
    const s = buildPhaseForP1();
    const bm = makeInstance(P1, "black-market-exchange", "back");
    const income = makeInstance(P1, "analyst-yoko", "back");
    const dying = makeInstance(P1, "armor-platoon-x", "front"); // printed DEF 4...
    dying.currentDef = 1; // ...but chipped to 1 — about to die anyway
    s.players[P1]!.backRow = [bm, income];
    s.players[P1]!.frontRow = [dying];
    s.players[P1]!.money = 0; // no spare cash; banking 2 is pure upside

    const intent = pickAIIntent(s, P1, cards);
    expect(intent).toMatchObject({
      kind: "activateAbility",
      abilityId: "destroy-for-2",
      targets: [{ kind: "card", instanceId: dying.instanceId }],
    });
  });

  it("never sacs its last income source", () => {
    const s = buildPhaseForP1();
    const bm = makeInstance(P1, "black-market-exchange", "back");
    const onlyIncome = makeInstance(P1, "analyst-yoko", "back"); // sole earner
    onlyIncome.currentDef = 1; // even chipped, it must not be sacked
    s.players[P1]!.backRow = [bm, onlyIncome];
    s.players[P1]!.frontRow = [];
    s.players[P1]!.money = 0;

    const intent = pickAIIntent(s, P1, cards);
    expect(intent?.kind).not.toBe("activateAbility");
  });
});

describe("Data Yoko: Fortify ability", () => {
  function buildPhaseForP1(): GameState {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 Build
    s.players[P1]!.hand = [];
    s.players[P1]!.hasTakenFirstTurn = true;
    return s;
  }

  it("exhausts Data Yoko, grants +1 DEF that survives the End Phase, and expires next turn", () => {
    let s = buildPhaseForP1();
    const dy = makeInstance(P1, "data-yoko", "back");
    const guard = makeInstance(P1, "firewall-yoko", "front"); // DEF 4
    s.players[P1]!.backRow = [dy];
    s.players[P1]!.frontRow = [guard];

    s = applyIntent(s, {
      kind: "activateAbility", player: P1, instanceId: dy.instanceId,
      abilityId: "fortify", targets: [{ kind: "card", instanceId: guard.instanceId }],
    }, cards).state;

    const g1 = s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!;
    expect(g1.defBonusUntilNextTurn).toBe(1);
    expect(s.players[P1]!.backRow.find((c) => c.instanceId === dy.instanceId)!.exhausted).toBe(true);

    // Pass P1's turn (runs End Phase) — the buff must NOT be cleared (it lasts
    // through the opponent's turn).
    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state;
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!.defBonusUntilNextTurn).toBe(1);

    // Pass the opponent's turn back to P1 — at P1's Start phase the buff expires.
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state;
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!.defBonusUntilNextTurn).toBeUndefined();
  });

  it("an exhausted Data Yoko offers no Fortify intent", () => {
    const s = buildPhaseForP1();
    const dy = makeInstance(P1, "data-yoko", "back");
    dy.exhausted = true;
    const guard = makeInstance(P1, "firewall-yoko", "front");
    s.players[P1]!.backRow = [dy];
    s.players[P1]!.frontRow = [guard];

    const fortifyIntents = getLegalIntents(s, P1, cards).filter(
      (i) => i.kind === "activateAbility" && i.abilityId === "fortify",
    );
    expect(fortifyIntents).toHaveLength(0);
  });
});

describe("Assembly Worker X: Rally ability", () => {
  function buildPhaseForP1(): GameState {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 Build
    s.players[P1]!.hand = [];
    s.players[P1]!.hasTakenFirstTurn = true;
    return s;
  }

  it("exhausts the Worker and grants +1 ATK that expires next turn", () => {
    let s = buildPhaseForP1();
    const worker = makeInstance(P1, "assembly-worker-x", "back");
    const attacker = makeInstance(P1, "armor-platoon-x", "front"); // ATK 3
    s.players[P1]!.backRow = [worker];
    s.players[P1]!.frontRow = [attacker];

    s = applyIntent(s, {
      kind: "activateAbility", player: P1, instanceId: worker.instanceId,
      abilityId: "rally", targets: [{ kind: "card", instanceId: attacker.instanceId }],
    }, cards).state;

    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === attacker.instanceId)!.atkBonusUntilNextTurn).toBe(1);
    expect(s.players[P1]!.backRow.find((c) => c.instanceId === worker.instanceId)!.exhausted).toBe(true);

    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state; // survives own End Phase
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === attacker.instanceId)!.atkBonusUntilNextTurn).toBe(1);

    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // expires at P1's next turn
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === attacker.instanceId)!.atkBonusUntilNextTurn).toBeUndefined();
  });
});

describe("Production Overseer X: first Action each turn is free", () => {
  function buildP1(): GameState {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 Build
    s.players[P1]!.hasTakenFirstTurn = true;
    return s;
  }
  const ef = () => cards.byId.get("emergency-funding")!; // Action, cost 1, no target

  it("first Action costs 0, later Actions full price", () => {
    let s = buildP1();
    const overseer = makeInstance(P1, "production-overseer-x", "back");
    const action = makeInstance(P1, "emergency-funding");
    s.players[P1]!.backRow = [overseer];
    s.players[P1]!.hand = [action];
    s.players[P1]!.money = 5;

    expect(effectiveCost(ef(), s, P1)).toBe(0); // free

    s = applyIntent(s, { kind: "playCard", player: P1, instanceId: action.instanceId }, cards).state;
    expect(s.players[P1]!.money).toBe(7); // paid 0, Emergency Funding granted +2

    expect(effectiveCost(ef(), s, P1)).toBe(ef().cost); // second Action is full price
  });

  it("does nothing without Production Overseer X in play", () => {
    const s = buildP1();
    s.players[P1]!.backRow = [];
    expect(effectiveCost(ef(), s, P1)).toBe(ef().cost);
  });
});

describe("Emergency Shielding: +2 DEF until your next turn", () => {
  it("buff survives the End Phase (protects through the opponent's turn) and expires next turn", () => {
    let s = forceSettle(newGame());
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state; // -> P1 Build
    s.players[P1]!.hasTakenFirstTurn = true;
    const guard = makeInstance(P1, "firewall-yoko", "front"); // DEF 4
    const spell = makeInstance(P1, "emergency-shielding"); // in hand
    s.players[P1]!.frontRow = [guard];
    s.players[P1]!.hand = [spell];
    s.players[P1]!.money = 5;

    s = applyIntent(s, {
      kind: "playCard", player: P1, instanceId: spell.instanceId,
      targets: [{ kind: "card", instanceId: guard.instanceId }],
    }, cards).state;
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!.defBonusUntilNextTurn).toBe(2);

    // Survives P1's own End Phase...
    s = applyIntent(s, { kind: "endTurn", player: P1 }, cards).state;
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!.defBonusUntilNextTurn).toBe(2);

    // ...and expires when P1's next turn begins.
    s = applyIntent(s, { kind: "endTurn", player: P2 }, cards).state;
    expect(s.players[P1]!.frontRow.find((c) => c.instanceId === guard.instanceId)!.defBonusUntilNextTurn).toBeUndefined();
  });
});
