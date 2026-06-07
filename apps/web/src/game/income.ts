/**
 * Income breakdown for the UI. Mirrors the engine's baseline income rules
 * (handoff §6.3) so the Income Phase panel can show players exactly which
 * back-row cards earn and how much, before they spend Optimize. The engine
 * remains authoritative for the actual money change.
 */
import type { CardDef, CardInstance, PlayerState } from "@ew/shared";

export interface IncomeLine {
  instanceId: string;
  name: string;
  base: number;
  bonus: number; // governor aura + temp modifiers
  total: number;
}

export interface IncomeBreakdown {
  lines: IncomeLine[];
  total: number;
}

function baseIncome(card: CardInstance, def: CardDef): number {
  return def.income ?? 0;
}

function generatesIncome(card: CardInstance, def: CardDef): boolean {
  if (card.row !== "back") return false;
  if (card.cardId === "data-relay-station" && card.exhausted) return false;
  if (def.type !== "Character" && def.type !== "Location") return false;
  return baseIncome(card, def) + (card.tempIncomeModifier ?? 0) > 0;
}

export function incomeBreakdown(
  player: PlayerState,
  getDef: (id: string) => CardDef | undefined,
): IncomeBreakdown {
  const hasGovernor = player.backRow.some((c) => c.cardId === "governor");
  const lines: IncomeLine[] = [];
  for (const c of player.backRow) {
    const def = getDef(c.cardId);
    if (!def || !generatesIncome(c, def)) continue;
    const base = baseIncome(c, def);
    let bonus = c.tempIncomeModifier ?? 0;
    if (def.type === "Character" && hasGovernor && c.cardId !== "governor") {
      bonus += 1;
    }
    lines.push({
      instanceId: c.instanceId,
      name: def.name,
      base,
      bonus,
      total: base + bonus,
    });
  }
  return { lines, total: lines.reduce((n, l) => n + l.total, 0) };
}
