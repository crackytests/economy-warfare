/**
 * Keyword glossary for in-game tooltips. Mirrors handoff §9. Presentational
 * copy only — the engine remains the source of truth for behavior.
 */
import type { Keyword } from "@ew/shared";

export const KEYWORD_TEXT: Record<Keyword, string> = {
  Raid: "Raid X — when this deals combat damage, steal X money from the opponent.",
  Reassemble:
    "Reassemble — when destroyed, you may pay 1 money to return it to your back row (DEF -1). Some cards make this free.",
  Optimize: "Optimize — during your Income Phase, exhaust this for +1 money.",
  OptimizeLinda:
    "Optimize (Linda) — gains Optimize while you control another Linda Bioroids card.",
  Deploy: "Deploy — when it enters play, you may immediately move it to the back row for free (doesn't use your once-per-turn move).",
  Guardbreak:
    "Guardbreak — when attacking, choose one ready enemy front-row character that cannot block this attack.",
  Siege: "Siege — may attack any enemy back-row card directly, ignoring the front row.",
  Vehicle: "Vehicle — a piloted unit; fights in the front row.",
  Fork: "Fork — when it enters play, create a token copy of it. The copy is exiled (removed) when it leaves play and cannot Reassemble.",
};

export const KEYWORD_LABEL: Record<Keyword, string> = {
  Raid: "Raid",
  Reassemble: "Reassemble",
  Optimize: "Optimize",
  OptimizeLinda: "Optimize (Linda)",
  Deploy: "Deploy",
  Guardbreak: "Guardbreak",
  Siege: "Siege",
  Vehicle: "Vehicle",
  Fork: "Fork",
};
