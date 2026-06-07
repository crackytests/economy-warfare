/**
 * Card effect registry.
 *
 * Pattern: cards.json holds BASE stats + structural keyword tags. Anything that
 * isn't a vanilla stat-stick or a generic keyword is implemented here as a
 * handler keyed by cardId. Generic keywords (Raid, Reassemble, Optimize, Deploy,
 * Guardbreak, Siege, Vehicle) are handled centrally by the combat/economy
 * modules reading the keyword tags; this registry is for card-SPECIFIC text
 * (e.g. Governor's income aura, Strategic Reserve's ETB, Market Panic's blast).
 *
 * Each hook is OPTIONAL. Hooks receive a mutable draft of state inside the
 * reducer's transaction and an event sink. Keep hooks pure of I/O.
 *
 * NOTE: the precise EffectContext shape is owned by the engine-core agent and
 * will firm up as the reducer lands. Treat this as the agreed extension point.
 */

import type { CardDef, CardInstance, GameState, PlayerId, TargetRef } from "@ew/shared";
import type { CardIndex } from "./index";

export interface EffectContext {
  state: GameState;                 // mutable draft within the reducer transaction
  self: CardInstance;               // the card whose effect is firing
  controllerId: PlayerId;
  cards: CardIndex;
  targets: TargetRef[];
  emit: (message: string, data?: Record<string, unknown>) => void;
  def: (card: CardInstance) => CardDef | undefined;
  firstTarget: () => CardInstance | null;
  destroy: (card: CardInstance) => void;
  gainMoney: (playerId: PlayerId, amount: number) => void;
  loseMoney: (playerId: PlayerId, amount: number, reason?: string) => number;
  setFrozenIncome: (instanceId: string) => void;
  setSkipIncome: (playerId: PlayerId) => void;
  setCostTax: (instanceId: string, expiresFor: PlayerId) => void;
}

export interface CardEffect {
  /** When the card enters play (Locations/Characters/Vehicles). */
  onEnterPlay?(ctx: EffectContext): void;
  /** When this card is played as an Action — resolve then discard. */
  onPlayAction?(ctx: EffectContext): void;
  /** Continuous modifier recompute (auras like Governor, Director X, Predictive Shielding). */
  applyContinuous?(ctx: EffectContext): void;
  /** Income-phase hook (Optimize variants, Data Relay Station gating). */
  onIncome?(ctx: EffectContext): void;
  /** Combat-damage dealt hook (conditional Raid, etc.). */
  onDealCombatDamage?(ctx: EffectContext): void;
  /** Destruction hook (Reassemble extras, Overseer/Endless free reassemble). */
  onDestroyed?(ctx: EffectContext): void;
  /** Build-phase activated ability (Black Market Exchange). */
  onActivate?(ctx: EffectContext, abilityId: string): void;
}

/** cardId -> effect implementation. Vanilla cards simply have no entry. */
export const EFFECTS: Record<string, CardEffect> = {
  "strategic-reserve": {
    onEnterPlay(ctx) {
      ctx.gainMoney(ctx.controllerId, 1);
      ctx.emit("Strategic Reserve gains 1 money.", { instanceId: ctx.self.instanceId });
    },
  },
  "system-shutdown": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && target.controllerId !== ctx.controllerId && ctx.def(target)?.type === "Character") {
        target.exhausted = true;
      }
    },
  },
  "forced-liquidation": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && ctx.def(target)?.type === "Character" && target.exhausted) {
        ctx.destroy(target);
      }
    },
  },
  "protocol-purge": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && ctx.def(target)?.type === "Ongoing") {
        ctx.destroy(target);
      }
    },
  },
  "infrastructure-audit-x": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && ctx.def(target)?.type === "Location") {
        ctx.destroy(target);
      }
    },
  },
  "asset-freeze": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && target.controllerId !== ctx.controllerId && target.row === "back") {
        ctx.setFrozenIncome(target.instanceId);
        ctx.emit(`Asset Freeze: ${ctx.def(target)?.name ?? "a back-row card"} generates no income next turn.`, {
          instanceId: target.instanceId,
        });
      }
    },
  },
  "market-panic": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        const p = ctx.state.players[pid]!;
        const exhaustedCharacters = [...p.frontRow, ...p.backRow].filter(
          (c) => c.exhausted && ctx.def(c)?.type === "Character",
        ).length;
        ctx.loseMoney(pid, exhaustedCharacters, "effect");
      }
    },
  },
  "market-volatility": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        const p = ctx.state.players[pid]!;
        const locations = p.backRow.filter((c) => ctx.def(c)?.type === "Location").length;
        ctx.loseMoney(pid, locations, "effect");
      }
    },
  },
  "temporary-shutdown": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && target.row === "front") {
        target.exhausted = true;
        target.cannotReadyNextStart = true;
      }
    },
  },
  "emergency-funding": {
    onPlayAction(ctx) {
      ctx.gainMoney(ctx.controllerId, 2);
      ctx.setSkipIncome(ctx.controllerId);
    },
  },
  "emergency-shielding": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && target.controllerId === ctx.controllerId && ctx.def(target)?.type === "Character") {
        // +2 DEF "until your next turn": use the longer-duration buff so it
        // survives the End Phase and protects through the OPPONENT's turn.
        // (tempDefModifier would be wiped at end of the casting turn — useless,
        // since Actions are Build-phase only.)
        target.defBonusUntilNextTurn = (target.defBonusUntilNextTurn ?? 0) + 2;
      }
    },
  },
  "repair-swarm": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      const d = target ? ctx.def(target) : undefined;
      // Repair: restore the target's DEF to its printed value (heals combat
      // damage). Caps at printed — it cannot push DEF above the card's base.
      if (target && target.controllerId === ctx.controllerId && d?.faction === "Linda Bioroids" && d.def != null) {
        target.currentDef = d.def;
      }
    },
  },
  "replication-loop": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      const player = ctx.state.players[ctx.controllerId]!;
      const targetDef = target ? ctx.def(target) : undefined;
      if (
        target &&
        target.ownerId === ctx.controllerId &&
        targetDef?.faction === "Linda Bioroids" &&
        player.discard.some((c) => c.instanceId === target.instanceId)
      ) {
        const idx = player.discard.findIndex((c) => c.instanceId === target.instanceId);
        player.discard.splice(idx, 1);
        target.row = "back";
        target.exhausted = true;
        target.reassembledCount = 1;
        target.defPenaltyFromReassemble = (target.defPenaltyFromReassemble ?? 0) + 1;
        target.currentDef = (targetDef.def ?? 0) - (target.defPenaltyFromReassemble ?? 0);
        player.backRow.push(target);
      }
    },
  },
  "phantom-pressure": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      if (target && target.controllerId === ctx.controllerId && ctx.def(target)?.type === "Character") {
        (target as CardInstance & { tempGuardbreak?: boolean }).tempGuardbreak = true;
      }
    },
  },
  "system-audit": {
    onPlayAction(ctx) {
      const target = ctx.firstTarget();
      const targetDef = target ? ctx.def(target) : undefined;
      if (target && target.controllerId !== ctx.controllerId && targetDef?.type !== "Location") {
        ctx.setCostTax(target.instanceId, target.controllerId);
      }
    },
  },
};
