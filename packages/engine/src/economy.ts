/**
 * Economy: income generation, cost payment, money floor, and the loss check.
 *
 * Pure. The baseline is back-row Characters + Locations with income > 0
 * (exhausted still earns). Card-specific income behavior is layered on top
 * here: Data Relay Station gating (generatesIncome), the Governor +1 aura
 * (totalIncome), Asset Freeze suppression (frozenIncome) and Emergency Funding
 * skip (skipIncomeOnce) in runIncomePhase, and Optimize via the optimize intent.
 */

import type { CardDef, CardInstance, GameState, PlayerState } from "@ew/shared";
import type { CardIndex } from "./index";
import { pushEvent } from "./state";
import { peekPriv, priv } from "./internal";

/** Effective income for an instance = base income + any temp income modifier. */
export function effectiveIncome(card: CardInstance, def: CardDef): number {
  const base = def.income ?? 0;
  return base + (card.tempIncomeModifier ?? 0);
}

/**
 * Does this in-play card generate income right now (baseline rules)?
 *
 * Baseline (handoff §6.3 / §7):
 *   - Back-row Characters with income > 0.
 *   - Locations (in back row) with income > 0.
 *   - Exhausted cards STILL earn.
 *
 * The one structural exception lives here: Data Relay Station earns nothing
 * while exhausted (entersExhausted). Other card-specific income adjustments are
 * applied elsewhere — Governor's aura in totalIncome, Asset Freeze suppression
 * via frozenIncome and Emergency Funding's skip via skipIncomeOnce in
 * runIncomePhase — so this predicate stays a clean baseline.
 */
export function generatesIncome(card: CardInstance, def: CardDef): boolean {
  if (card.row !== "back") return false;
  if (card.cardId === "data-relay-station" && card.exhausted) return false;
  if (def.type !== "Character" && def.type !== "Location") return false;
  return effectiveIncome(card, def) > 0;
}

/** Instance ids whose income is currently suppressed (Asset Freeze), for the UI. */
export function frozenIncomeIds(state: GameState): string[] {
  const f = peekPriv(state).frozenIncome ?? {};
  return Object.keys(f).filter((id) => f[id]);
}

/**
 * Loss-condition rule config (mirrors COMBAT_CONFIG).
 *
 * `incomeAnywhereSaves` (DEFAULT: true) — a card with printed income > 0 keeps
 * you alive at $0 even when it sits in the FRONT row. It still does NOT generate
 * income from the front (see generatesIncome) — only the loss check is relaxed,
 * so being forced to commit an earner to the front line no longer instantly
 * eliminates you. Set false to restore the legacy back-row-only check (§7),
 * used by the sim's `backrow-only` rule for A/B comparison.
 */
export const LOSS_CONFIG = { incomeAnywhereSaves: true };

/**
 * Does this player control a card that staves off the $0 loss?
 * With incomeAnywhereSaves (default) any in-play card with income > 0 counts,
 * in any row; otherwise only a back-row income source (legacy §7) counts.
 */
export function controlsLossSavingIncome(
  state: GameState,
  playerId: string,
  cards: CardIndex,
): boolean {
  if (incomeSources(state, playerId, cards).length > 0) return true;
  if (!LOSS_CONFIG.incomeAnywhereSaves) return false;
  const p = state.players[playerId]!;
  for (const zone of [p.frontRow, p.backRow, p.ongoing]) {
    for (const c of zone) {
      const def = cards.byId.get(c.cardId);
      if (def && effectiveIncome(c, def) > 0) return true;
    }
  }
  return false;
}

/** Every in-play (back-row) income source a player currently controls. */
export function incomeSources(
  state: GameState,
  playerId: string,
  cards: CardIndex,
): CardInstance[] {
  const p = state.players[playerId]!;
  return p.backRow.filter((c) => {
    const def = cards.byId.get(c.cardId);
    return def ? generatesIncome(c, def) : false;
  });
}

/** Total income a player would gain this Income Phase (baseline). */
export function totalIncome(state: GameState, playerId: string, cards: CardIndex): number {
  const p = state.players[playerId]!;
  let sum = 0;
  for (const c of p.backRow) {
    const def = cards.byId.get(c.cardId);
    if (!def) continue;
    if (priv(state).frozenIncome?.[c.instanceId]) continue;
    if (!generatesIncome(c, def)) continue;
    let income = effectiveIncome(c, def);
    if (def.type === "Character" && p.backRow.some((x) => x.cardId === "governor" && x.instanceId !== c.instanceId)) {
      income += 1;
    }
    sum += income;
  }
  return sum;
}

/**
 * Run the Income Phase for the active player: total income (Governor aura and
 * Asset Freeze suppression applied by totalIncome) and add it to money.
 * Emergency Funding's one-time skip is honored first. Mutates the
 * (already-cloned) draft state and logs an event.
 */
export function runIncomePhase(state: GameState, cards: CardIndex): void {
  const p = state.players[state.activePlayerId]!;
  const meta = priv(state);
  if (meta.skipIncomeOnce?.[p.id]) {
    meta.skipIncomeOnce[p.id] = false;
    pushEvent(state, "income", `${p.name} gains no income due to Emergency Funding.`, { playerId: p.id });
    return;
  }
  const gained = totalIncome(state, p.id, cards);
  if (meta.frozenIncome) {
    for (const c of p.backRow) delete meta.frozenIncome[c.instanceId];
  }
  if (gained > 0) {
    p.money += gained;
    pushEvent(state, "income", `${p.name} gains ${gained} money from income.`, {
      playerId: p.id,
      data: { gained, total: p.money },
    });
  } else {
    pushEvent(state, "income", `${p.name} generates no income.`, { playerId: p.id });
  }
}

// ---- Cost payment / money floor ------------------------------------------

/** Clamp a cost so it can never be negative (handoff §10: costs >= 0). */
export function clampCost(cost: number): number {
  return cost < 0 ? 0 : cost;
}

/**
 * Effective cost to play a card right now. Starts from the printed cost, then
 * layers the active modifiers (clamped at 0 — handoff §10):
 *   - Operational Overhead: +1 to each player's first card of the turn.
 *   - Forward Operating Base X: -1 per copy to Vehicles you play (stacks).
 *   - Emergency Protocols: -1 to the next Character after a destruction.
 *   - System Audit: +1 to the chosen card until end of the owner's next turn.
 */
export function effectiveCost(def: CardDef, state: GameState, playerId: string, card?: CardInstance): number {
  const p = state.players[playerId]!;
  const meta = peekPriv(state);

  // Production Overseer X: the first Action a player plays each turn is free.
  if (
    def.type === "Action" &&
    !meta.firstActionPlayedThisTurn?.[playerId] &&
    [...p.frontRow, ...p.backRow, ...p.ongoing].some((c) => c.cardId === "production-overseer-x")
  ) {
    return 0;
  }

  let cost = def.cost;
  if ((meta.playedThisTurn?.[playerId] ?? 0) === 0) {
    for (const pid of state.turnOrder) {
      if (state.players[pid]!.ongoing.some((c) => c.cardId === "operational-overhead")) {
        cost += 1;
      }
    }
  }
  if (def.type === "Vehicle") {
    cost -= p.backRow.filter((c) => c.cardId === "forward-operating-base-x").length;
  }
  if (def.type === "Character" && (meta.emergencyDiscount?.[playerId] ?? 0) > 0) {
    cost -= 1;
  }
  if (card && meta.systemAuditTaxes?.[card.instanceId]) {
    cost += 1;
  }
  return clampCost(cost);
}

/** Can the player afford a given (already-effective) cost? */
export function canAfford(p: PlayerState, cost: number): boolean {
  return p.money >= clampCost(cost);
}

/** Pay a cost from a player's money. Returns false (no-op) if unaffordable. */
export function payCost(p: PlayerState, cost: number): boolean {
  const c = clampCost(cost);
  if (p.money < c) return false;
  p.money -= c;
  return true;
}

/** Lose money, never dropping below 0 (handoff §10: money floor 0). */
export function loseMoney(p: PlayerState, amount: number): number {
  const before = p.money;
  p.money = Math.max(0, p.money - Math.max(0, amount));
  return before - p.money; // actual amount lost
}

/** Gain money. */
export function gainMoney(p: PlayerState, amount: number): void {
  p.money += Math.max(0, amount);
}

// ---- Loss check -----------------------------------------------------------

/**
 * checkLoss (handoff §7): a player loses if, at end of turn,
 *   money === 0 AND they control no income-saving card.
 *
 * "Income-saving card" is decided by controlsLossSavingIncome: by default
 * (LOSS_CONFIG.incomeAnywhereSaves) ANY in-play card with income > 0 counts,
 * in any row — so an earner stranded in the front row still keeps you alive
 * (it does not generate income there, only forestalls the loss). The legacy
 * rule (back-row income sources only, via generatesIncome / tempIncomeModifier)
 * is restored by setting LOSS_CONFIG.incomeAnywhereSaves = false.
 *
 * Returns the losing player's id if exactly one player has lost. If both have
 * collapsed simultaneously, the non-active player is considered to lose (the
 * active player survives a mutual-collapse tie since the check runs on their
 * end phase) — callers should treat the return as "the loser".
 */
export function checkLoss(state: GameState, cards: CardIndex): string | null {
  const losers: string[] = [];
  for (const pid of state.turnOrder) {
    const p = state.players[pid]!;
    if (p.money === 0 && !controlsLossSavingIncome(state, pid, cards)) {
      losers.push(pid);
    }
  }
  if (losers.length === 0) return null;
  if (losers.length === 1) return losers[0]!;
  // Both collapsed: the active player is the survivor (it is their end phase),
  // so the opponent is the loser.
  return losers.find((id) => id !== state.activePlayerId) ?? losers[0]!;
}
