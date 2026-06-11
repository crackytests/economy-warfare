import type {
  CardDef,
  CardInstance,
  GameState,
  Intent,
  PlayerId,
  PlayerState,
  TargetRef,
} from "@ew/shared";
import { SETUP } from "@ew/shared";
import type { ApplyResult, CardIndex } from "./index";
import {
  discardCard,
  locate,
  opponentOf,
  pushEvent,
  removeFromZone,
} from "./state";
import { gainMoney, loseMoney, payCost } from "./economy";
import { peekPriv, priv } from "./internal";

const err = (state: GameState, code: string, message: string): ApplyResult => ({
  state,
  events: [],
  error: { code, message },
});

export function beginCombat(state: GameState): void {
  priv(state).combat = { attacksThisCombat: 0 };
}

export function clearCombat(state: GameState): void {
  delete priv(state).combat;
}

function def(cards: CardIndex, card: CardInstance): CardDef | undefined {
  return cards.byId.get(card.cardId);
}

function allInPlay(p: PlayerState): CardInstance[] {
  return [...p.frontRow, ...p.backRow, ...p.ongoing];
}

function hasOngoing(p: PlayerState, cardId: string): boolean {
  return p.ongoing.some((c) => c.cardId === cardId);
}

/**
 * Combat rules toggles (for balance experiments). Defaults match v1.1 rules.
 * `allowDirectAttacks`: when false, attackers can only target cards — you cannot
 *   attack the opposing player directly (money is only lost via Raid/effects).
 * `directAttackNeedsFirstTurn`: when true, you cannot attack a player directly
 *   until they have taken their first turn (extends first-turn protection from
 *   Raid to all direct damage).
 */
export const COMBAT_CONFIG = { allowDirectAttacks: true, directAttackNeedsFirstTurn: true, damagePersists: true };

/** Whether the defending player may be hit directly right now, per COMBAT_CONFIG. */
function canHitPlayerDirectly(defender: PlayerState): boolean {
  if (!COMBAT_CONFIG.allowDirectAttacks) return false;
  if (COMBAT_CONFIG.directAttackNeedsFirstTurn && !defender.hasTakenFirstTurn) return false;
  return true;
}

export function effectiveAtk(state: GameState, card: CardInstance, cards: CardIndex): number {
  const d = def(cards, card);
  let atk = d?.atk ?? 0;
  atk += card.tempAtkModifier ?? 0;
  atk += card.atkBonusUntilNextTurn ?? 0;
  const controller = state.players[card.controllerId]!;
  if (d?.type === "Vehicle" && allInPlay(controller).some((c) => c.cardId === "director-x")) {
    atk += 1;
  }
  return Math.max(0, atk);
}

export function effectiveDef(state: GameState, card: CardInstance, cards: CardIndex): number {
  const d = def(cards, card);
  if (d?.def == null || card.currentDef == null) return 0;
  let value = card.currentDef + (card.tempDefModifier ?? 0) + (card.defBonusUntilNextTurn ?? 0);
  const controller = state.players[card.controllerId]!;
  if (card.row === "front" && hasOngoing(controller, "predictive-shielding") && d.type === "Character") {
    value += 1;
  }
  if (card.row === "back" && hasOngoing(controller, "network-bloom") && d.faction === "Linda Bioroids") {
    value += 1;
  }
  // Treasury Yoko: while its controller has 8+ money, their characters get +1 DEF.
  if (d.type === "Character" && controller.money >= 8 && allInPlay(controller).some((c) => c.cardId === "treasury-yoko")) {
    value += 1;
  }
  // Replicant Chorus: other Linda Bioroids you control get +1 DEF.
  if (d.faction === "Linda Bioroids" && allInPlay(controller).some((c) => c.cardId === "replicant-chorus" && c.instanceId !== card.instanceId)) {
    value += 1;
  }
  return value;
}

function canAttack(state: GameState, card: CardInstance, cards: CardIndex): boolean {
  const d = def(cards, card);
  if (!d) return false;
  if (card.row !== "front" || card.exhausted || card.cannotAttack) return false;
  if (d.type !== "Character" && d.type !== "Vehicle") return false;
  if (card.cardId === "accountant-yoko") return false;
  return effectiveAtk(state, card, cards) > 0;
}

function canBlock(card: CardInstance, cards: CardIndex): boolean {
  const d = def(cards, card);
  if (!d) return false;
  if (card.row !== "front" || card.exhausted || card.cannotBlock) return false;
  if (d.type !== "Character" && d.type !== "Vehicle") return false;
  if (card.cardId === "afterimage-lurker") return false;
  return true;
}

function hasGuardbreak(card: CardInstance, cards: CardIndex): boolean {
  return def(cards, card)?.keywords.includes("Guardbreak") || (card as CardInstance & { tempGuardbreak?: boolean }).tempGuardbreak === true;
}

export function getLegalAttackTargets(
  state: GameState,
  attackerInstanceId: string,
  cards: CardIndex,
): TargetRef[] {
  const loc = locate(state, attackerInstanceId);
  if (!loc || !canAttack(state, loc.card, cards)) return [];

  const attackerDef = def(cards, loc.card);
  if (!attackerDef) return [];

  const defender = state.players[opponentOf(state, loc.card.controllerId)]!;
  const targets: TargetRef[] = [];
  const defenderHasBlockableFront = defender.frontRow.some((c) => canBlock(c, cards));
  const defenderHasBack = defender.backRow.length > 0;

  if (defender.frontRow.length > 0) {
    targets.push(...defender.frontRow.map((c) => ({ kind: "card" as const, instanceId: c.instanceId })));
  }

  const canReachBack = !defenderHasBlockableFront || attackerDef.keywords.includes("Siege");
  if (canReachBack && defenderHasBack) {
    targets.push(...defender.backRow.map((c) => ({ kind: "card" as const, instanceId: c.instanceId })));
  }

  if (!defenderHasBlockableFront && !defenderHasBack && canHitPlayerDirectly(defender)) {
    targets.push({ kind: "player", playerId: defender.id });
  }

  return targets;
}

function sameTarget(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "card" ? a.instanceId === (b as Extract<TargetRef, { kind: "card" }>).instanceId : a.playerId === (b as Extract<TargetRef, { kind: "player" }>).playerId;
}

export function applyCombatIntent(state: GameState, intent: Intent, cards: CardIndex): ApplyResult | null {
  switch (intent.kind) {
    case "declareAttack":
      return declareAttack(state, intent, cards);
    case "guardbreakChoice":
      return guardbreakChoice(state, intent, cards);
    case "declareBlock":
      return declareBlock(state, intent, cards);
    case "skipBlock":
      return skipBlock(state, intent, cards);
    case "reassembleChoice":
      return reassembleChoice(state, intent, cards);
    default:
      return null;
  }
}

function declareAttack(
  state: GameState,
  intent: Extract<Intent, { kind: "declareAttack" }>,
  cards: CardIndex,
): ApplyResult {
  if (state.phase !== "combat") return err(state, "BAD_PHASE", "Attacks are declared during Combat.");
  if (intent.player !== state.activePlayerId) return err(state, "NOT_ACTIVE", "Only the active player declares attacks.");
  const combat = priv(state).combat ?? (priv(state).combat = { attacksThisCombat: 0 });
  if (combat.pendingAttack) return err(state, "COMBAT_PENDING", "Resolve the current attack first.");

  const loc = locate(state, intent.attackerId);
  if (!loc || loc.controller.id !== intent.player || !canAttack(state, loc.card, cards)) {
    return err(state, "BAD_ATTACKER", "That card cannot attack.");
  }
  const legal = getLegalAttackTargets(state, loc.card.instanceId, cards);
  if (!legal.some((t) => sameTarget(t, intent.target))) {
    return err(state, "BAD_TARGET", "That is not a legal attack target.");
  }

  loc.card.exhausted = true;
  combat.attacksThisCombat += 1;
  combat.pendingAttack = { attackerId: loc.card.instanceId, target: intent.target };
  pushEvent(state, "attack", `${loc.controller.name} attacks with ${def(cards, loc.card)?.name ?? loc.card.cardId}.`, {
    playerId: loc.controller.id,
    data: { attackerId: loc.card.instanceId, target: intent.target },
  });

  const defender = state.players[opponentOf(state, intent.player)]!;
  if (hasGuardbreak(loc.card, cards) && defender.frontRow.some((c) => canBlock(c, cards))) {
    return { state, events: [] };
  }
  if (!defender.frontRow.some((c) => canBlock(c, cards))) {
    resolveAttack(state, undefined, cards);
  }
  return { state, events: [] };
}

function guardbreakChoice(
  state: GameState,
  intent: Extract<Intent, { kind: "guardbreakChoice" }>,
  cards: CardIndex,
): ApplyResult {
  const pending = priv(state).combat?.pendingAttack;
  if (!pending || pending.attackerId !== intent.attackerId) return err(state, "NO_ATTACK", "No matching attack is pending.");
  if (intent.player !== state.activePlayerId) return err(state, "NOT_ACTIVE", "Only the attacker chooses Guardbreak.");
  const attacker = locate(state, intent.attackerId)?.card;
  if (!attacker || !hasGuardbreak(attacker, cards)) {
    return err(state, "NO_GUARDBREAK", "That attacker does not have Guardbreak.");
  }
  const loc = locate(state, intent.cannotBlockId);
  const defenderId = opponentOf(state, intent.player);
  if (!loc || loc.controller.id !== defenderId || loc.zone !== "front" || !canBlock(loc.card, cards)) {
    return err(state, "BAD_TARGET", "Guardbreak must choose a ready enemy front-row blocker.");
  }
  pending.cannotBlockId = intent.cannotBlockId;
  pushEvent(state, "guardbreak", `${def(cards, attacker)?.name ?? attacker.cardId} breaks a guard.`, {
    playerId: intent.player,
    data: { attackerId: intent.attackerId, cannotBlockId: intent.cannotBlockId },
  });
  return { state, events: [] };
}

function declareBlock(
  state: GameState,
  intent: Extract<Intent, { kind: "declareBlock" }>,
  cards: CardIndex,
): ApplyResult {
  const pending = priv(state).combat?.pendingAttack;
  if (!pending || pending.attackerId !== intent.attackerId) return err(state, "NO_ATTACK", "No matching attack is pending.");
  if (intent.player !== opponentOf(state, state.activePlayerId)) return err(state, "NOT_DEFENDER", "Only the defender blocks.");
  if (pending.cannotBlockId === intent.blockerId) return err(state, "GROUNDED_BY_GUARDBREAK", "That character cannot block this attack.");
  const loc = locate(state, intent.blockerId);
  if (!loc || loc.controller.id !== intent.player || !canBlock(loc.card, cards)) {
    return err(state, "BAD_BLOCKER", "That card cannot block.");
  }
  resolveAttack(state, loc.card.instanceId, cards);
  return { state, events: [] };
}

function skipBlock(
  state: GameState,
  intent: Extract<Intent, { kind: "skipBlock" }>,
  cards: CardIndex,
): ApplyResult {
  const pending = priv(state).combat?.pendingAttack;
  if (!pending || pending.attackerId !== intent.attackerId) return err(state, "NO_ATTACK", "No matching attack is pending.");
  if (intent.player !== opponentOf(state, state.activePlayerId)) return err(state, "NOT_DEFENDER", "Only the defender skips blocks.");
  resolveAttack(state, undefined, cards);
  return { state, events: [] };
}

function reassembleChoice(
  state: GameState,
  intent: Extract<Intent, { kind: "reassembleChoice" }>,
  cards: CardIndex,
): ApplyResult {
  const q = priv(state).reassembleQueue ?? [];
  const idx = q.findIndex((x) => x.card.instanceId === intent.instanceId && x.controllerId === intent.player);
  if (idx < 0) return err(state, "NO_REASSEMBLE", "That card is not waiting to Reassemble.");
  const prompt = q.splice(idx, 1)[0]!;
  const player = state.players[prompt.controllerId]!;
  const d = def(cards, prompt.card)!;
  if (!intent.pay) {
    discardCard(state, prompt.card);
    pushEvent(state, "destroy", `${d.name} is destroyed.`, { playerId: player.id, data: { instanceId: prompt.card.instanceId } });
    return { state, events: [] };
  }
  const cost = prompt.cost;
  if (player.money < cost) {
    q.splice(idx, 0, prompt);
    return err(state, "CANT_AFFORD", "Not enough money to Reassemble.");
  }
  payCost(player, cost);
  prompt.card.row = "back";
  prompt.card.exhausted = true;
  prompt.card.reassembledCount = (prompt.card.reassembledCount ?? 0) + 1;
  prompt.card.defPenaltyFromReassemble = (prompt.card.defPenaltyFromReassemble ?? 0) + 1;
  prompt.card.currentDef = (d.def ?? 0) - (prompt.card.defPenaltyFromReassemble ?? 0);
  player.backRow.push(prompt.card);
  pushEvent(state, "reassemble", `${d.name} Reassembles in the back row.`, {
    playerId: player.id,
    data: { instanceId: prompt.card.instanceId, cost },
  });
  return { state, events: [] };
}

function resolveAttack(state: GameState, blockerId: string | undefined, cards: CardIndex): void {
  const combat = priv(state).combat;
  const pending = combat?.pendingAttack;
  if (!combat || !pending) return;
  const attackerLoc = locate(state, pending.attackerId);
  if (!attackerLoc) {
    delete combat.pendingAttack;
    return;
  }
  const attacker = attackerLoc.card;
  const attackerDef = def(cards, attacker);
  const attackerAtk = effectiveAtk(state, attacker, cards);
  const defenderId = opponentOf(state, attacker.controllerId);
  const defender = state.players[defenderId]!;
  const blocker = blockerId ? locate(state, blockerId)?.card : undefined;

  if (blocker) {
    blocker.currentDef = (blocker.currentDef ?? 0) - attackerAtk;
    attacker.currentDef = (attacker.currentDef ?? 0) - effectiveAtk(state, blocker, cards);
    if (hasOngoing(state.players[attacker.controllerId]!, "latency-hex")) {
      losePlayerMoney(state, defender.id, 1, cards, { reason: "latency-hex" });
    }
    maybeRaid(state, attacker, defender.id, cards, false);
    pushEvent(state, "block", `${def(cards, blocker)?.name ?? blocker.cardId} blocks ${attackerDef?.name ?? attacker.cardId}.`, {
      playerId: defender.id,
      data: { attackerId: attacker.instanceId, blockerId: blocker.instanceId },
    });
  } else if (pending.target.kind === "card") {
    const target = locate(state, pending.target.instanceId)?.card;
    if (target) {
      target.currentDef = (target.currentDef ?? 0) - attackerAtk;
      maybeRaid(state, attacker, defender.id, cards, true);
      pushEvent(state, "damage", `${attackerDef?.name ?? attacker.cardId} deals ${attackerAtk} damage.`, {
        playerId: attacker.controllerId,
        data: { attackerId: attacker.instanceId, targetId: target.instanceId, damage: attackerAtk },
      });
    }
  } else {
    losePlayerMoney(state, defender.id, attackerAtk, cards, { reason: "direct" });
    maybeRaid(state, attacker, defender.id, cards, true);
    pushEvent(state, "damage", `${attackerDef?.name ?? attacker.cardId} hits ${defender.name} directly for ${attackerAtk}.`, {
      playerId: attacker.controllerId,
      data: { attackerId: attacker.instanceId, defenderId: defender.id, damage: attackerAtk },
    });
  }

  destroyDead(state, cards);
  delete combat.pendingAttack;
}

function maybeRaid(
  state: GameState,
  attacker: CardInstance,
  defenderId: PlayerId,
  cards: CardIndex,
  unblocked: boolean,
): void {
  const d = def(cards, attacker);
  const tempRaid = (attacker as CardInstance & { tempRaidValue?: number }).tempRaidValue;
  if (!d) return;
  if (!d?.keywords.includes("Raid") && tempRaid === undefined) return;
  const defender = state.players[defenderId]!;
  if (!defender.hasTakenFirstTurn) return;
  if (attacker.cardId === "desync-skirmisher" && !unblocked) return;
  if (attacker.cardId === "market-eater" && (priv(state).combat?.attacksThisCombat ?? 0) < 3) return;
  const raid = tempRaid ?? d.raidValue ?? 1;
  const lost = losePlayerMoney(state, defenderId, raid, cards, { reason: "raid" });
  if (lost > 0) {
    gainMoney(state.players[attacker.controllerId]!, lost);
    pushEvent(state, "raid", `${d.name} steals ${lost} money.`, {
      playerId: attacker.controllerId,
      data: { attackerId: attacker.instanceId, defenderId, stolen: lost },
    });
  }
}

export function losePlayerMoney(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  cards: CardIndex,
  opts?: { reason?: string },
): number {
  let n = Math.max(0, amount);
  const p = state.players[playerId]!;
  const meta = priv(state);
  if (opts?.reason === "raid" && hasOngoing(p, "black-budget") && !meta.blackBudgetUsedThisTurn?.[playerId]) {
    n = Math.max(0, n - 1);
    meta.blackBudgetUsedThisTurn ??= {};
    meta.blackBudgetUsedThisTurn[playerId] = true;
  }
  const lost = loseMoney(p, n);
  if (lost > 0) {
    const opponent = state.players[opponentOf(state, playerId)]!;
    if (hasOngoing(opponent, "reality-leak") && !meta.moneyLossThisTurn?.[playerId]) {
      meta.moneyLossThisTurn ??= {};
      meta.moneyLossThisTurn[playerId] = true;
      return lost + loseMoney(p, 1);
    }
    meta.moneyLossThisTurn ??= {};
    meta.moneyLossThisTurn[playerId] = true;
  }
  void cards;
  return lost;
}

export function destroyCard(state: GameState, card: CardInstance, cards: CardIndex): void {
  const loc = locate(state, card.instanceId);
  if (!loc || (loc.zone !== "front" && loc.zone !== "back" && loc.zone !== "ongoing")) return;
  const zone = loc.zone === "front" ? loc.controller.frontRow : loc.zone === "back" ? loc.controller.backRow : loc.controller.ongoing;
  const removed = removeFromZone(zone, card.instanceId);
  if (!removed) return;
  removed.row = null;
  const d = def(cards, removed);

  // Tokens (Fork/copy) are exiled, not discarded, and never Reassemble.
  if (removed.isToken) {
    pushEvent(state, "destroy", `${d?.name ?? removed.cardId} (copy) is destroyed.`, {
      playerId: loc.controller.id,
      data: { instanceId: removed.instanceId, cardId: removed.cardId },
    });
    return;
  }

  const meta = priv(state);
  if (
    d?.type === "Character" &&
    hasOngoing(loc.controller, "emergency-protocols") &&
    !meta.emergencyProtocolTriggeredThisTurn?.[loc.controller.id]
  ) {
    meta.emergencyDiscount ??= {};
    meta.emergencyDiscount[loc.controller.id] = Math.max(meta.emergencyDiscount[loc.controller.id] ?? 0, 1);
    meta.emergencyProtocolTriggeredThisTurn ??= {};
    meta.emergencyProtocolTriggeredThisTurn[loc.controller.id] = true;
  }

  const cost = reassembleCost(state, removed, cards, true);
  if (canReassemble(state, removed, cards, cost)) {
    priv(state).reassembleQueue ??= [];
    priv(state).reassembleQueue!.push({ card: removed, controllerId: loc.controller.id, cost });
    pushEvent(state, "reassemblePrompt", `${d?.name ?? removed.cardId} can Reassemble.`, {
      playerId: loc.controller.id,
      data: { instanceId: removed.instanceId },
    });
    return;
  }

  discardCard(state, removed);
  pushEvent(state, "destroy", `${d?.name ?? removed.cardId} is destroyed.`, {
    playerId: loc.controller.id,
    data: { instanceId: removed.instanceId, cardId: removed.cardId },
  });
}

export function destroyDead(state: GameState, cards: CardIndex): void {
  let guard = 0;
  let found = true;
  while (found && guard++ < 64) {
    found = false;
    for (const pid of state.turnOrder) {
      const p = state.players[pid]!;
      for (const c of [...p.frontRow, ...p.backRow]) {
        if (c.currentDef != null && effectiveDef(state, c, cards) <= 0) {
          destroyCard(state, c, cards);
          found = true;
        }
      }
    }
  }
}

/**
 * Preview whether `card` would Reassemble if destroyed now, and at what cost —
 * WITHOUT the money check (callers decide affordability) and without consuming
 * the once-per-turn free-Linda discount. For AI planning (e.g. Black Market
 * Exchange sac-and-recur). `cost` is meaningless when `eligible` is false.
 */
export function reassemblePreview(
  state: GameState,
  card: CardInstance,
  cards: CardIndex,
): { eligible: boolean; cost: number } {
  const d = def(cards, card);
  if (!d?.keywords.includes("Reassemble")) return { eligible: false, cost: 0 };
  if ((card.reassembledCount ?? 0) >= 1) return { eligible: false, cost: 0 };
  const nextDef = (d.def ?? 0) - ((card.defPenaltyFromReassemble ?? 0) + 1);
  if (nextDef <= 0) return { eligible: false, cost: 0 };
  return { eligible: true, cost: reassembleCost(state, card, cards, false) };
}

function canReassemble(state: GameState, card: CardInstance, cards: CardIndex, cost: number): boolean {
  const d = def(cards, card);
  if (card.isToken) return false; // tokens are exiled, never Reassemble
  if (!d?.keywords.includes("Reassemble")) return false;
  if ((card.reassembledCount ?? 0) >= 1) return false;
  const nextDef = (d.def ?? 0) - ((card.defPenaltyFromReassemble ?? 0) + 1);
  if (nextDef <= 0) return false;
  const p = state.players[card.controllerId]!;
  return p.money >= cost;
}

function reassembleCost(state: GameState, card: CardInstance, cards: CardIndex, consumeFree: boolean): number {
  const d = def(cards, card);
  if (!d) return SETUP.defaultReassembleCost;
  const p = state.players[card.controllerId]!;
  const meta = priv(state);
  const firstLindaFree =
    d.faction === "Linda Bioroids" &&
    !meta.firstDestroyedLindaThisTurn?.[p.id] &&
    (p.frontRow.some((c) => c.cardId === "endless-linda" || (c.cardId === "overseer-node" && c.instanceId !== card.instanceId)) ||
      p.backRow.some((c) => c.cardId === "endless-linda" || (c.cardId === "overseer-node" && c.instanceId !== card.instanceId)));
  if (firstLindaFree) {
    if (consumeFree) {
      meta.firstDestroyedLindaThisTurn ??= {};
      meta.firstDestroyedLindaThisTurn[p.id] = true;
    }
    return 0;
  }
  return d.reassembleCost ?? SETUP.defaultReassembleCost;
}

export function legalCombatIntents(state: GameState, player: PlayerId, cards: CardIndex): Intent[] {
  const out: Intent[] = [];
  const meta = peekPriv(state);
  const reassemble = meta.reassembleQueue?.filter((x) => x.controllerId === player) ?? [];
  for (const r of reassemble) {
    out.push({ kind: "reassembleChoice", player, instanceId: r.card.instanceId, pay: false });
    if (state.players[player]!.money >= r.cost) {
      out.push({ kind: "reassembleChoice", player, instanceId: r.card.instanceId, pay: true });
    }
  }

  const pending = meta.combat?.pendingAttack;
  if (pending) {
    if (player === state.activePlayerId) {
      const attacker = locate(state, pending.attackerId)?.card;
      if (attacker && hasGuardbreak(attacker, cards) && pending.cannotBlockId === undefined) {
        const defender = state.players[opponentOf(state, player)]!;
        for (const c of defender.frontRow.filter((x) => canBlock(x, cards))) {
          out.push({ kind: "guardbreakChoice", player, attackerId: pending.attackerId, cannotBlockId: c.instanceId });
        }
      }
    } else if (player === opponentOf(state, state.activePlayerId)) {
      for (const c of state.players[player]!.frontRow.filter((x) => canBlock(x, cards) && x.instanceId !== pending.cannotBlockId)) {
        out.push({ kind: "declareBlock", player, blockerId: c.instanceId, attackerId: pending.attackerId });
      }
      out.push({ kind: "skipBlock", player, attackerId: pending.attackerId });
    }
    return out;
  }

  if (player === state.activePlayerId && state.phase === "combat") {
    for (const c of state.players[player]!.frontRow) {
      for (const target of getLegalAttackTargets(state, c.instanceId, cards)) {
        out.push({ kind: "declareAttack", player, attackerId: c.instanceId, target });
      }
    }
  }
  return out;
}
