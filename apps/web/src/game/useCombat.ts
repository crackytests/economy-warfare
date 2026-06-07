/**
 * Click-driven combat interaction model.
 *
 * The board is the primary surface for combat (handoff §14): the player clicks
 * an attacker, then clicks a target; if the attacker has Guardbreak they pick a
 * grounded blocker; the defender's blocker assignment is then resolved. This
 * hook is a thin, pure-ish coordinator over the engine — it NEVER mutates game
 * state. It reads legal intents the engine produced and returns the single
 * Intent the player's next click should dispatch, plus the highlight sets the
 * board uses. All state changes go through the same `applyIntent` dispatcher the
 * build phase uses.
 */
import { useMemo } from "react";
import type { GameState, Intent, PlayerId, TargetRef } from "@ew/shared";

export type CombatStep =
  | { kind: "idle" } // not in combat / nothing to do
  | { kind: "select-attacker"; attackerIds: Set<string> }
  | { kind: "select-target"; attackerId: string; targets: TargetRef[]; targetCardIds: Set<string>; canHitPlayer: boolean }
  | { kind: "guardbreak"; attackerId: string; choices: Set<string> }
  | { kind: "defend"; attackerId: string; blockerIds: Set<string> }
  | { kind: "reassemble"; instanceIds: Set<string> };

export interface CombatModel {
  step: CombatStep;
  /** Attackers that can still declare (highlighted ready). */
  attackerIds: Set<string>;
  /** Cards currently choosable as a target for the selected attacker. */
  targetCardIds: Set<string>;
  /** Guardbreak-grounded candidates. */
  guardbreakIds: Set<string>;
  /** Blockers the defender can assign. */
  blockerIds: Set<string>;
  /** The instanceId of the card currently mid-attack (pending), if any. */
  pendingAttackerId: string | null;
  /** Resolve a click on a board card into the intent to dispatch (or null). */
  intentForCardClick: (instanceId: string) => Intent | null;
  /** Intent to dispatch for a direct (player face) attack, if legal now. */
  directAttackIntent: Intent | null;
}

function collect<T>(items: Intent[], pick: (i: Intent) => T | undefined): Set<T> {
  const s = new Set<T>();
  for (const i of items) {
    const v = pick(i);
    if (v !== undefined) s.add(v);
  }
  return s;
}

export function useCombat(
  state: GameState,
  you: PlayerId,
  legalIntents: Intent[],
  selectedAttackerId: string | null,
  getLegalAttackTargets: (attackerId: string) => TargetRef[],
): CombatModel {
  return useMemo(() => {
    const inCombat = state.phase === "combat";
    const isActive = state.activePlayerId === you;

    const declareAttacks = legalIntents.filter((i) => i.kind === "declareAttack");
    const guardbreaks = legalIntents.filter((i) => i.kind === "guardbreakChoice");
    const blocks = legalIntents.filter((i) => i.kind === "declareBlock");
    const skips = legalIntents.filter((i) => i.kind === "skipBlock");
    const reassembles = legalIntents.filter((i) => i.kind === "reassembleChoice");

    const attackerIds = collect(declareAttacks, (i) =>
      i.kind === "declareAttack" ? i.attackerId : undefined,
    );

    // The pending attacker (mid-combat) shows up as the subject of guardbreak /
    // block / skip intents.
    const gb0 = guardbreaks[0];
    const bl0 = blocks[0];
    const sk0 = skips[0];
    const pendingAttackerId: string | null =
      (gb0?.kind === "guardbreakChoice" ? gb0.attackerId : null) ??
      (bl0?.kind === "declareBlock" ? bl0.attackerId : null) ??
      (sk0?.kind === "skipBlock" ? sk0.attackerId : null) ??
      null;

    const guardbreakIds = collect(guardbreaks, (i) =>
      i.kind === "guardbreakChoice" ? i.cannotBlockId : undefined,
    );
    const blockerIds = collect(blocks, (i) =>
      i.kind === "declareBlock" ? i.blockerId : undefined,
    );
    const reassembleIds = collect(reassembles, (i) =>
      i.kind === "reassembleChoice" ? i.instanceId : undefined,
    );

    // ---- derive the current step ----
    let step: CombatStep = { kind: "idle" };
    if (reassembleIds.size > 0) {
      step = { kind: "reassemble", instanceIds: reassembleIds };
    } else if (guardbreakIds.size > 0 && pendingAttackerId) {
      step = { kind: "guardbreak", attackerId: pendingAttackerId, choices: guardbreakIds };
    } else if ((blockerIds.size > 0 || skips.length > 0) && pendingAttackerId && !isActive) {
      step = { kind: "defend", attackerId: pendingAttackerId, blockerIds };
    } else if (inCombat && isActive && selectedAttackerId && attackerIds.has(selectedAttackerId)) {
      const targets = getLegalAttackTargets(selectedAttackerId);
      const targetCardIds = new Set(
        targets.filter((t) => t.kind === "card").map((t) => (t as Extract<TargetRef, { kind: "card" }>).instanceId),
      );
      step = {
        kind: "select-target",
        attackerId: selectedAttackerId,
        targets,
        targetCardIds,
        canHitPlayer: targets.some((t) => t.kind === "player"),
      };
    } else if (inCombat && isActive && attackerIds.size > 0) {
      step = { kind: "select-attacker", attackerIds };
    }

    // Freeze into a const so discriminant narrowing is stable inside closures.
    const finalStep: CombatStep = step;

    const targetCardIds = finalStep.kind === "select-target" ? finalStep.targetCardIds : new Set<string>();

    const directAttackIntent: Intent | null =
      finalStep.kind === "select-target" && finalStep.canHitPlayer
        ? declareAttacks.find(
            (i) => i.kind === "declareAttack" && i.attackerId === finalStep.attackerId && i.target.kind === "player",
          ) ?? null
        : null;

    const intentForCardClick = (instanceId: string): Intent | null => {
      switch (finalStep.kind) {
        case "select-attacker":
          // Clicking an attacker is handled by selection (no intent yet).
          return null;
        case "select-target": {
          if (!finalStep.targetCardIds.has(instanceId)) return null;
          return (
            declareAttacks.find(
              (i) =>
                i.kind === "declareAttack" &&
                i.attackerId === finalStep.attackerId &&
                i.target.kind === "card" &&
                i.target.instanceId === instanceId,
            ) ?? null
          );
        }
        case "guardbreak":
          if (!finalStep.choices.has(instanceId)) return null;
          return (
            guardbreaks.find(
              (i) => i.kind === "guardbreakChoice" && i.cannotBlockId === instanceId,
            ) ?? null
          );
        case "defend":
          if (!finalStep.blockerIds.has(instanceId)) return null;
          return (
            blocks.find((i) => i.kind === "declareBlock" && i.blockerId === instanceId) ?? null
          );
        default:
          return null;
      }
    };

    return {
      step: finalStep,
      attackerIds,
      targetCardIds,
      guardbreakIds,
      blockerIds,
      pendingAttackerId,
      intentForCardClick,
      directAttackIntent,
    };
  }, [state, you, legalIntents, selectedAttackerId, getLegalAttackTargets]);
}
