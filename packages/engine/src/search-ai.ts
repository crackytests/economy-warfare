/**
 * Search-based Solo AI (rollout / lookahead).
 *
 * The one-step heuristic (`pickAIIntent`) blunders because it can't see the
 * opponent's response. This AI fixes that: at each decision it tries every legal
 * intent, then ROLLS the rest of its own turn + the opponent's whole turn forward
 * using the heuristic as a fast rollout policy, EVALUATES the resulting position,
 * and picks the intent that leads to the best outcome. Because it is invoked at
 * every decision point, the whole turn ends up lookahead-guided.
 *
 * It leans on the engine being pure + deterministic (applyIntent returns new
 * state; Rng is seeded), so branching is safe. Rollouts always use the heuristic
 * (never the search), so cost is bounded and there is no recursion.
 */
import type { CardDef, CardInstance, GameState, Intent, PlayerId } from "@ew/shared";
import type { CardIndex } from "./index";
import { applyIntent, getLegalIntents } from "./reducer";
import { pickAIIntent, freeOptimizeFrom } from "./ai";
import { incomeSources } from "./economy";

const other = (s: GameState, p: PlayerId): PlayerId => (s.turnOrder[0] === p ? s.turnOrder[1] : s.turnOrder[0]);
const cdef = (cards: CardIndex, c: CardInstance): CardDef | undefined => cards.byId.get(c.cardId);

const WIN = 1e6;

/** Who acts next (mirrors the solo driver): pending reassemble/guardbreak/block first, else active. */
function nextActor(state: GameState, cards: CardIndex): PlayerId {
  const active = state.activePlayerId;
  const opp = other(state, active);
  const ai = getLegalIntents(state, active, cards);
  const oi = getLegalIntents(state, opp, cards);
  const has = (arr: Intent[], k: Intent["kind"]) => arr.some((i) => i.kind === k);
  if (has(ai, "resolveChoice")) return active;
  if (has(oi, "resolveChoice")) return opp;
  if (has(ai, "reassembleChoice")) return active;
  if (has(oi, "reassembleChoice")) return opp;
  if (has(ai, "guardbreakChoice")) return active;
  if (has(oi, "declareBlock") || has(oi, "skipBlock")) return opp;
  return active;
}

/**
 * Static evaluation of a position from `me`'s perspective. Higher = better.
 * Money + income (economy is the win/loss axis), board presence, a little for
 * cards in hand; opponent's are subtracted.
 */
export function evaluatePosition(state: GameState, me: PlayerId, cards: CardIndex): number {
  if (state.winnerId === me) return WIN;
  if (state.winnerId && state.winnerId !== me) return -WIN;

  let total = 0;
  for (const pid of state.turnOrder) {
    const p = state.players[pid]!;
    const sign = pid === me ? 1 : -1;
    let v = p.money;

    const income = incomeSources(state, pid, cards).reduce((n, c) => n + (cdef(cards, c)?.income ?? 0), 0);
    v += income * 7; // income is survival + the engine of the game
    if (income === 0) v -= 5; // no income source = one bad turn from losing

    for (const zone of [p.frontRow, p.backRow, p.ongoing]) {
      for (const c of zone) {
        const d = cdef(cards, c);
        if (!d) continue;
        v += 2; // a body on the board is worth something
        v += ((d.atk ?? 0) + (c.atkBonusUntilNextTurn ?? 0)) * 1.0;
        v += ((c.currentDef ?? d.def ?? 0) + (c.defBonusUntilNextTurn ?? 0)) * 1.0;
      }
    }
    v += p.hand.length * 0.4;
    total += sign * v;
  }
  return total;
}

/** Roll out (heuristic policy) until it's `me`'s Build phase again, a winner, or a step cap. */
function rolloutToMyNextTurn(start: GameState, me: PlayerId, cards: CardIndex, cap = 80): GameState {
  let s = start;
  let sawOpponentActive = s.activePlayerId !== me;
  for (let steps = 0; steps < cap; steps++) {
    if (s.winnerId) break;
    if (sawOpponentActive && s.activePlayerId === me && s.phase === "build") break;
    const actor = nextActor(s, cards);
    if (actor !== me) sawOpponentActive = true;
    const intent = pickAIIntent(s, actor, cards);
    if (!intent) break;
    const res = applyIntent(s, intent, cards);
    if (res.error) break;
    s = res.state;
  }
  return s;
}

export interface SearchOptions {
  rolloutCap?: number;
}

/**
 * Pick the AI's next intent by 1-turn lookahead with heuristic rollouts.
 * Drop-in replacement for `pickAIIntent` (same signature).
 */
export function pickSearchIntent(
  state: GameState,
  aiPlayerId: PlayerId,
  cards: CardIndex,
  opts: SearchOptions = {},
): Intent | null {
  // Never consider conceding — it always evaluates to -WIN, so when a pessimistic
  // rollout makes every line look lost, an enumeration-order tie could otherwise
  // make the search throw a game it can still play out. Playing on is never worse.
  const candidates = getLegalIntents(state, aiPlayerId, cards).filter((i) => i.kind !== "concede");
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  // Always bank a costless +1 from a back-row earner (Optimize / OptimizeLinda)
  // rather than spend a search branch deciding — it's free money.
  const freeOpt = freeOptimizeFrom(state, candidates, cards);
  if (freeOpt) return freeOpt;

  const cap = opts.rolloutCap ?? 80;
  let best: Intent | null = null;
  let bestVal = -Infinity;

  for (const candidate of candidates) {
    const applied = applyIntent(state, candidate, cards);
    if (applied.error) continue;
    const settled = rolloutToMyNextTurn(applied.state, aiPlayerId, cards, cap);
    const val = evaluatePosition(settled, aiPlayerId, cards);
    if (val > bestVal) {
      bestVal = val;
      best = candidate;
    }
  }

  // Fall back to the heuristic if nothing scored (shouldn't happen).
  return best ?? pickAIIntent(state, aiPlayerId, cards);
}
