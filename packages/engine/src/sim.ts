/**
 * AI-vs-AI self-play balance harness.
 *
 * Runs many games per starter-deck matchup and reports win rates (among decided
 * games), game length, first-player advantage, stall rate (no winner inside the
 * turn cap — the game has no fatigue/deck-out loss), and WHY decided games end.
 *
 * Run:  npx tsx packages/engine/src/sim.ts [gamesPerMatchup]
 *
 * Not a unit test (no asserts) — an analysis tool. Pure engine + Solo AI, so
 * results are deterministic per seed.
 */
import { createGame, applyIntent, getLegalIntents, pickAIIntent, pickSearchIntent, type CardIndex } from "./index";
import { loadCardIndex, starterDeck } from "./cards";
import { incomeSources } from "./economy";
import { COMBAT_CONFIG } from "./combat";
import { LOSS_CONFIG } from "./economy";
import { locate } from "./state";
import { readFileSync } from "node:fs";
import type { DeckList } from "@ew/shared";
import type { GameState, Intent, PlayerId } from "@ew/shared";

const DECKS = [
  { id: "yoko-imperium-starter", label: "Yoko" },
  { id: "spooky-ones-starter", label: "Spooky" },
  { id: "linda-bioroids-starter", label: "Linda" },
  { id: "system-x-starter", label: "SystemX" },
] as const;

const P1: PlayerId = "p1";
const P2: PlayerId = "p2";
const MAX_TURNS = 40;   // decided games avg ~a handful of turns; 40 = surely a stall
const MAX_STEPS = 3000; // hard safety cap on intents per game

const cards: CardIndex = loadCardIndex();
const has = (intents: Intent[], kind: Intent["kind"]): boolean => intents.some((i) => i.kind === kind);

function chooseActor(state: GameState): PlayerId {
  const active = state.activePlayerId;
  const opp = state.turnOrder[0] === active ? state.turnOrder[1] : state.turnOrder[0];
  const ai = getLegalIntents(state, active, cards);
  const oi = getLegalIntents(state, opp, cards);
  if (has(ai, "reassembleChoice")) return active;
  if (has(oi, "reassembleChoice")) return opp;
  if (has(ai, "guardbreakChoice")) return active;
  if (has(oi, "declareBlock") || has(oi, "skipBlock")) return opp;
  return active;
}

interface GameResult {
  winner: PlayerId | null;
  turns: number;
  stalled: boolean;
  loserMoney: number;
  loserIncome: number; // # of back-row income sources the loser had at the end
  loserHand: number;
}

function playGame(deckAId: string, deckBId: string, seed: number, starter: PlayerId, startMoney: number, searchSides: Set<PlayerId> = new Set()): GameResult {
  let state = createGame({
    gameId: `sim-${seed}`,
    cards,
    rngSeed: seed,
    startingPlayerId: starter,
    players: [
      { id: P1, name: "P1", deck: starterDeck(deckAId) },
      { id: P2, name: "P2", deck: starterDeck(deckBId) },
    ],
  });
  // Experiment lever: override starting money before any turn runs.
  state.players[P1]!.money = startMoney;
  state.players[P2]!.money = startMoney;

  let steps = 0;
  let errStreak = 0;
  while (!state.winnerId && steps < MAX_STEPS && state.turnNumber <= MAX_TURNS) {
    steps++;
    const actor = chooseActor(state);
    const intent = searchSides.has(actor)
      ? pickSearchIntent(state, actor, cards)
      : pickAIIntent(state, actor, cards);
    if (!intent) break;
    if (intent.kind === "declareAttack" && intent.target.kind === "player") DIRECT_ATTACKS++;
    const res = applyIntent(state, intent, cards);
    if (res.error) {
      if (++errStreak > 5) break;
      const force = getLegalIntents(state, state.activePlayerId, cards).find(
        (i) => i.kind === "endTurn" || i.kind === "advancePhase",
      );
      if (!force) break;
      const fres = applyIntent(state, force, cards);
      if (fres.error) break;
      state = fres.state;
      continue;
    }
    errStreak = 0;
    state = res.state;
  }

  const stalled = !state.winnerId;
  const loserId = state.winnerId ? (state.winnerId === P1 ? P2 : P1) : null;
  const loser = loserId ? state.players[loserId]! : null;
  return {
    winner: state.winnerId ?? null,
    turns: state.turnNumber,
    stalled,
    loserMoney: loser ? loser.money : -1,
    loserIncome: loser ? incomeSources(state, loser.id, cards).length : -1,
    loserHand: loser ? loser.hand.length : -1,
  };
}

// ---- Run ------------------------------------------------------------------

const pct = (n: number, d: number): string => (d === 0 ? "  - " : `${((100 * n) / d).toFixed(0).padStart(3)}%`);
const pad = (s: string, n: number): string => s.padEnd(n);

interface ConfigSummary {
  label: string;
  total: number;
  decided: number;
  stalls: number;
  turnSum: number;
  early: number; // decided by turn <=4
  directAttacks: number;
  faction: Record<string, { decided: number; wins: number }>;
}

// Fixed seed base so every config plays the SAME games — clean A/B (only the
// experimental lever differs, not the shuffles).
const SEED_BASE = 5_000_000;
let DIRECT_ATTACKS = 0; // count of player-targeted attacks the AI attempts

function runConfig(label: string, startMoney: number, N: number): ConfigSummary {
  DIRECT_ATTACKS = 0;
  const faction: Record<string, { decided: number; wins: number }> = {};
  for (const d of DECKS) faction[d.label] = { decided: 0, wins: 0 };
  const s: ConfigSummary = { label, total: 0, decided: 0, stalls: 0, turnSum: 0, early: 0, directAttacks: 0, faction };
  let seed = SEED_BASE;
  for (const A of DECKS) {
    for (const B of DECKS) {
      for (let i = 0; i < N; i++) {
        const starter = i % 2 === 0 ? P1 : P2;
        const r = playGame(A.id, B.id, seed++, starter, startMoney);
        s.total++;
        if (r.stalled) { s.stalls++; continue; }
        s.decided++;
        s.turnSum += r.turns;
        if (r.turns <= 4) s.early++;
        s.faction[A.label]!.decided++; s.faction[B.label]!.decided++;
        if (r.winner === P1) s.faction[A.label]!.wins++;
        else s.faction[B.label]!.wins++;
      }
    }
    process.stdout.write(".");
  }
  s.directAttacks = DIRECT_ATTACKS;
  return s;
}

/** Give each listed card +1 income (mutates the in-memory CardIndex only). */
function buffIncome(ids: string[]): void {
  for (const id of ids) {
    const d = cards.byId.get(id) as { income: number | null } | undefined;
    if (d && d.income != null) d.income += 1;
  }
}

// ---- Trace mode: watch one game, intent by intent ------------------------

function cname(state: GameState, instanceId: string): string {
  const c = locate(state, instanceId)?.card;
  return (c && cards.byId.get(c.cardId)?.name) || instanceId.slice(0, 8);
}
function lbl(state: GameState, i: Intent): string {
  switch (i.kind) {
    case "mulligan": return i.keep ? "keep hand" : "mulligan";
    case "playCard": {
      const dep = i.targets?.[0]?.kind === "card" && i.targets[0].instanceId === i.instanceId;
      const tgt = i.targets?.[0]?.kind === "card" && !dep ? ` -> ${cname(state, i.targets[0].instanceId)}` : "";
      return `play ${cname(state, i.instanceId)}${dep ? " (DEPLOY back)" : ""}${tgt}`;
    }
    case "moveCharacter": return `move ${cname(state, i.instanceId)} -> ${i.toRow}`;
    case "optimize": return `optimize ${cname(state, i.instanceId)}`;
    case "recycle": return `recycle ${cname(state, i.discardInstanceId)}`;
    case "resale": return `resale ${cname(state, i.discardInstanceId)}`;
    case "activateAbility": return `ability ${cname(state, i.instanceId)}`;
    case "declareAttack": return `ATTACK ${cname(state, i.attackerId)} -> ${i.target.kind === "player" ? "PLAYER" : cname(state, i.target.instanceId)}`;
    case "declareBlock": return `block ${cname(state, i.blockerId)}`;
    case "skipBlock": return "take hit";
    case "guardbreakChoice": return `guardbreak ${cname(state, i.cannotBlockId)}`;
    case "reassembleChoice": return i.pay ? `reassemble ${cname(state, i.instanceId)}` : "decline reassemble";
    case "advancePhase": return "-> next phase";
    case "endTurn": return "END TURN";
    case "concede": return "concede";
  }
}
function side(state: GameState, pid: PlayerId): string {
  const p = state.players[pid]!;
  return `$${p.money} h${p.hand.length} F${p.frontRow.length} B${p.backRow.length} inc${incomeSources(state, pid, cards).length}`;
}

function traceGame(deckAId: string, deckBId: string, seed: number, startMoney: number): void {
  let state = createGame({
    gameId: `trace-${seed}`, cards, rngSeed: seed, startingPlayerId: P1,
    players: [{ id: P1, name: "P1", deck: starterDeck(deckAId) }, { id: P2, name: "P2", deck: starterDeck(deckBId) }],
  });
  state.players[P1]!.money = startMoney;
  state.players[P2]!.money = startMoney;
  console.log(`TRACE ${deckAId} (P1) vs ${deckBId} (P2), seed ${seed}, $${startMoney}\n`);
  let steps = 0;
  while (!state.winnerId && steps < 300 && state.turnNumber <= MAX_TURNS) {
    const actor = chooseActor(state);
    const intent = pickAIIntent(state, actor, cards);
    if (!intent) { console.log(`  (no intent for ${actor} @ ${state.phase})`); break; }
    const tag = `T${state.turnNumber} ${state.phase.padEnd(6)} ${actor}`;
    const res = applyIntent(state, intent, cards);
    if (res.error) { console.log(`${tag}  ${lbl(state, intent)}  ERR:${res.error.code}`); break; }
    state = res.state;
    console.log(`${tag}  ${lbl(state, intent).padEnd(34)} | P1 ${side(state, P1)}  P2 ${side(state, P2)}`);
    steps++;
  }
  console.log(`\nEND: winner=${state.winnerId ?? "STALL"} turn=${state.turnNumber}`);
}

// Replay mode: `sim.ts replay <path-to-game-log.json>` — re-narrate a game the
// user played, deterministically, to diagnose the AI's moves.
if (process.argv[2] === "replay") {
  const rec = JSON.parse(readFileSync(process.argv[3]!, "utf8")) as {
    seed: number; playerDeckId: string | null; aiDeckId: string;
    playerDeck: DeckList; aiDeck: DeckList; intents: Intent[];
    winner: string | null; turns: number; initialState?: GameState;
  };
  const YOU = "you", AI = "opponent";
  // Prefer the recorded initial state (exact, deck-label independent). Fall back
  // to rebuilding from seed + decks for older logs.
  let state: GameState = rec.initialState
    ? (JSON.parse(JSON.stringify(rec.initialState)) as GameState)
    : createGame({
        gameId: "replay", cards, rngSeed: rec.seed, startingPlayerId: YOU,
        players: [{ id: YOU, name: "You", deck: rec.playerDeck }, { id: AI, name: "AI", deck: rec.aiDeck }],
      });
  const nm = (pid: string) => (pid === YOU ? "YOU" : "AI ");
  console.log(`REPLAY seed=${rec.seed}  YOU=${rec.playerDeckId ?? rec.playerDeck?.id}  AI=${rec.aiDeckId}\n`);
  for (const intent of rec.intents) {
    const tag = `T${state.turnNumber} ${state.phase.padEnd(6)} ${nm(intent.player)}`;
    const label = lbl(state, intent); // name cards from the PRE-state (accurate)
    const res = applyIntent(state, intent, cards);
    if (res.error) { console.log(`${tag}  ${label}  ERR:${res.error.code} (${res.error.message})`); break; }
    state = res.state;
    console.log(`${tag}  ${label.padEnd(36)} | YOU ${side(state, YOU)}  AI ${side(state, AI)}`);
  }
  console.log(`\nEND: winner=${state.winnerId ?? "none"} turn=${state.turnNumber} (recorded winner=${rec.winner ?? "none"})`);
  process.exit(0);
}

// Search-vs-heuristic mode: `sim.ts searchtest [N]` — mirror matches (same deck
// both sides) with one side using the search AI, to isolate AI quality.
if (process.argv[2] === "searchtest") {
  const Ns = Math.max(2, parseInt(process.argv[3] ?? "30", 10));
  const sm = 5;
  console.log(`Search AI vs Heuristic AI — mirror matches, ${Ns} games/deck, $${sm} start\n`);
  let totWins = 0, totDec = 0;
  let seed = 7_000_000;
  for (const D of DECKS) {
    let sWins = 0, dec = 0;
    for (let i = 0; i < Ns; i++) {
      const searchIsP1 = i % 2 === 0;                       // alternate which side searches
      const starter = Math.floor(i / 2) % 2 === 0 ? P1 : P2; // and who goes first
      const searchSides = new Set<PlayerId>([searchIsP1 ? P1 : P2]);
      const r = playGame(D.id, D.id, seed++, starter, sm, searchSides);
      if (r.stalled) continue;
      dec++; totDec++;
      if (r.winner === (searchIsP1 ? P1 : P2)) { sWins++; totWins++; }
    }
    console.log(`  ${D.label.padEnd(9)} search ${String(dec ? Math.round((100 * sWins) / dec) : 0).padStart(3)}%  (${sWins}/${dec} decided)`);
  }
  console.log(`\nOverall: search wins ${totDec ? Math.round((100 * totWins) / totDec) : 0}% of decided mirror games (${totWins}/${totDec}).`);
  console.log("(>50% ⇒ the search AI beats the heuristic with the deck held equal.)");
  process.exit(0);
}

// Matrix mode: `sim.ts matrix [N] [startMoney] [policy]` — full per-matchup read.
// policy = "search" => both sides use the lookahead/search AI (default heuristic).
if (process.argv[2] === "matrix") {
  const Nm = Math.max(1, parseInt(process.argv[3] ?? "150", 10));
  const sm = Math.max(0, parseInt(process.argv[4] ?? "5", 10));
  const useSearch = (process.argv[5] ?? "").toLowerCase() === "search";
  const searchSides = useSearch ? new Set<PlayerId>([P1, P2]) : new Set<PlayerId>();
  // Optional rule modifier (arg 6): "ft-protect" (no direct attack until the
  // defender has taken a turn) or "nodirect" (no direct player damage at all).
  const rule = (process.argv[6] ?? "").toLowerCase();
  if (rule === "ft-protect") COMBAT_CONFIG.directAttackNeedsFirstTurn = true;
  if (rule === "nodirect") COMBAT_CONFIG.allowDirectAttacks = false;
  if (rule === "income-anywhere") LOSS_CONFIG.incomeAnywhereSaves = true; // now default; explicit/no-op
  if (rule === "backrow-only") LOSS_CONFIG.incomeAnywhereSaves = false; // legacy loss rule for A/B
  interface Cell { aWin: number; bWin: number; stall: number; turnSum: number; decided: number }
  const matrix: Record<string, Record<string, Cell>> = {};
  const fac: Record<string, { decided: number; wins: number }> = {};
  for (const d of DECKS) fac[d.label] = { decided: 0, wins: 0 };
  let total = 0, decided = 0, stalls = 0, turnSum = 0, fpWins = 0, early = 0;
  let seed = 9_000_000;
  for (const A of DECKS) {
    matrix[A.label] = {};
    for (const B of DECKS) {
      const c: Cell = { aWin: 0, bWin: 0, stall: 0, turnSum: 0, decided: 0 };
      for (let i = 0; i < Nm; i++) {
        const starter = i % 2 === 0 ? P1 : P2;
        const r = playGame(A.id, B.id, seed++, starter, sm, searchSides);
        total++;
        if (r.stalled) { c.stall++; stalls++; continue; }
        c.decided++; decided++; c.turnSum += r.turns; turnSum += r.turns;
        if (r.turns <= 4) early++;
        fac[A.label]!.decided++; fac[B.label]!.decided++;
        if (r.winner === P1) { c.aWin++; fac[A.label]!.wins++; } else { c.bWin++; fac[B.label]!.wins++; }
        if (r.winner === starter) fpWins++;
      }
      matrix[A.label]![B.label] = c;
    }
    process.stdout.write(".");
  }
  console.log("\n");
  const pc = (n: number, d: number) => (d === 0 ? " - " : `${Math.round((100 * n) / d)}%`);
  const padl = (s: string, n: number) => s.padEnd(n);
  console.log(`Full matchup matrix — ${useSearch ? "SEARCH" : "heuristic"} AI, $${sm} start, ${Nm} games/cell${rule ? `, rule=${rule}` : ""} (alternating first player)\n`);
  console.log("ROW (P1) win% vs COL (P2), among decided; (stall%):");
  console.log(padl("", 9) + DECKS.map((d) => padl(d.label, 14)).join(""));
  for (const A of DECKS) {
    let row = padl(A.label, 9);
    for (const B of DECKS) {
      const c = matrix[A.label]![B.label]!;
      row += padl(`${pc(c.aWin, c.decided)} (${pc(c.stall, c.stall + c.decided)})`, 14);
    }
    console.log(row);
  }
  console.log("\nFaction win% among decided (both seats):");
  for (const d of DECKS) console.log(`  ${padl(d.label, 9)} ${pc(fac[d.label]!.wins, fac[d.label]!.decided)}  (${fac[d.label]!.wins}/${fac[d.label]!.decided})`);
  console.log(`\nGlobal: decided ${pc(decided, total)}, stall ${pc(stalls, total)}, avgTurns ${(turnSum / Math.max(1, decided)).toFixed(1)}, turn<=4 ${pc(early, decided)}, first-player ${pc(fpWins, decided)}`);
  process.exit(0);
}

// Trace mode: `sim.ts trace <deckA> <deckB> [seed] [startMoney]`
if (process.argv[2] === "trace") {
  traceGame(
    process.argv[3] ?? "yoko-imperium-starter",
    process.argv[4] ?? "spooky-ones-starter",
    parseInt(process.argv[5] ?? "5000001", 10),
    parseInt(process.argv[6] ?? "5", 10),
  );
  process.exit(0);
}

const N = Math.max(1, parseInt(process.argv[2] ?? "100", 10));
const startMoney = Math.max(0, parseInt(process.argv[3] ?? "5", 10));
// Optional A/B experiment (arg 4):
//   "nodirect"                      -> characters cannot attack the player directly
//   "<id>,<id>,..."                 -> give those cards +1 income
const exp = (process.argv[4] ?? "").trim();

console.log(`Economy Warfare — A/B (${N} games/matchup, $${startMoney} start, turn cap ${MAX_TURNS})`);
console.log(exp ? `Experiment: ${exp}\n` : "(baseline only)\n");

const results: ConfigSummary[] = [];
process.stdout.write("  baseline ");
results.push(runConfig("baseline", startMoney, N));
console.log("");
if (exp === "nodirect") {
  COMBAT_CONFIG.allowDirectAttacks = false;
  process.stdout.write("  no-direct ");
  results.push(runConfig("no-direct", startMoney, N));
  console.log("");
} else if (exp) {
  buffIncome(exp.split(",").map((s) => s.trim()).filter(Boolean));
  process.stdout.write("  income+1 ");
  results.push(runConfig("income+1", startMoney, N));
  console.log("");
}

console.log("\n=== Comparison ===");
console.log(pad("config", 11) + pad("decided%", 10) + pad("stall%", 9) + pad("turn<=4%", 10) + pad("avgTurns", 9) + DECKS.map((d) => pad(d.label, 8)).join(""));
for (const s of results) {
  let row = pad(s.label, 11);
  row += pad(pct(s.decided, s.total).trim(), 10);
  row += pad(pct(s.stalls, s.total).trim(), 9);
  row += pad(pct(s.early, s.decided).trim(), 10);
  row += pad((s.turnSum / Math.max(1, s.decided)).toFixed(1), 9);
  for (const d of DECKS) row += pad(pct(s.faction[d.label]!.wins, s.faction[d.label]!.decided).trim(), 8);
  console.log(row);
}
console.log(`\nDirect attacks attempted by the AI: ${results.map((r) => `${r.label}=${r.directAttacks}`).join(", ")}`);
console.log("\n(decided% = games with a winner; stall% = hit turn cap; turn<=4% = share of DECIDED games that ended by turn 4; faction cols = win% among decided.)");
