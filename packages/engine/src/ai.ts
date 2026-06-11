import type {
  CardDef,
  CardInstance,
  GameState,
  Intent,
  PlayerId,
  TargetRef,
} from "@ew/shared";
import type { CardIndex } from "./index";
import { getLegalIntents, applyIntent } from "./reducer";
import { locate, opponentOf } from "./state";
import { peekPriv } from "./internal";
import { totalIncome, incomeSources } from "./economy";
import { effectiveAtk, effectiveDef, getLegalAttackTargets, reassemblePreview } from "./combat";

function def(cards: CardIndex, card: CardInstance): CardDef | undefined {
  return cards.byId.get(card.cardId);
}

function cardScore(state: GameState, card: CardInstance, cards: CardIndex): number {
  const d = def(cards, card);
  if (!d) return 0;
  let score = 0;
  score += (d.atk ?? 0) * 2;
  score += (d.def ?? 0) * 1.5;
  score += (d.income ?? 0) * 3;
  score += d.cost;
  if (d.keywords.includes("Raid")) score += 3;
  if (d.keywords.includes("Guardbreak")) score += 2;
  if (d.keywords.includes("Siege")) score += 1;
  if (d.keywords.includes("Reassemble")) score += 2;
  return score;
}

function enemyTargetScore(
  state: GameState,
  target: CardInstance,
  cards: CardIndex,
  aiPlayerId: PlayerId,
): number {
  const d = def(cards, target);
  if (!d) return 0;
  let score = cardScore(state, target, cards);
  if (d.income && d.income > 0 && target.row === "back") score += 5;
  if ((d.atk ?? 0) >= 3) score += 3;
  if (d.keywords.includes("Raid")) score += 4;
  return score;
}

function pickPlayCard(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const p = state.players[aiPlayerId]!;
  const playIntents = intents.filter((i) => i.kind === "playCard");
  // How established our economy already is. We want to secure a base of income
  // first, THEN pivot to developing threats so we actually have a win condition
  // (otherwise the AI just ramps income forever and never presses).
  const incomeCount = incomeSources(state, aiPlayerId, cards).length;
  const ECONOMY_TARGET = 2;

  const scored = playIntents.map((intent) => {
    const card = locate(state, intent.instanceId)?.card;
    if (!card) return { intent, score: 0, priority: 0 };
    const d = def(cards, card);
    if (!d) return { intent, score: 0, priority: 0 };

    const isIncome = d.income !== null && d.income > 0 && (d.type === "Location" || d.type === "Character");
    const isThreat = (d.type === "Character" && (d.atk ?? 0) >= 2) || d.type === "Vehicle";

    let priority = 4;
    let score = d.cost;

    if (isIncome && incomeCount < ECONOMY_TARGET) {
      priority = 1; // establish economy first
      score += d.income! * 10;
    } else if (isThreat) {
      priority = incomeCount >= ECONOMY_TARGET ? 1 : 2; // develop a win condition
      score += (d.atk ?? 0) * 5;
    } else if (isIncome) {
      priority = 2; // extra income beyond the base is still good, just not urgent
      score += d.income! * 6;
    } else if (d.type === "Ongoing") {
      priority = 3;
      score += 4;
    } else if (d.type === "Action") {
      priority = 3;
      score += actionTargetScore(state, intent as Extract<Intent, { kind: "playCard" }>, d, aiPlayerId, cards);
    }

    if (d.cost > p.money) score = -1;

    return { intent, score, priority };
  });

  scored.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.score - a.score;
  });

  const best = scored[0];
  return best && best.score >= 0 ? best.intent : null;
}

function actionTargetScore(
  state: GameState,
  intent: Extract<Intent, { kind: "playCard" }>,
  d: CardDef,
  aiPlayerId: PlayerId,
  cards: CardIndex,
): number {
  const opponent = opponentOf(state, aiPlayerId);
  const oppState = state.players[opponent]!;
  const targets = intent.targets;
  const firstTargetId = targets?.[0]?.kind === "card" ? targets[0].instanceId : null;

  switch (d.id) {
    case "system-shutdown": {
      const enemyChars = oppState.frontRow.filter((c) => def(cards, c)?.type === "Character");
      const best = maxBy(enemyChars, (c) => enemyTargetScore(state, c, cards, aiPlayerId));
      if (!best || !firstTargetId) return 0;
      return firstTargetId === best.instanceId ? enemyTargetScore(state, best, cards, aiPlayerId) : 0;
    }
    case "forced-liquidation": {
      const allEnemy = [...oppState.frontRow, ...oppState.backRow];
      const targets2 = allEnemy.filter((c) => c.exhausted);
      const best = maxBy(targets2, (c) => enemyTargetScore(state, c, cards, aiPlayerId));
      if (!best || !firstTargetId) return 0;
      return firstTargetId === best.instanceId ? 5 : 0;
    }
    case "protocol-purge": {
      const allOngoings = [...oppState.ongoing, ...state.players[aiPlayerId]!.ongoing];
      const best = maxBy(allOngoings, (c) => cardScore(state, c, cards));
      if (!best || !firstTargetId) return 0;
      return firstTargetId === best.instanceId ? 6 : 0;
    }
    case "infrastructure-audit-x": {
      const allLocs = [...oppState.backRow, ...state.players[aiPlayerId]!.backRow].filter((c) => def(cards, c)?.type === "Location");
      const best = maxBy(allLocs, (c) => cardScore(state, c, cards));
      if (!best || !firstTargetId) return 0;
      return firstTargetId === best.instanceId ? 7 : 0;
    }
    default:
      return 3;
  }
}

/**
 * We need to keep a READY front-row blocker (a guard walls the back row only
 * while unexhausted) when we have back-row income and the opponent has a
 * front-row attacker.
 */
function needsGuard(state: GameState, aiPlayerId: PlayerId, cards: CardIndex): boolean {
  const oppState = state.players[opponentOf(state, aiPlayerId)]!;
  const oppAttacker = oppState.frontRow.some((c) => {
    const d = def(cards, c);
    return (d?.type === "Character" || d?.type === "Vehicle") && (d?.atk ?? 0) >= 1;
  });
  return oppAttacker && incomeSources(state, aiPlayerId, cards).length > 0;
}

function pickAttack(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  let attackIntents = intents.filter((i) => i.kind === "declareAttack");
  if (attackIntents.length === 0) return null;

  // Reserve our STURDIEST front creature (effective DEF >= 3) as a ready blocker
  // when we must guard exposed income. A fragile attacker does more good
  // attacking — and dies as a guard anyway — so we still attack with those
  // (aggressive decks should race, not turtle behind a glass cannon).
  if (needsGuard(state, aiPlayerId, cards)) {
    const p = state.players[aiPlayerId]!;
    const readyFront = p.frontRow.filter((c) => getLegalAttackTargets(state, c.instanceId, cards).length > 0);
    const guard = maxBy(readyFront, (c) => effectiveDef(state, c, cards));
    if (guard && effectiveDef(state, guard, cards) >= 3) {
      attackIntents = attackIntents.filter((i) => i.attackerId !== guard.instanceId);
      if (attackIntents.length === 0) return null;
    }
  }

  const opponent = opponentOf(state, aiPlayerId);
  const oppState = state.players[opponent]!;

  const scored = attackIntents.map((intent) => {
    let score = 0;
    const attacker = locate(state, intent.attackerId)?.card;
    if (!attacker) return { intent, score: 0 };
    const attackerD = def(cards, attacker);
    const atk = effectiveAtk(state, attacker, cards);

    if (intent.target.kind === "player") {
      score += atk * 3;
    } else if (intent.target.kind === "card") {
      const target = locate(state, intent.target.instanceId)?.card;
      if (!target) return { intent, score: 0 };
      const targetD = def(cards, target);

      if (targetD?.income && targetD.income > 0 && target.row === "back") {
        score += 10;
      }
      if ((targetD?.atk ?? 0) >= 3) score += 5;
      if (targetD?.keywords.includes("Raid")) score += 6;

      const targetDef = effectiveDef(state, target, cards);
      if (targetDef <= atk) score += 8;
      else score += 2;

      if (attackerD?.keywords.includes("Raid") && oppState.hasTakenFirstTurn) {
        score += 4;
      }
    }

    return { intent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.intent ?? null;
}

function pickBlock(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const blockIntents = intents.filter((i) => i.kind === "declareBlock");
  const skipIntent = intents.find((i) => i.kind === "skipBlock");
  if (blockIntents.length === 0) return skipIntent ?? null;

  const p = state.players[aiPlayerId]!;
  const bestBlock = maxBy(blockIntents, (intent) => {
    const blocker = locate(state, intent.blockerId)?.card;
    const attacker = locate(state, intent.attackerId)?.card;
    if (!blocker || !attacker) return 0;

    const blockerD = def(cards, blocker);
    const attackerD = def(cards, attacker);
    const attackerAtk = effectiveAtk(state, attacker, cards);
    let score = 0;

    if (blockerD?.income && blockerD.income > 0 && blocker.row === "back") {
      score -= 5;
    }

    const incomingDamage = attackerAtk;
    if (incomingDamage >= p.money && p.money > 0) {
      score += 10;
    }

    if (attackerD?.keywords.includes("Raid") && p.hasTakenFirstTurn) {
      score += 8;
    }

    const blockerDef = effectiveDef(state, blocker, cards);
    if (blockerDef > attackerAtk) score += 3;
    if (blockerDef <= attackerAtk) score -= 2;

    return score;
  });

  if (bestBlock) {
    const blocker = locate(state, bestBlock.blockerId)?.card;
    if (blocker) {
      const blockerD = def(cards, blocker);
      const attacker = locate(state, bestBlock.attackerId)?.card;
      const attackerAtk = attacker ? effectiveAtk(state, attacker, cards) : 0;
      if (
        blockerD?.income && blockerD.income > 0 &&
        effectiveDef(state, blocker, cards) <= attackerAtk
      ) {
        return skipIntent ?? bestBlock;
      }
    }
    return bestBlock;
  }

  return skipIntent ?? null;
}

function pickMove(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const moveIntents = intents.filter((i) => i.kind === "moveCharacter");
  if (moveIntents.length === 0) return null;

  const p = state.players[aiPlayerId]!;
  const opp = opponentOf(state, aiPlayerId);
  const oppState = state.players[opp]!;
  const hasIncomeThreat = oppState.frontRow.some((c) => {
    const d = def(cards, c);
    return d?.keywords.includes("Siege") || (d?.keywords.includes("Raid") && oppState.hasTakenFirstTurn);
  });
  // A single front-row creature walls off the ENTIRE back row from normal
  // attackers. So if we have back-row income to protect and the opponent has a
  // front-row attacker, we must not vacate our front row.
  const oppHasAttacker = oppState.frontRow.some((c) => {
    const d = def(cards, c);
    return (d?.type === "Character" || d?.type === "Vehicle") && (d?.atk ?? 0) >= 1;
  });
  const backHasIncome = p.backRow.some((c) => (def(cards, c)?.income ?? 0) > 0);

  const scored = moveIntents.map((intent) => {
    const card = locate(state, intent.instanceId)?.card;
    if (!card) return { intent, score: 0 };
    const d = def(cards, card);
    if (!d) return { intent, score: 0 };

    let score = 0;
    if (intent.toRow === "back") {
      const fromFront = p.frontRow.some((c) => c.instanceId === intent.instanceId);
      const emptiesFront = fromFront && p.frontRow.length === 1;
      // Keep a front-row guard, but ONLY a non-income creature (a dedicated
      // blocker). Income creatures belong in the back earning money — stranding
      // one in front as a fragile "guard" both forfeits its income and gets it
      // killed. So suppress the move-to-back only for non-income guards.
      if (emptiesFront && oppHasAttacker && backHasIncome && (d.income ?? 0) === 0) {
        return { intent, score: -10 };
      }
      // Income creatures belong in the back, earning money behind the guard.
      if ((d.income ?? 0) > 0) {
        score += 5;
        if (hasIncomeThreat) score += 3;
      }
    }
    // Only push NON-income attackers to the front. Never pull an income creature
    // up to attack — that strands our economy AND exposes/loses our income (the
    // old behavior thrashed the same income card between rows and got it killed).
    if (intent.toRow === "front" && (d.atk ?? 0) >= 2 && (d.income ?? 0) === 0) {
      score += 3;
      if (p.frontRow.length === 0) score += 4;
    }
    return { intent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0 ? best.intent : null;
}

function pickRecycleResale(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const p = state.players[aiPlayerId]!;
  const resaleIntents = intents.filter(
    (i): i is Extract<Intent, { kind: "resale" }> => i.kind === "resale",
  );
  const recycleIntents = intents.filter(
    (i): i is Extract<Intent, { kind: "recycle" }> => i.kind === "recycle",
  );

  // When selling or cycling, give up the LEAST valuable card in hand so we keep
  // our bombs and income cards.
  const discardScore = (id: string): number => {
    const card = locate(state, id)?.card;
    return card ? cardScore(state, card, cards) : 0;
  };
  const resale = maxBy(resaleIntents, (i) => -discardScore(i.discardInstanceId));
  const recycle = maxBy(recycleIntents, (i) => -discardScore(i.discardInstanceId));

  // No income source in play means we'd lose the moment money hits 0 at end of turn.
  const hasIncome = incomeSources(state, aiPlayerId, cards).length > 0;

  // We only reach here when there was nothing worth playing (pickPlayCard ran first).
  // 1. SURVIVAL: with no income, never end the turn broke. Sell a spare card to
  //    bank money. NEVER recycle while poor — recycling COSTS money and can strand
  //    us at 0, which is a guaranteed loss at the end-of-turn check.
  if (!hasIncome && p.money <= 1) return resale ?? null;

  // 2. Dig for something playable, but only when we can spare the money (recycle
  //    costs 1; keep a buffer of >=2 afterward).
  if (p.money >= 3 && recycle) return recycle;

  // 3. No income and a dead hand: turn a stranded card into money rather than pass.
  //    (The search AI already resales aggressively on its own — its eval rewards
  //    +1 money over ~0.4 hand value — so no extra greedy clause is needed here;
  //    an A/B of one was a confirmed no-op.)
  if (!hasIncome && resale) return resale;

  return null;
}

function pickGuardbreak(
  intents: Intent[],
  aiPlayerId: PlayerId,
): Intent | null {
  const gbIntents = intents.filter((i) => i.kind === "guardbreakChoice");
  if (gbIntents.length === 0) return null;

  let best: Intent | null = null;
  let bestScore = -1;
  for (const intent of gbIntents) {
    if (intent.kind !== "guardbreakChoice") continue;
    const score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  return best;
}

function pickReassemble(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const reassembleIntents = intents.filter(
    (i): i is Extract<Intent, { kind: "reassembleChoice" }> => i.kind === "reassembleChoice",
  );
  if (reassembleIntents.length === 0) return null;

  // A card waiting to Reassemble has been removed from the board (row = null) and
  // lives in the internal reassemble queue, NOT in any player zone — so locate()
  // can't find it. Look in the queue too. Also note the engine only offers a
  // pay:true option when the controller can already afford the cost.
  const queue = peekPriv(state).reassembleQueue ?? [];
  const findCard = (instanceId: string): CardInstance | undefined =>
    locate(state, instanceId)?.card ?? queue.find((q) => q.card.instanceId === instanceId)?.card;

  for (const intent of reassembleIntents) {
    if (!intent.pay) continue;
    const card = findCard(intent.instanceId);
    const d = card ? def(cards, card) : undefined;
    // Affordable (the engine guarantees it) — pay to bring back any card with
    // real value (every v1.1 Reassemble card qualifies; income cards especially,
    // since restoring an income source keeps us out of the loss condition). If we
    // somehow can't read the card, still take the (already-affordable) offer.
    if (!d || (d.atk ?? 0) + (d.income ?? 0) >= 1) {
      return intent;
    }
  }

  // Nothing worth paying for — decline (clears the queue).
  return reassembleIntents.find((i) => !i.pay) ?? null;
}

/**
 * Black Market Exchange: "destroy a character you control to gain 2 money."
 * The naive AI used to sac the first available creature every turn — a blunder
 * that threw away bodies for a measly 2. This picks a sac only when it's
 * genuinely profitable, and returns null otherwise (so the AI develops instead).
 *
 * Profitable, in priority order:
 *   3. Sac-and-recur: target has Reassemble we can afford NOW (the engine checks
 *      money BEFORE the +2 is granted, so we must already hold the cost) and the
 *      net cost is <= 1 — the body returns (at -1 DEF) and we bank money for free.
 *   2. Doomed body: a non-income creature about to die anyway (DEF <= 1) — turn
 *      it into 2 money before it's destroyed for nothing.
 *   1. Desperation: low on money (<= 1) with an expendable low-value non-income
 *      body to spare — take the cash.
 * Never sac our last income source.
 */
function pickBlackMarket(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const acts = intents.filter(
    (i): i is Extract<Intent, { kind: "activateAbility" }> =>
      i.kind === "activateAbility" && i.abilityId === "destroy-for-2",
  );
  if (acts.length === 0) return null;
  const p = state.players[aiPlayerId]!;
  const incomeCount = incomeSources(state, aiPlayerId, cards).length;

  const targetOf = (i: Extract<Intent, { kind: "activateAbility" }>): CardInstance | undefined => {
    const t = i.targets?.[0];
    return t && t.kind === "card" ? locate(state, t.instanceId)?.card : undefined;
  };

  let best: { intent: Intent; priority: number; tie: number } | null = null;
  for (const intent of acts) {
    const tgt = targetOf(intent);
    const d = tgt ? def(cards, tgt) : undefined;
    if (!tgt || !d) continue;
    const isIncome = (d.income ?? 0) > 0 && tgt.row === "back";
    if (isIncome && incomeCount <= 1) continue; // never sac our last earner

    let priority = 0;
    let tie = 0;
    const recur = reassemblePreview(state, tgt, cards);
    const curDef = effectiveDef(state, tgt, cards);
    const damaged = tgt.currentDef != null && tgt.currentDef < (d.def ?? 0);
    if (recur.eligible && recur.cost <= 1 && p.money >= recur.cost) {
      priority = 3;
      tie = -recur.cost; // cheaper recur = more profit
    } else if (curDef <= 1 && damaged && !isIncome) {
      priority = 2;
      tie = -cardScore(state, tgt, cards); // bank a body that's already dying
    } else if (p.money <= 1 && !isIncome && (d.atk ?? 0) <= 1 && !recur.eligible) {
      priority = 1;
      tie = -cardScore(state, tgt, cards); // sac the least valuable filler for cash
    } else {
      continue; // not worth sacking a healthy, valuable body
    }

    if (!best || priority > best.priority || (priority === best.priority && tie > best.tie)) {
      best = { intent, priority, tie };
    }
  }
  return best?.intent ?? null;
}

/**
 * Data Yoko Fortify: exhaust a ready Data Yoko to give a character +1 DEF until
 * your next turn. It's a DEFENSIVE pre-buff (cast on your Build, it protects
 * through the opponent's attack), so only use it when the opponent actually has
 * a board/hand to threaten with, and stack it on our sturdiest front-row blocker
 * (or, lacking one, our best back-row earner). Returns null otherwise.
 */
function pickFortify(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const acts = intents.filter(
    (i): i is Extract<Intent, { kind: "activateAbility" }> =>
      i.kind === "activateAbility" && i.abilityId === "fortify",
  );
  if (acts.length === 0) return null;
  const opp = state.players[opponentOf(state, aiPlayerId)]!;
  const oppThreat = opp.frontRow.some((c) => (def(cards, c)?.atk ?? 0) >= 1) || opp.hand.length > 0;
  if (!oppThreat) return null; // no incoming attack to brace for

  const targetCard = (i: Extract<Intent, { kind: "activateAbility" }>): CardInstance | undefined => {
    const t = i.targets?.[0];
    return t && t.kind === "card" ? locate(state, t.instanceId)?.card : undefined;
  };

  let best: { intent: Intent; score: number } | null = null;
  for (const intent of acts) {
    const tgt = targetCard(intent);
    if (!tgt) continue;
    // Prefer front-row blockers (they take the hits), weight by sturdiness; a
    // back-row earner is a fallback (protect the economy). Skip self-targeting
    // a back-row Data Yoko with nothing to brace.
    const front = tgt.row === "front";
    const score = effectiveDef(state, tgt, cards) + (front ? 5 : 0);
    if (!best || score > best.score) best = { intent, score };
  }
  return best?.intent ?? null;
}

/**
 * Assembly Worker X Rally: exhaust a ready Worker to give a character +1 ATK
 * until your next turn. It's OFFENSIVE, so only use it on a front-row attacker
 * that can actually swing this turn (the +1 lands as extra damage/steal), and
 * pump the hardest hitter. Returns null if nothing can capitalize on it.
 */
function pickRally(
  state: GameState,
  intents: Intent[],
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  const acts = intents.filter(
    (i): i is Extract<Intent, { kind: "activateAbility" }> =>
      i.kind === "activateAbility" && i.abilityId === "rally",
  );
  if (acts.length === 0) return null;

  const targetCard = (i: Extract<Intent, { kind: "activateAbility" }>): CardInstance | undefined => {
    const t = i.targets?.[0];
    return t && t.kind === "card" ? locate(state, t.instanceId)?.card : undefined;
  };

  let best: { intent: Intent; score: number } | null = null;
  for (const intent of acts) {
    const tgt = targetCard(intent);
    if (!tgt || tgt.row !== "front") continue;
    if (getLegalAttackTargets(state, tgt.instanceId, cards).length === 0) continue; // can't swing -> wasted
    const score = effectiveAtk(state, tgt, cards);
    if (!best || score > best.score) best = { intent, score };
  }
  return best?.intent ?? null;
}

/** Lightweight position score for `me` (money + income + board, minus opponent). */
function quickScore(state: GameState, me: PlayerId, cards: CardIndex): number {
  if (state.winnerId === me) return 1e6;
  if (state.winnerId) return -1e6;
  const opp = opponentOf(state, me);
  const sideScore = (pid: PlayerId): number => {
    const p = state.players[pid]!;
    let v = p.money + incomeSources(state, pid, cards).length * 5 + p.hand.length * 0.5;
    for (const c of [...p.frontRow, ...p.backRow]) {
      v += effectiveAtk(state, c, cards) + effectiveDef(state, c, cards);
    }
    return v;
  };
  return sideScore(me) - sideScore(opp);
}

/** Does the AI have at least one ready front-row attacker with a legal target? */
function hasAttack(state: GameState, aiPlayerId: PlayerId, cards: CardIndex): boolean {
  const p = state.players[aiPlayerId]!;
  return p.frontRow.some((c) => getLegalAttackTargets(state, c.instanceId, cards).length > 0);
}

function maxBy<T>(items: T[], score: (item: T) => number): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

/**
 * A "free" Optimize: the source is a BACK-row income creature, so it can't
 * attack or block from there anyway and (exhausted still earns) keeps its passive
 * income — taking it is a costless +1. Returns such an optimize intent if one is
 * on the table, else null. Shared by the heuristic and the search so both bank
 * the free money instead of advancing past it.
 */
export function freeOptimizeFrom(
  state: GameState,
  candidates: Intent[],
  cards: CardIndex,
): Intent | null {
  if (state.phase !== "income") return null;
  for (const i of candidates) {
    if (i.kind !== "optimize") continue;
    const c = locate(state, i.instanceId)?.card;
    const d = c ? def(cards, c) : undefined;
    if (c && c.row === "back" && (d?.income ?? 0) > 0) return i;
  }
  return null;
}

export function pickAIIntent(
  state: GameState,
  aiPlayerId: PlayerId,
  cards: CardIndex,
): Intent | null {
  // The AI never voluntarily concedes — playing the position out is never worse
  // (the opponent may misplay, and a pessimistic read may be wrong). Conceding
  // also poisons search rollouts, so drop it before any decision logic.
  const intents = getLegalIntents(state, aiPlayerId, cards).filter((i) => i.kind !== "concede");
  if (intents.length === 0) return null;

  // Pending modal/dilemma: pick the option best for us (1-ply greedy). Works for
  // both "choose one" (caster) and "least-bad" (opponent dilemma).
  const choiceIntents = intents.filter((i) => i.kind === "resolveChoice");
  if (choiceIntents.length > 0) {
    return maxBy(choiceIntents, (ci) => {
      const r = applyIntent(state, ci, cards);
      return r.error ? -Infinity : quickScore(r.state, aiPlayerId, cards);
    }) ?? choiceIntents[0]!;
  }

  const phaseIntents = intents.filter(
    (i) => i.kind === "advancePhase" || i.kind === "endTurn",
  );

  if (state.phase === "start") {
    const mulligan = intents.find((i) => i.kind === "mulligan" && i.keep);
    if (mulligan) return mulligan;
  }

  if (state.phase === "income") {
    const free = freeOptimizeFrom(state, intents, cards);
    if (free) return free; // bank costless +1 from back-row earners
    const optimizeIntents = intents.filter((i) => i.kind === "optimize");
    if (optimizeIntents.length > 0) {
      const nextIncome = totalIncome(state, aiPlayerId, cards);
      if (nextIncome === 0) {
        return optimizeIntents[0]!; // desperation: any optimize beats $0 income
      }
    }
    return phaseIntents.find((i) => i.kind === "advancePhase") ?? null;
  }

  if (state.phase === "build") {
    const reassemble = pickReassemble(state, intents, aiPlayerId, cards);
    if (reassemble) return reassemble;

    const guardbreak = pickGuardbreak(intents, aiPlayerId);
    if (guardbreak) return guardbreak;

    const play = pickPlayCard(state, intents, aiPlayerId, cards);
    if (play) return play;

    const blackMarket = pickBlackMarket(state, intents, aiPlayerId, cards);
    if (blackMarket) return blackMarket;

    const move = pickMove(state, intents, aiPlayerId, cards);
    if (move) return move;

    const fortify = pickFortify(state, intents, aiPlayerId, cards);
    if (fortify) return fortify;

    const rally = pickRally(state, intents, aiPlayerId, cards);
    if (rally) return rally;

    const recycleResale = pickRecycleResale(state, intents, aiPlayerId, cards);
    if (recycleResale) return recycleResale;

    // If we have an attack available, advance to Combat to make it — DON'T end
    // the turn from Build (that skips Combat entirely, so the AI would never
    // attack and games would stall forever).
    if (hasAttack(state, aiPlayerId, cards)) {
      const adv = phaseIntents.find((i) => i.kind === "advancePhase");
      if (adv) return adv;
    }
    return phaseIntents.find((i) => i.kind === "endTurn") ??
           phaseIntents.find((i) => i.kind === "advancePhase") ?? null;
  }

  if (state.phase === "combat") {
    const reassemble = pickReassemble(state, intents, aiPlayerId, cards);
    if (reassemble) return reassemble;

    const guardbreak = pickGuardbreak(intents, aiPlayerId);
    if (guardbreak) return guardbreak;

    const isDefender = aiPlayerId !== state.activePlayerId;
    if (isDefender) {
      const block = pickBlock(state, intents, aiPlayerId, cards);
      if (block) return block;
    } else {
      const attack = pickAttack(state, intents, aiPlayerId, cards);
      if (attack) return attack;
    }

    return phaseIntents.find((i) => i.kind === "endTurn") ??
           phaseIntents.find((i) => i.kind === "advancePhase") ?? null;
  }

  return phaseIntents[0] ?? intents[0] ?? null;
}
