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
import type { PendingChoiceOption } from "./internal";

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
  // ---- expansion systems ----
  draw: (playerId: PlayerId, n: number) => CardInstance[];
  /** Bounce an in-play card to its owner's hand (tokens are exiled). */
  returnToHand: (card: CardInstance) => void;
  /** Return a card from its owner's discard to their hand (Convergence). */
  recallFromDiscard: (card: CardInstance) => boolean;
  /** Discard the `n` lowest-value cards from a player's hand. */
  discard: (playerId: PlayerId, n: number) => void;
  /** Create a token character copy of `cardId` under `controllerId` in `row`.
   *  `duration` omitted = permanent; "endOfTurn" = vanishes this End Phase;
   *  "nextTurn" = vanishes at the controller's next Start phase. */
  createToken: (cardId: string, controllerId: PlayerId, row: "front" | "back", duration?: "endOfTurn" | "nextTurn") => CardInstance | null;
  /** Raise a modal/dilemma for `chooserId` to resolve (blocks until chosen). */
  beginChoice: (chooserId: PlayerId, prompt: string, options: PendingChoiceOption[]) => void;
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
  /** Start-of-turn hook for the controller's in-play cards (drains, heals, etc.). */
  onStartTurn?(ctx: EffectContext): void;
  /** Combat-damage dealt hook (conditional Raid, etc.). */
  onDealCombatDamage?(ctx: EffectContext): void;
  /** Destruction hook (Reassemble extras, Overseer/Endless free reassemble). */
  onDestroyed?(ctx: EffectContext): void;
  /** Build-phase activated ability (Black Market Exchange). */
  onActivate?(ctx: EffectContext, abilityId: string): void;
}

/** The opponent of an effect's controller. */
function oppOf(ctx: EffectContext): PlayerId {
  return ctx.state.turnOrder[0] === ctx.controllerId ? ctx.state.turnOrder[1]! : ctx.state.turnOrder[0]!;
}

/** cardId -> effect implementation. Vanilla cards simply have no entry. */
export const EFFECTS: Record<string, CardEffect> = {
  // ===== Expansion: "The Reboot" =====
  "audit-directive": {
    onPlayAction(ctx) {
      const n = ctx.state.players[ctx.controllerId]!.backRow.filter((c) => (ctx.def(c)?.income ?? 0) > 0).length;
      ctx.loseMoney(oppOf(ctx), Math.min(4, n), "Audit Directive");
    },
  },
  "imperial-mandate": {
    onPlayAction(ctx) {
      const me = ctx.controllerId, opp = oppOf(ctx);
      ctx.beginChoice(me, "Imperial Mandate", [
        { label: "Gain 5 money", effects: [{ kind: "gainMoney", playerId: me, amount: 5 }] },
        { label: "Draw 2 cards", effects: [{ kind: "draw", playerId: me, n: 2 }] },
        { label: "Opponent loses 3", effects: [{ kind: "loseMoney", playerId: opp, amount: 3 }] },
      ]);
    },
  },
  "compliance-order": {
    onPlayAction(ctx) {
      const opp = oppOf(ctx);
      const oppP = ctx.state.players[opp]!;
      const hasIncome = oppP.backRow.some((c) => (ctx.def(c)?.income ?? 0) > 0);
      const options: PendingChoiceOption[] = [];
      // Only offer "lose money" if they can pay it in full (else it's a free dodge).
      if (oppP.money >= 3) options.push({ label: "Lose 3 money", effects: [{ kind: "loseMoney", playerId: opp, amount: 3 }] });
      if (hasIncome) options.push({ label: "Sacrifice an income card", effects: [{ kind: "sacrificeIncome", playerId: opp }] });
      if (options.length === 0) { ctx.loseMoney(opp, 3, "Compliance Order"); return; } // nothing to choose; take what they have
      ctx.beginChoice(opp, "Compliance Order", options);
    },
  },
  "severance-hex": {
    onPlayAction(ctx) {
      const opp = oppOf(ctx);
      const oppP = ctx.state.players[opp]!;
      const options: PendingChoiceOption[] = [];
      if (oppP.hand.length > 0) options.push({ label: "Discard a card", effects: [{ kind: "discardLowest", playerId: opp, n: 1 }] });
      if (oppP.money >= 2) options.push({ label: "Lose 2 money", effects: [{ kind: "loseMoney", playerId: opp, amount: 2 }] });
      if (options.length === 0) { ctx.loseMoney(opp, 2, "Severance Hex"); return; }
      ctx.beginChoice(opp, "Severance Hex", options);
    },
  },
  "the-52-protocol": {
    onPlayAction(ctx) {
      const me = ctx.controllerId;
      ctx.beginChoice(me, "The 52 Protocol", [
        { label: "Draw 2 cards", effects: [{ kind: "draw", playerId: me, n: 2 }] },
        { label: "Gain 4 money", effects: [{ kind: "gainMoney", playerId: me, amount: 4 }] },
        { label: "Recall a card from discard", effects: [{ kind: "recallBest", playerId: me }] },
      ]);
    },
  },
  "timeline-splitter": {
    onPlayAction(ctx) { const t = ctx.firstTarget(); if (t) ctx.returnToHand(t); },
  },
  "glitchstorm": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        for (const c of [...ctx.state.players[pid]!.frontRow]) {
          const t = ctx.def(c)?.type;
          if (t === "Character" || t === "Vehicle") ctx.returnToHand(c);
        }
      }
    },
  },
  "factory-reset-x": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        const p = ctx.state.players[pid]!;
        for (const c of [...p.frontRow, ...p.backRow]) {
          const t = ctx.def(c)?.type;
          if (t === "Vehicle" || t === "Location") ctx.returnToHand(c);
        }
      }
    },
  },
  "hard-reboot": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        const p = ctx.state.players[pid]!;
        for (const c of [...p.frontRow, ...p.backRow]) ctx.returnToHand(c);
      }
      for (const pid of ctx.state.turnOrder) ctx.draw(pid, 2);
    },
  },
  "rolling-blackout": {
    onPlayAction(ctx) {
      for (const pid of ctx.state.turnOrder) {
        const p = ctx.state.players[pid]!;
        const inc = p.backRow
          .filter((c) => (ctx.def(c)?.income ?? 0) > 0)
          .sort((a, b) => (ctx.def(a)?.cost ?? 0) - (ctx.def(b)?.cost ?? 0))[0];
        if (inc) ctx.returnToHand(inc);
      }
    },
  },
  "iterate": {
    onPlayAction(ctx) {
      const me = ctx.state.players[ctx.controllerId]!;
      const hasLinda = [...me.frontRow, ...me.backRow].some((c) => ctx.def(c)?.faction === "Linda Bioroids");
      ctx.draw(ctx.controllerId, hasLinda ? 2 : 1);
    },
  },
  "forked-process": {
    onPlayAction(ctx) {
      const t = ctx.firstTarget();
      if (t && t.controllerId === ctx.controllerId && ctx.def(t)?.type === "Character") {
        ctx.createToken(t.cardId, ctx.controllerId, t.row === "back" ? "back" : "front", "nextTurn");
      }
    },
  },
  "fork-bomb": {
    onPlayAction(ctx) {
      const t = ctx.firstTarget();
      if (t && ctx.def(t)?.type === "Character") ctx.createToken(t.cardId, ctx.controllerId, "front", "endOfTurn");
    },
  },
  "husk-tide": {
    onPlayAction(ctx) {
      ctx.createToken("spare-husk", ctx.controllerId, "front");
      ctx.createToken("spare-husk", ctx.controllerId, "front");
      ctx.createToken("spare-husk", ctx.controllerId, "front");
    },
  },
  "convergence-vat": {
    onPlayAction(ctx) {
      const p = ctx.state.players[ctx.controllerId]!;
      const lindas = p.discard.filter((c) => ctx.def(c)?.faction === "Linda Bioroids").slice(0, 2);
      for (const c of lindas) ctx.recallFromDiscard(c);
    },
  },
  "overclock-x": {
    onPlayAction(ctx) {
      const t = ctx.firstTarget();
      if (t && t.controllerId === ctx.controllerId) {
        t.tempAtkModifier = (t.tempAtkModifier ?? 0) + 2;
        (t as CardInstance & { tempGuardbreak?: boolean }).tempGuardbreak = true;
      }
    },
  },
  "supply-run-x": {
    onPlayAction(ctx) { ctx.draw(ctx.controllerId, 2); ctx.setSkipIncome(ctx.controllerId); },
  },
  "insider-trading": {
    onPlayAction(ctx) {
      ctx.draw(ctx.controllerId, 2);
      ctx.discard(ctx.controllerId, 1);
      ctx.gainMoney(oppOf(ctx), 1);
    },
  },
  "parallel-ledger": {
    onPlayAction(ctx) { ctx.draw(ctx.controllerId, 3); ctx.discard(ctx.controllerId, 1); },
  },
  // ---- ETB ----
  "censor-node": {
    onEnterPlay(ctx) {
      const opp = ctx.state.players[oppOf(ctx)]!;
      const target = opp.frontRow
        .filter((c) => ctx.def(c)?.type === "Character" && !c.exhausted)
        .sort((a, b) => (ctx.def(b)?.atk ?? 0) - (ctx.def(a)?.atk ?? 0))[0];
      if (target) target.exhausted = true;
    },
  },
  "assembly-matron": { onEnterPlay(ctx) { ctx.draw(ctx.controllerId, 2); } },
  "scout-drone-x": { onEnterPlay(ctx) { ctx.draw(ctx.controllerId, 1); } },
  "recon-mech-x": { onEnterPlay(ctx) { ctx.draw(ctx.controllerId, 1); } },
  "command-uplink-x": { onEnterPlay(ctx) { ctx.draw(ctx.controllerId, 2); } },
  "salvage-rig-x": { onEnterPlay(ctx) { ctx.gainMoney(ctx.controllerId, 2); } },
  "spare-cog": { onEnterPlay(ctx) { ctx.gainMoney(ctx.controllerId, 1); } },
  "convergence-point": {
    onEnterPlay(ctx) {
      const p = ctx.state.players[ctx.controllerId]!;
      const best = [...p.discard].sort((a, b) => (ctx.def(b)?.cost ?? 0) - (ctx.def(a)?.cost ?? 0))[0];
      if (best) ctx.recallFromDiscard(best);
    },
  },
  // ---- start of turn ----
  "rollback-protocol": {
    onStartTurn(ctx) {
      const p = ctx.state.players[ctx.controllerId]!;
      for (const c of [...p.frontRow, ...p.backRow]) {
        const d = ctx.def(c);
        if (d?.def != null && c.currentDef != null) c.currentDef = d.def - (c.defPenaltyFromReassemble ?? 0);
      }
    },
  },
  "continuity-yoko": { onStartTurn(ctx) { ctx.loseMoney(oppOf(ctx), 1, "Continuity Yoko"); } },
  "paradox-engine": {
    onStartTurn(ctx) {
      const dmg = Math.max(0, Math.min(3, ctx.state.players[ctx.controllerId]!.hand.length - 5));
      if (dmg > 0) ctx.loseMoney(oppOf(ctx), dmg, "Paradox Engine");
    },
  },
  "rewritten-reality": {
    onStartTurn(ctx) {
      const opp = ctx.state.players[oppOf(ctx)]!;
      const inc = opp.backRow
        .filter((c) => (ctx.def(c)?.income ?? 0) > 0)
        .sort((a, b) => (ctx.def(a)?.cost ?? 0) - (ctx.def(b)?.cost ?? 0))[0];
      if (inc) ctx.returnToHand(inc);
    },
  },
  "self-repair-loop": {
    onStartTurn(ctx) {
      const p = ctx.state.players[ctx.controllerId]!;
      const damaged = [...p.frontRow, ...p.backRow]
        .filter((c) => {
          const d = ctx.def(c);
          return d?.faction === "Linda Bioroids" && d.def != null && c.currentDef != null && c.currentDef < d.def;
        })
        .sort((a, b) => (a.currentDef ?? 0) - (b.currentDef ?? 0))[0];
      if (damaged) {
        const d = ctx.def(damaged)!;
        damaged.currentDef = (d.def ?? 0) - (damaged.defPenaltyFromReassemble ?? 0);
      }
    },
  },
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
