/**
 * Sprint 3 / Track C — engine test backfill (Vitest).
 *
 * Covers mechanics that are IMPLEMENTED in the engine but were previously
 * UNTESTED: continuous auras, triggered-money ongoings, keyword behaviors
 * (Optimize / Deploy / Guardbreak / Siege / Reassemble), and a batch of
 * card-specific effects. Each assertion is checked against the rules text in
 * docs/economy_warfare_web_agent_handoff_v1_1.md (§8 combat, §9 keywords,
 * §12 card text) and honors the §18 ambiguity snapshot.
 *
 * The pure-engine modules (combat/economy) are imported directly where a helper
 * computes effective ATK/DEF or income so auras can be asserted without routing
 * a full attack.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyIntent,
  createGame,
  getLegalIntents,
  type CardIndex,
  type NewGameOptions,
} from "./index";
import { loadCardIndex, starterDeck } from "./cards";
import type { CardInstance, GameState, Intent, PlayerId } from "@ew/shared";
import { effectiveAtk, effectiveDef } from "./combat";
import { totalIncome } from "./economy";
import { settleToInteractive } from "./reducer";

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
      { id: P1, name: "Alice", deck: starterDeck("system-x-starter") },
      { id: P2, name: "Bob", deck: starterDeck("yoko-imperium-starter") },
    ],
    startingPlayerId: P1,
    ...opts,
  };
  return createGame(base);
}

function forceSettle(s: GameState): GameState {
  const clone: GameState = JSON.parse(JSON.stringify(s));
  settleToInteractive(clone, cards);
  return clone;
}

/** Settle then advance P1 into the Combat phase. */
function combatState(): GameState {
  return applyIntent(forceSettle(newGame()), { kind: "advancePhase", player: P1 }, cards).state;
}

let testSeq = 0;
function makeInstance(owner: PlayerId, cardId: string, row: null | "front" | "back" | "ongoing" = null): CardInstance {
  const def = cards.byId.get(cardId)!;
  return {
    instanceId: `mech:${cardId}:${testSeq++}`,
    cardId,
    ownerId: owner,
    controllerId: owner,
    row,
    exhausted: false,
    currentDef: def.def,
  };
}

// ==========================================================================
// Continuous auras — asserted via the engine's effective ATK/DEF helpers.
// ==========================================================================
describe("continuous auras", () => {
  it("Predictive Shielding: +1 DEF to your FRONT-row Characters only", () => {
    const g = newGame();
    const p = g.players[P1]!;
    const aura = makeInstance(P1, "predictive-shielding", "ongoing");
    const front = makeInstance(P1, "data-yoko", "front"); // def 2
    const back = makeInstance(P1, "assembly-worker-x", "back"); // def 2
    p.ongoing = [aura];
    p.frontRow = [front];
    p.backRow = [back];

    expect(effectiveDef(g, front, cards)).toBe(3); // 2 + 1 (front)
    expect(effectiveDef(g, back, cards)).toBe(2); // back row: no bonus
  });

  it("Predictive Shielding does not boost Locations (Characters only)", () => {
    const g = newGame();
    const p = g.players[P1]!;
    p.ongoing = [makeInstance(P1, "predictive-shielding", "ongoing")];
    const loc = makeInstance(P1, "forward-operating-base-x", "front"); // a Location, def 3
    p.frontRow = [loc];
    expect(effectiveDef(g, loc, cards)).toBe(3);
  });

  it("Predictive Shielding keeps a front-row Character alive through combat damage", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "logistics-yoko", "front"); // atk 2
    const shield = makeInstance(P2, "predictive-shielding", "ongoing");
    const target = makeInstance(P2, "data-yoko", "front"); // def 2, effectively 3 with shield
    p1.frontRow = [attacker];
    p2.ongoing = [shield];
    p2.frontRow = [target];
    p2.backRow = [];

    let next = applyIntent(s, {
      kind: "declareAttack",
      player: P1,
      attackerId: attacker.instanceId,
      target: { kind: "card", instanceId: target.instanceId },
    }, cards).state;
    next = applyIntent(next, { kind: "skipBlock", player: P2, attackerId: attacker.instanceId }, cards).state;

    const survived = next.players[P2]!.frontRow.find((c) => c.instanceId === target.instanceId)!;
    expect(survived).toBeDefined();
    expect(survived.currentDef).toBe(0); // 2 damage landed
    expect(effectiveDef(next, survived, cards)).toBe(1); // shield keeps it alive
  });

  it("Network Bloom: +1 DEF to your BACK-row Linda Bioroids only", () => {
    const g = newGame();
    const p = g.players[P1]!;
    p.ongoing = [makeInstance(P1, "network-bloom", "ongoing")];
    const lindaBack = makeInstance(P1, "linda-husk", "back"); // def 2
    const lindaFront = makeInstance(P1, "linda-husk", "front"); // def 2
    const nonLindaBack = makeInstance(P1, "assembly-worker-x", "back"); // def 2
    p.backRow = [lindaBack, nonLindaBack];
    p.frontRow = [lindaFront];

    expect(effectiveDef(g, lindaBack, cards)).toBe(3); // back + Linda
    expect(effectiveDef(g, lindaFront, cards)).toBe(2); // front: no bonus
    expect(effectiveDef(g, nonLindaBack, cards)).toBe(2); // not Linda
  });

  it("Director X: +1 ATK to Vehicles you control (not other Characters)", () => {
    const g = newGame();
    const p = g.players[P1]!;
    p.frontRow = [makeInstance(P1, "director-x", "front")];
    const vehicle = makeInstance(P1, "demolisher-x", "front"); // atk 4
    const character = makeInstance(P1, "armor-platoon-x", "front"); // atk 3
    p.frontRow.push(vehicle, character);

    expect(effectiveAtk(g, vehicle, cards)).toBe(5); // 4 + 1
    expect(effectiveAtk(g, character, cards)).toBe(3); // unaffected
  });

  it("Director X only buffs the controller's own Vehicles", () => {
    const g = newGame();
    g.players[P1]!.frontRow = [makeInstance(P1, "director-x", "front")];
    const enemyVehicle = makeInstance(P2, "demolisher-x", "front");
    g.players[P2]!.frontRow = [enemyVehicle];
    expect(effectiveAtk(g, enemyVehicle, cards)).toBe(4);
  });
});

// ==========================================================================
// Triggered money: Latency Hex / Reality Leak / Black Budget.
// ==========================================================================
describe("triggered money ongoings", () => {
  it("Latency Hex: opponent loses 1 money when they block", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.ongoing = [makeInstance(P1, "latency-hex", "ongoing")];
    p2.money = 5;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    const blocker = makeInstance(P2, "firewall-yoko", "front"); // def 4, survives
    p1.frontRow = [attacker];
    p2.frontRow = [blocker];
    p2.backRow = [];

    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: blocker.instanceId } }, cards).state;
    next = applyIntent(next, { kind: "declareBlock", player: P2, blockerId: blocker.instanceId, attackerId: attacker.instanceId }, cards).state;
    expect(next.players[P2]!.money).toBe(4); // lost 1 from Latency Hex
  });

  it("Reality Leak: first money loss each turn (for that player) costs +1 additional", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    // P1 controls Reality Leak; it punishes the OPPONENT (P2) the first time
    // P2 loses money each turn.
    p1.ongoing = [makeInstance(P1, "reality-leak", "ongoing")];
    p1.money = 0;
    p2.money = 10;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "data-yoko", "front"); // atk 1, no Raid
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [];

    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.error).toBeUndefined();
    // 1 direct + 1 additional from Reality Leak (first loss this turn).
    expect(r.state.players[P2]!.money).toBe(8);
  });

  it("Black Budget: once per turn, lose 1 less from Raid", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.ongoing = [makeInstance(P2, "black-budget", "ongoing")];
    p1.money = 0;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    // Phase Wraith: atk 2, Raid 1. Attack directly so the Raid fires.
    const attacker = makeInstance(P1, "phase-wraith", "front");
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [];

    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.error).toBeUndefined();
    // Direct hit = 2 (Black Budget only reduces Raid). Raid 1 reduced to 0 by
    // Black Budget => nothing stolen. So P2: 5 - 2 = 3; P1 gains 0 from Raid.
    expect(r.state.players[P2]!.money).toBe(3);
    expect(r.state.players[P1]!.money).toBe(0);
  });
});

// ==========================================================================
// Keywords: Optimize / OptimizeLinda / Deploy / Guardbreak / Siege / Reassemble.
// ==========================================================================
describe("keyword: Optimize", () => {
  it("Optimize generates +1 during Income and exhausts the card", () => {
    const g = forceSettle(newGame());
    const p = g.players[P1]!;
    const analyst = makeInstance(P1, "analyst-yoko", "back");
    p.backRow = [analyst];
    g.phase = "income";
    const before = p.money;
    const r = applyIntent(g, { kind: "optimize", player: P1, instanceId: analyst.instanceId }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P1]!.money).toBe(before + 1);
    expect(r.state.players[P1]!.backRow[0]!.exhausted).toBe(true);
  });

  it("OptimizeLinda is active only with ANOTHER Linda in play", () => {
    const g = forceSettle(newGame());
    const p = g.players[P1]!;
    const bride = makeInstance(P1, "signal-bride", "back"); // OptimizeLinda
    p.backRow = [bride];
    g.phase = "income";

    // Alone: not optimizable.
    const solo = getLegalIntents(g, P1, cards).filter((i) => i.kind === "optimize");
    expect(solo).toEqual([]);

    // Add another Linda -> now optimizable.
    const husk = makeInstance(P1, "linda-husk", "back");
    p.backRow = [bride, husk];
    const withFriend = getLegalIntents(g, P1, cards).filter((i) => i.kind === "optimize");
    expect(withFriend).toContainEqual({ kind: "optimize", player: P1, instanceId: bride.instanceId });
  });

  it("OptimizeLinda does not count the card itself as the 'another Linda'", () => {
    const g = forceSettle(newGame());
    const p = g.players[P1]!;
    const bride = makeInstance(P1, "signal-bride", "back");
    p.backRow = [bride];
    g.phase = "income";
    const r = applyIntent(g, { kind: "optimize", player: P1, instanceId: bride.instanceId }, cards);
    expect(r.error?.code).toBe("NO_OPTIMIZE");
  });
});

describe("keyword: Deploy", () => {
  it("Deploy moves a Character to the back row on ETB when opted in, without consuming the once-per-turn move", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const deployer = makeInstance(P1, "logistics-yoko"); // Deploy, cost 3
    const mover = makeInstance(P1, "data-yoko", "front"); // a separate movable character
    p.hand = [deployer];
    p.frontRow = [mover];
    p.money = 10;

    // Opt into Deploy by passing a (self) card target.
    const r = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: deployer.instanceId,
      targets: [{ kind: "card", instanceId: deployer.instanceId }],
    }, cards);
    expect(r.error).toBeUndefined();
    const pp = r.state.players[P1]!;
    expect(pp.backRow.some((c) => c.instanceId === deployer.instanceId)).toBe(true);
    expect(pp.frontRow.some((c) => c.instanceId === deployer.instanceId)).toBe(false);
    // The once-per-turn move is still available afterward.
    expect(pp.usedMoveThisTurn).toBe(false);
    const move = applyIntent(r.state, { kind: "moveCharacter", player: P1, instanceId: mover.instanceId, toRow: "back" }, cards);
    expect(move.error).toBeUndefined();
  });

  it("getLegalIntents offers BOTH a normal play and a self-targeted Deploy play for a Deploy Character", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const deployer = makeInstance(P1, "logistics-yoko"); // Deploy, cost 3
    p.hand = [deployer];
    p.money = 10;
    const plays = getLegalIntents(s, P1, cards).filter(
      (i): i is Extract<Intent, { kind: "playCard" }> =>
        i.kind === "playCard" && i.instanceId === deployer.instanceId,
    );
    // One plain play (front) + one self-targeted Deploy variant.
    expect(plays.length).toBe(2);
    expect(plays.some((i) => !i.targets || i.targets.length === 0)).toBe(true);
    expect(
      plays.some((i) => i.targets?.[0]?.kind === "card" && i.targets[0].instanceId === deployer.instanceId),
    ).toBe(true);
  });

  it("a non-Deploy Character offers only a single (plain) play intent", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const plain = makeInstance(P1, "data-yoko"); // no Deploy
    p.hand = [plain];
    p.money = 10;
    const plays = getLegalIntents(s, P1, cards).filter(
      (i) => i.kind === "playCard" && i.instanceId === plain.instanceId,
    );
    expect(plays.length).toBe(1);
  });

  it("Deploy without a target leaves the Character in the front row", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const deployer = makeInstance(P1, "logistics-yoko");
    p.hand = [deployer];
    p.money = 10;
    const r = applyIntent(s, { kind: "playCard", player: P1, instanceId: deployer.instanceId }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P1]!.frontRow.some((c) => c.instanceId === deployer.instanceId)).toBe(true);
  });
});

describe("keyword: Guardbreak", () => {
  it("a Guardbroken blocker cannot block the attack", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "glitch-adept", "front"); // Guardbreak, atk 4
    const blockerA = makeInstance(P2, "firewall-yoko", "front");
    const blockerB = makeInstance(P2, "data-yoko", "front");
    p1.frontRow = [attacker];
    p2.frontRow = [blockerA, blockerB];
    p2.backRow = [];

    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: blockerA.instanceId } }, cards).state;
    // Attacker chooses to ground blockerA.
    next = applyIntent(next, { kind: "guardbreakChoice", player: P1, attackerId: attacker.instanceId, cannotBlockId: blockerA.instanceId }, cards).state;

    // blockerA may no longer block; blockerB still can.
    const blocks = getLegalIntents(next, P2, cards).filter((i) => i.kind === "declareBlock") as Array<{ blockerId: string }>;
    const blockerIds = blocks.map((b) => b.blockerId);
    expect(blockerIds).toContain(blockerB.instanceId);
    expect(blockerIds).not.toContain(blockerA.instanceId);

    // Explicitly attempting to block with the grounded blocker is rejected.
    const denied = applyIntent(next, { kind: "declareBlock", player: P2, blockerId: blockerA.instanceId, attackerId: attacker.instanceId }, cards);
    expect(denied.error?.code).toBe("GROUNDED_BY_GUARDBREAK");
  });
});

describe("keyword: Siege", () => {
  it("Siege attacker may target a back-row Location through a front row", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const siege = makeInstance(P1, "demolisher-x", "front"); // Siege, atk 4
    const guard = makeInstance(P2, "data-yoko", "front");
    const loc = makeInstance(P2, "strategic-reserve", "back"); // def 3
    p1.frontRow = [siege];
    p2.frontRow = [guard];
    p2.backRow = [loc];

    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: siege.instanceId, target: { kind: "card", instanceId: loc.instanceId } }, cards);
    expect(r.error).toBeUndefined();
    // The defender may still block (front row present), so the attack is pending.
    // Skip the block and resolve damage: 4 dmg vs def 3 destroys the Location.
    const resolved = applyIntent(r.state, { kind: "skipBlock", player: P2, attackerId: siege.instanceId }, cards).state;
    expect(resolved.players[P2]!.backRow.some((c) => c.instanceId === loc.instanceId)).toBe(false);
    expect(resolved.players[P2]!.discard.some((c) => c.instanceId === loc.instanceId)).toBe(true);
  });

  it("Siege can strike ANY back-row card directly, including Characters", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const siege = makeInstance(P1, "demolisher-x", "front"); // atk 4, Siege
    const guard = makeInstance(P2, "data-yoko", "front");
    const backChar = makeInstance(P2, "assembly-worker-x", "back"); // def 2
    p1.frontRow = [siege];
    p2.frontRow = [guard];
    p2.backRow = [backChar];

    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: siege.instanceId, target: { kind: "card", instanceId: backChar.instanceId } }, cards);
    expect(r.error).toBeUndefined(); // legal despite the front-row guard
    const resolved = applyIntent(r.state, { kind: "skipBlock", player: P2, attackerId: siege.instanceId }, cards).state;
    // 4 dmg vs def 2 destroys the back-row Character.
    expect(resolved.players[P2]!.backRow.some((c) => c.instanceId === backChar.instanceId)).toBe(false);
    expect(resolved.players[P2]!.discard.some((c) => c.instanceId === backChar.instanceId)).toBe(true);
  });
});

describe("card: Repair Swarm", () => {
  it("restores a damaged Linda Bioroid to its printed DEF (heals, does not over-heal past printed)", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const husk = makeInstance(P1, "linda-husk", "back"); // printed DEF 2
    husk.currentDef = 1; // took 1 combat damage
    p.frontRow = [];
    p.backRow = [husk];
    p.hand = [makeInstance(P1, "repair-swarm")]; // cost 2
    p.money = 5;

    const repair = getLegalIntents(s, P1, cards).find(
      (i): i is Extract<Intent, { kind: "playCard" }> =>
        i.kind === "playCard" &&
        i.targets?.[0]?.kind === "card" &&
        i.targets[0].instanceId === husk.instanceId,
    );
    expect(repair).toBeDefined();
    const after = applyIntent(s, repair!, cards).state;
    const healed = after.players[P1]!.backRow.find((c) => c.instanceId === husk.instanceId)!;
    expect(healed.currentDef).toBe(2); // back to printed, not 1+2=3
  });
});

describe("keyword: Reassemble", () => {
  it("Reassemble works strictly once per instance (reassembledCount blocks a second)", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x", "front"); // atk 3
    const linda = makeInstance(P2, "linda-husk", "back"); // def 2, Reassemble
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [linda];

    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    next = applyIntent(next, { kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true }, cards).state;
    const back = next.players[P2]!.backRow.find((c) => c.instanceId === linda.instanceId)!;
    expect(back.reassembledCount).toBe(1);
    expect(back.currentDef).toBe(1); // 2 - 1 penalty

    // Destroy it again: with reassembledCount already 1, it should NOT prompt
    // a second Reassemble — it just goes to discard.
    const attacker2 = makeInstance(P1, "armor-platoon-x", "front");
    next.players[P1]!.frontRow = [attacker2];
    next.players[P2]!.frontRow = [];
    // Move the reassembled Linda to the front so it is a legal lone target.
    const husk = next.players[P2]!.backRow.find((c) => c.instanceId === linda.instanceId)!;
    next.players[P2]!.backRow = next.players[P2]!.backRow.filter((c) => c.instanceId !== linda.instanceId);
    husk.row = "front";
    next.players[P2]!.frontRow = [husk];
    next.phase = "combat";

    next = applyIntent(next, { kind: "declareAttack", player: P1, attackerId: attacker2.instanceId, target: { kind: "card", instanceId: husk.instanceId } }, cards).state;
    const reassembleOffers = getLegalIntents(next, P2, cards).filter((i) => i.kind === "reassembleChoice");
    expect(reassembleOffers).toEqual([]);
    expect(next.players[P2]!.discard.some((c) => c.instanceId === linda.instanceId)).toBe(true);
  });

  it("cannot Reassemble when the resulting DEF would be <= 0", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    // Linda Husk def 2; pre-apply a -1 reassemble penalty so the NEXT reassemble
    // would drop it to 0 -> not allowed. Use currentDef so it is destroyable.
    const linda = makeInstance(P2, "linda-husk", "back");
    linda.defPenaltyFromReassemble = 1;
    linda.currentDef = 1;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [linda];

    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    const offers = getLegalIntents(next, P2, cards).filter((i) => i.kind === "reassembleChoice");
    expect(offers).toEqual([]); // next DEF would be 2 - 2 = 0
    expect(next.players[P2]!.discard.some((c) => c.instanceId === linda.instanceId)).toBe(true);
  });
});

// ==========================================================================
// Card specifics.
// ==========================================================================
describe("card specifics", () => {
  it("Black Market Exchange: destroy your character -> +2 money, once per turn", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const bme = makeInstance(P1, "black-market-exchange", "back");
    const victim = makeInstance(P1, "data-yoko", "front");
    p.backRow = [bme];
    p.frontRow = [victim];
    p.money = 1;

    const r = applyIntent(s, {
      kind: "activateAbility",
      player: P1,
      instanceId: bme.instanceId,
      abilityId: "destroy-for-2",
      targets: [{ kind: "card", instanceId: victim.instanceId }],
    }, cards);
    expect(r.error).toBeUndefined();
    expect(r.state.players[P1]!.money).toBe(3); // +2
    expect(r.state.players[P1]!.frontRow.some((c) => c.instanceId === victim.instanceId)).toBe(false);

    // Second activation same turn is rejected.
    const victim2 = makeInstance(P1, "assembly-worker-x", "front");
    r.state.players[P1]!.frontRow = [victim2];
    const again = applyIntent(r.state, {
      kind: "activateAbility",
      player: P1,
      instanceId: bme.instanceId,
      abilityId: "destroy-for-2",
      targets: [{ kind: "card", instanceId: victim2.instanceId }],
    }, cards);
    expect(again.error?.code).toBe("ABILITY_USED");
  });

  it("Overseer Node: first OTHER Linda destroyed each turn reassembles for free", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 0; // can't pay anything; only a free reassemble is possible
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    const overseer = makeInstance(P2, "overseer-node", "back");
    const linda = makeInstance(P2, "linda-husk", "back");
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [overseer, linda];

    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    // A pay:true reassemble must be offered at 0 money because the cost is free.
    expect(getLegalIntents(next, P2, cards)).toContainEqual({ kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true });
    const done = applyIntent(next, { kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true }, cards).state;
    expect(done.players[P2]!.money).toBe(0); // free
    expect(done.players[P2]!.backRow.some((c) => c.instanceId === linda.instanceId)).toBe(true);
  });

  it("Overseer Node does NOT make ITSELF reassemble free (only OTHER Lindas)", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 0;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    // Overseer Node is a Linda with Reassemble? No — Overseer has no Reassemble
    // keyword, so it simply cannot reassemble. Use a lone Overseer to confirm
    // it is not offered a free reassemble of itself.
    const overseer = makeInstance(P2, "overseer-node", "back"); // def 4
    overseer.currentDef = 4;
    p1.frontRow = [attacker]; // atk 3 — won't kill def 4. Force-destroy instead.
    p2.frontRow = [];
    p2.backRow = [overseer];

    // Drop its DEF so the attack destroys it.
    overseer.currentDef = 1;
    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: overseer.instanceId } }, cards).state;
    // Overseer has no Reassemble keyword: no offer at all.
    const offers = getLegalIntents(next, P2, cards).filter((i) => i.kind === "reassembleChoice");
    expect(offers).toEqual([]);
  });

  it("Endless Linda: first Linda destroyed each turn reassembles for free", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 0;
    p2.hasTakenFirstTurn = true;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    const endless = makeInstance(P2, "endless-linda", "back");
    const linda = makeInstance(P2, "linda-husk", "back");
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [endless, linda];

    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: linda.instanceId } }, cards).state;
    expect(getLegalIntents(next, P2, cards)).toContainEqual({ kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true });
    const done = applyIntent(next, { kind: "reassembleChoice", player: P2, instanceId: linda.instanceId, pay: true }, cards).state;
    expect(done.players[P2]!.money).toBe(0);
  });

  it("Market Eater: Raid only if you attacked with 3+ characters this combat", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 0;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    p2.frontRow = [];
    p2.backRow = [];
    // Only Market Eater attacks (1 attack) -> Raid suppressed.
    const eater = makeInstance(P1, "market-eater", "front"); // atk 3, Raid 1 conditional
    p1.frontRow = [eater];
    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: eater.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;
    expect(next.players[P2]!.money).toBe(2); // 3 direct, no Raid
    expect(next.players[P1]!.money).toBe(0); // stole nothing
  });

  it("Market Eater: Raid fires when 3+ characters have attacked", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 0;
    p2.money = 20;
    p2.hasTakenFirstTurn = true;
    p2.frontRow = [];
    p2.backRow = [];
    const a1 = makeInstance(P1, "assembly-worker-x", "front"); // atk 1
    const a2 = makeInstance(P1, "assembly-worker-x", "front"); // atk 1
    const eater = makeInstance(P1, "market-eater", "front"); // atk 3, Raid 1
    p1.frontRow = [a1, a2, eater];

    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: a1.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;
    next = applyIntent(next, { kind: "declareAttack", player: P1, attackerId: a2.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;
    next = applyIntent(next, { kind: "declareAttack", player: P1, attackerId: eater.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;
    // a1 (1) + a2 (1) + eater (3 direct) + Raid 1 (3rd attacker) = 6 lost.
    expect(next.players[P2]!.money).toBe(14);
    expect(next.players[P1]!.money).toBe(1); // stole 1 via Raid
  });

  it("Desync Skirmisher: Raid only if unblocked", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 0;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    const skirm = makeInstance(P1, "desync-skirmisher", "front"); // atk 2, Raid 1 if unblocked
    const blocker = makeInstance(P2, "firewall-yoko", "front"); // def 4, survives
    p1.frontRow = [skirm];
    p2.frontRow = [blocker];
    p2.backRow = [];

    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: skirm.instanceId, target: { kind: "card", instanceId: blocker.instanceId } }, cards).state;
    next = applyIntent(next, { kind: "declareBlock", player: P2, blockerId: blocker.instanceId, attackerId: skirm.instanceId }, cards).state;
    // Blocked: no Raid steal.
    expect(next.players[P2]!.money).toBe(5);
    expect(next.players[P1]!.money).toBe(0);
  });

  it("Desync Skirmisher: Raid fires when unblocked", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p1.money = 0;
    p2.money = 5;
    p2.hasTakenFirstTurn = true;
    const skirm = makeInstance(P1, "desync-skirmisher", "front"); // atk 2, Raid 1
    p1.frontRow = [skirm];
    p2.frontRow = [];
    p2.backRow = [];
    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: skirm.instanceId, target: { kind: "player", playerId: P2 } }, cards).state;
    // 2 direct + Raid 1 = 3 lost; P1 steals 1.
    expect(next.players[P2]!.money).toBe(2);
    expect(next.players[P1]!.money).toBe(1);
  });

  it("Afterimage Lurker cannot block", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    const lurker = makeInstance(P2, "afterimage-lurker", "front");
    p1.frontRow = [attacker];
    p2.frontRow = [lurker];
    p2.backRow = [];

    // With only a non-blocking creature in front, the attack should resolve
    // without offering a block (afterimage-lurker is not a legal blocker).
    const next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: lurker.instanceId } }, cards).state;
    // With no legal blocker the attack auto-resolves: lurker (def 3) takes 3 and dies.
    expect(next.players[P2]!.frontRow.some((c) => c.instanceId === lurker.instanceId)).toBe(false);
    // While the attack is still pending, lurker is not a legal blocker. Re-declare
    // against a fresh state to inspect the rejection deterministically.
    const s2 = combatState();
    s2.players[P1]!.frontRow = [makeInstance(P1, "phase-wraith", "front")];
    const lurker2 = makeInstance(P2, "afterimage-lurker", "front");
    const wall = makeInstance(P2, "firewall-yoko", "front"); // a real blocker keeps the attack pending
    s2.players[P2]!.frontRow = [lurker2, wall];
    s2.players[P2]!.backRow = [];
    const atkId = s2.players[P1]!.frontRow[0]!.instanceId;
    const pending = applyIntent(s2, { kind: "declareAttack", player: P1, attackerId: atkId, target: { kind: "card", instanceId: wall.instanceId } }, cards).state;
    const denied = applyIntent(pending, { kind: "declareBlock", player: P2, blockerId: lurker2.instanceId, attackerId: atkId }, cards);
    expect(denied.error?.code).toBe("BAD_BLOCKER");
  });

  it("Accountant Yoko cannot attack", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const yoko = makeInstance(P1, "accountant-yoko", "front"); // atk 2 but cannot attack
    p1.frontRow = [yoko];
    p2.frontRow = [];
    p2.backRow = [];

    const attacks = getLegalIntents(s, P1, cards).filter((i) => i.kind === "declareAttack");
    expect(attacks).toEqual([]);
    const denied = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: yoko.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(denied.error?.code).toBe("BAD_ATTACKER");
  });

  it("Operational Overhead: first card each player plays each turn costs 1 more", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const overhead = makeInstance(P1, "operational-overhead", "ongoing");
    p.ongoing = [overhead];
    const first = makeInstance(P1, "data-yoko"); // cost 2 -> 3 with overhead
    const second = makeInstance(P1, "data-yoko"); // cost 2 (no surcharge)
    p.hand = [first, second];
    p.money = 5;

    const r1 = applyIntent(s, { kind: "playCard", player: P1, instanceId: first.instanceId }, cards);
    expect(r1.error).toBeUndefined();
    expect(r1.state.players[P1]!.money).toBe(2); // 5 - 3
    const r2 = applyIntent(r1.state, { kind: "playCard", player: P1, instanceId: second.instanceId }, cards);
    expect(r2.error).toBeUndefined();
    expect(r2.state.players[P1]!.money).toBe(0); // 2 - 2 (no surcharge on 2nd)
  });

  it("Temporary Shutdown: target does not ready during its controller's next Start", () => {
    const s = forceSettle(newGame());
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const shutdown = makeInstance(P1, "temporary-shutdown");
    const enemy = makeInstance(P2, "data-yoko", "front");
    p1.hand = [shutdown];
    p1.money = 10;
    p2.frontRow = [enemy];

    let next = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: shutdown.instanceId,
      targets: [{ kind: "card", instanceId: enemy.instanceId }],
    }, cards).state;
    const taxed = next.players[P2]!.frontRow[0]!;
    expect(taxed.exhausted).toBe(true);
    expect(taxed.cannotReadyNextStart).toBe(true);

    // Pass to P2's turn: their Start phase should NOT ready this card.
    next = applyIntent(next, { kind: "endTurn", player: P1 }, cards).state;
    const afterStart = next.players[P2]!.frontRow[0]!;
    expect(afterStart.exhausted).toBe(true); // stayed exhausted
    expect(afterStart.cannotReadyNextStart).toBe(false); // flag cleared after skipping once
  });

  it("Replication Loop: returns a destroyed Linda to back row at -1 DEF and it cannot Reassemble again", () => {
    const s = forceSettle(newGame());
    const p = s.players[P1]!;
    const loop = makeInstance(P1, "replication-loop");
    // A Linda in the discard, owned by P1.
    const linda = makeInstance(P1, "linda-husk"); // def 2
    linda.row = null;
    linda.currentDef = null;
    p.discard = [linda];
    p.hand = [loop];
    p.money = 10;

    const r = applyIntent(s, {
      kind: "playCard",
      player: P1,
      instanceId: loop.instanceId,
      targets: [{ kind: "card", instanceId: linda.instanceId }],
    }, cards);
    expect(r.error).toBeUndefined();
    const returned = r.state.players[P1]!.backRow.find((c) => c.instanceId === linda.instanceId)!;
    expect(returned).toBeDefined();
    expect(returned.currentDef).toBe(1); // 2 - 1
    expect(returned.reassembledCount).toBe(1); // marked so it cannot Reassemble again
    expect(r.state.players[P1]!.discard.some((c) => c.instanceId === linda.instanceId)).toBe(false);
  });
});

// ==========================================================================
// §8 / §10 combat edge cases.
// ==========================================================================
describe("combat edge cases (§8 / §10)", () => {
  it("direct attack damage removes money equal to ATK (§18.1 snapshot)", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.money = 5;
    p2.hasTakenFirstTurn = true; // must have taken a turn to be hit directly; Armor Platoon has no Raid so damage is isolated
    const attacker = makeInstance(P1, "armor-platoon-x", "front"); // atk 3, no Raid
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [];
    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.state.players[P2]!.money).toBe(2); // 5 - 3
  });

  it("damage from multiple attackers does not stack on a single target (§10)", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    p2.hasTakenFirstTurn = true;
    const a1 = makeInstance(P1, "assembly-worker-x", "front"); // atk 1
    const a2 = makeInstance(P1, "assembly-worker-x", "front"); // atk 1
    const target = makeInstance(P2, "firewall-yoko", "front"); // def 4
    p1.frontRow = [a1, a2];
    p2.frontRow = [target];
    p2.backRow = [];

    // First attacker on the target, defender skips block: target takes 1 (def 3).
    let next = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: a1.instanceId, target: { kind: "card", instanceId: target.instanceId } }, cards).state;
    next = applyIntent(next, { kind: "skipBlock", player: P2, attackerId: a1.instanceId }, cards).state;
    let t = next.players[P2]!.frontRow.find((c) => c.instanceId === target.instanceId)!;
    expect(t.currentDef).toBe(3);
    // Second attacker on the same target: another separate 1 damage (def 2),
    // the two are NOT combined into 2-at-once.
    next = applyIntent(next, { kind: "declareAttack", player: P1, attackerId: a2.instanceId, target: { kind: "card", instanceId: target.instanceId } }, cards).state;
    next = applyIntent(next, { kind: "skipBlock", player: P2, attackerId: a2.instanceId }, cards).state;
    t = next.players[P2]!.frontRow.find((c) => c.instanceId === target.instanceId)!;
    expect(t.currentDef).toBe(2);
  });

  it("blocked combat deals damage to BOTH attacker and blocker", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "armor-platoon-x", "front"); // atk 3, def 4
    const blocker = makeInstance(P2, "data-yoko", "front"); // atk 1, def 2
    p1.frontRow = [attacker];
    p2.frontRow = [blocker];
    p2.backRow = [];

    const r1 = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: blocker.instanceId } }, cards);
    expect(r1.error, `declareAttack failed: ${r1.error?.message}`).toBeUndefined();

    const r2 = applyIntent(r1.state, { kind: "declareBlock", player: P2, attackerId: attacker.instanceId, blockerId: blocker.instanceId }, cards);
    expect(r2.error, `declareBlock failed: ${r2.error?.message}`).toBeUndefined();

    const a = r2.state.players[P1]!.frontRow.find((c) => c.instanceId === attacker.instanceId)!;
    expect(a.currentDef).toBe(4 - 1); // attacker takes blocker's ATK (1)
    expect(r2.state.players[P2]!.frontRow.some((c) => c.instanceId === blocker.instanceId)).toBe(false); // blocker destroyed (2 - 3 = -1)
  });

  it("blocked combat where both survive leaves both damaged on board", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "assembly-worker-x", "front"); // atk 1, def 2
    const blocker = makeInstance(P2, "assembly-worker-x", "front"); // atk 1, def 2
    p1.frontRow = [attacker];
    p2.frontRow = [blocker];
    p2.backRow = [];

    const r1 = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "card", instanceId: blocker.instanceId } }, cards);
    expect(r1.error, `declareAttack failed: ${r1.error?.message}`).toBeUndefined();

    const r2 = applyIntent(r1.state, { kind: "declareBlock", player: P2, attackerId: attacker.instanceId, blockerId: blocker.instanceId }, cards);
    expect(r2.error, `declareBlock failed: ${r2.error?.message}`).toBeUndefined();

    const a = r2.state.players[P1]!.frontRow.find((c) => c.instanceId === attacker.instanceId)!;
    const b = r2.state.players[P2]!.frontRow.find((c) => c.instanceId === blocker.instanceId)!;
    expect(a.currentDef).toBe(1); // 2 - 1 = 1
    expect(b.currentDef).toBe(1); // 2 - 1 = 1
  });

  it("a direct attack is illegal while the defender holds any back-row card (§8.3)", () => {
    const s = combatState();
    const p1 = s.players[P1]!;
    const p2 = s.players[P2]!;
    const attacker = makeInstance(P1, "armor-platoon-x", "front");
    const loc = makeInstance(P2, "strategic-reserve", "back");
    p1.frontRow = [attacker];
    p2.frontRow = [];
    p2.backRow = [loc];
    const r = applyIntent(s, { kind: "declareAttack", player: P1, attackerId: attacker.instanceId, target: { kind: "player", playerId: P2 } }, cards);
    expect(r.error?.code).toBe("BAD_TARGET");
  });
});
