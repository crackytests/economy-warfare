/**
 * Combat + income presentational overlays for the board. Pure UI; all actions
 * are dispatched as Intents by the parent GameBoard.
 */
import { AnimatePresence, motion } from "framer-motion";
import type { Phase } from "@ew/shared";
import type { CombatStep } from "./useCombat";
import type { IncomeBreakdown } from "./income";

export interface PromptAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

const STEP_COPY: Record<CombatStep["kind"], { title: string; hint: string }> = {
  idle: { title: "", hint: "" },
  "select-attacker": {
    title: "Declare an attacker",
    hint: "Click a glowing front-row unit to attack with it.",
  },
  "select-target": {
    title: "Choose a target",
    hint: "Click a highlighted enemy, or strike the opponent directly.",
  },
  guardbreak: {
    title: "Guardbreak",
    hint: "Pick an enemy front-row character that cannot block this attack.",
  },
  defend: {
    title: "Assign a blocker",
    hint: "Click one of your ready front-row units to block, or take the hit.",
  },
  reassemble: {
    title: "Reassemble",
    hint: "A destroyed unit may return to your back row for 1 money (free with some cards).",
  },
};

export function CombatPrompt({
  step,
  attackerName,
  onCancelAttacker,
  onDirectAttack,
  onSkipBlock,
  reassembleActions,
}: {
  step: CombatStep;
  attackerName?: string;
  onCancelAttacker?: () => void;
  onDirectAttack?: () => void;
  onSkipBlock?: () => void;
  reassembleActions?: PromptAction[];
}) {
  if (step.kind === "idle") return null;
  const copy = STEP_COPY[step.kind];
  return (
    <AnimatePresence>
      <motion.div
        className={`ew-combat-prompt ew-combat-prompt--${step.kind}`}
        key={step.kind + (step.kind === "select-target" || step.kind === "guardbreak" || step.kind === "defend" ? step.attackerId : "")}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <div className="ew-combat-prompt__body">
          <span className="ew-combat-prompt__title">{copy.title}</span>
          <span className="ew-combat-prompt__hint">
            {step.kind === "select-target" && attackerName ? `${attackerName}: ${copy.hint}` : copy.hint}
          </span>
        </div>
        <div className="ew-combat-prompt__actions">
          {step.kind === "select-target" && onDirectAttack && (
            <button className="ew-cbtn ew-cbtn--attack" onClick={onDirectAttack}>
              Attack player
            </button>
          )}
          {step.kind === "select-target" && onCancelAttacker && (
            <button className="ew-cbtn" onClick={onCancelAttacker}>
              Choose another
            </button>
          )}
          {step.kind === "defend" && onSkipBlock && (
            <button className="ew-cbtn ew-cbtn--skip" onClick={onSkipBlock}>
              Take the hit
            </button>
          )}
          {step.kind === "reassemble" &&
            reassembleActions?.map((a, i) => (
              <button
                key={i}
                className={"ew-cbtn" + (a.primary ? " ew-cbtn--block" : " ew-cbtn--skip")}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export function IncomePanel({
  breakdown,
  optimizeActions,
  onCollect,
}: {
  breakdown: IncomeBreakdown;
  optimizeActions: { label: string; onClick: () => void }[];
  onCollect: () => void;
}) {
  return (
    <motion.div
      className="ew-income-panel"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 340, damping: 26 }}
    >
      <div className="ew-income-panel__head">
        <span className="ew-income-panel__title">Income</span>
        <span className="ew-income-panel__total">+${breakdown.total}</span>
      </div>
      <div className="ew-income-panel__lines">
        {breakdown.lines.length === 0 ? (
          <span className="ew-muted">No back-row income sources.</span>
        ) : (
          breakdown.lines.map((l) => (
            <div key={l.instanceId} className="ew-income-line">
              <span className="ew-income-line__name">{l.name}</span>
              <span className="ew-income-line__val">
                +${l.total}
                {l.bonus !== 0 && <em className="ew-income-line__bonus"> ({l.base}+{l.bonus})</em>}
              </span>
            </div>
          ))
        )}
      </div>
      {optimizeActions.length > 0 && (
        <div className="ew-income-panel__optimize">
          <span className="ew-income-panel__sub">Optimize (exhaust for +$1)</span>
          {optimizeActions.map((a, i) => (
            <button key={i} className="ew-cbtn ew-cbtn--optimize" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button className="ew-cbtn ew-cbtn--block ew-income-panel__collect" onClick={onCollect}>
        Continue to Build
      </button>
    </motion.div>
  );
}

export function PhaseBanner({ phase, turnNumber, isYou }: { phase: Phase; turnNumber: number; isYou: boolean }) {
  const LABELS: Record<Phase, string> = {
    start: "Start",
    draw: "Draw",
    income: "Income",
    build: "Build",
    combat: "Combat",
    end: "End",
  };
  return (
    <AnimatePresence mode="wait">
      <motion.div
        className={"ew-phase-banner" + (phase === "combat" ? " ew-phase-banner--combat" : "")}
        key={`${turnNumber}-${phase}-${isYou}`}
        initial={{ opacity: 0, scale: 1.1 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [1.1, 1, 1, 1.04] }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1.4, times: [0, 0.15, 0.7, 1] }}
      >
        <span className="ew-phase-banner__phase">{LABELS[phase]}</span>
        <span className="ew-phase-banner__who">{isYou ? "Your turn" : "Opponent"}</span>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Transient caption announcing the most recent action (esp. the opponent's), so
 * the player can read what just happened on the board. Keyed by `fxId` so each
 * new action re-triggers the animation; renders nothing when `caption` is null.
 */
export function ActionBanner({
  caption,
  category,
  isYou,
  fxId,
}: { caption: string | null; category: string; isYou: boolean; fxId?: number }) {
  return (
    <AnimatePresence>
      {caption && (
        <motion.div
          key={fxId}
          className={"ew-action-banner" + (isYou ? " is-you" : " is-opp")}
          initial={{ opacity: 0, y: -6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          <span className="ew-action-banner__cat">{category}</span>
          <span className="ew-action-banner__text">{caption}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
