import { useMemo, useState, useCallback, useEffect, useRef, forwardRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  applyIntent,
  buildCardIndex,
  createGame,
  getLegalIntents,
  getLegalAttackTargets,
  pickAIIntent,
  pickSearchIntent,
  frozenIncomeIds,
  effectiveAtk,
  effectiveDef,
  type CardIndex,
} from "@ew/engine";
import type {
  CardDef,
  CardInstance,
  DeckList,
  GameState,
  Intent,
  PlayerId,
  PlayerState,
  TargetRef,
  Phase,
} from "@ew/shared";
import { Card } from "../components/Card";
import { ALL_CARDS, artUrl, getCard } from "../cards";
import { useCombat } from "./useCombat";
import { CombatPrompt, IncomePanel, PhaseBanner, ActionBanner } from "./CombatOverlay";
import { incomeBreakdown } from "./income";
import { KEYWORD_TEXT } from "./keywords";
import { ACTIVE_DECK_ID, loadActiveDeck, loadSavedDecks } from "../deck/storage";
import starterDecksJson from "../../../../data/starter_decks.json";
import "./GameBoard.css";

export interface GameBoardProps {
  mode: "solo" | "online";
  deckId?: string | null;
}

interface StarterDecksFile {
  decks: DeckList[];
}

const STARTER_DECKS = (starterDecksJson as StarterDecksFile).decks;
const DEFAULT_PLAYER_DECK = "system-x-starter";
const DEFAULT_OPPONENT_DECK = "yoko-imperium-starter";
const PLAYER_A = "you";
const PLAYER_B = "opponent";

function deckById(id: string | null | undefined): DeckList {
  const activeDeck = id === ACTIVE_DECK_ID ? loadActiveDeck() : null;
  return (
    activeDeck ??
    loadSavedDecks().find((d) => d.id === id) ??
    STARTER_DECKS.find((d) => d.id === id) ??
    STARTER_DECKS.find((d) => d.id === DEFAULT_PLAYER_DECK) ??
    STARTER_DECKS[0]!
  );
}

function createSoloGame(
  cards: CardIndex,
  deckId: string | null | undefined,
  opponentDeckId: string,
  rngSeed: number,
): GameState {
  return createGame({
    gameId: `local-${deckId ?? "default"}-vs-${opponentDeckId}-${rngSeed}`,
    cards,
    rngSeed,
    startingPlayerId: PLAYER_A,
    players: [
      { id: PLAYER_A, name: "You", deck: deckById(deckId) },
      { id: PLAYER_B, name: "Opponent", deck: deckById(opponentDeckId) },
    ],
  });
}

function freshSoloSeed(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0]!;
  }
  return (Date.now() ^ performance.now()) >>> 0;
}

function opponentOf(state: GameState, player: PlayerId): PlayerId {
  return state.turnOrder[0] === player ? state.turnOrder[1] : state.turnOrder[0];
}

function cardDefFor(card: CardInstance): CardDef | undefined {
  return getCard(card.cardId);
}

function findCard(state: GameState, instanceId: string): CardInstance | null {
  for (const pid of state.turnOrder) {
    const p = state.players[pid]!;
    for (const zone of [p.deck, p.hand, p.discard, p.frontRow, p.backRow, p.ongoing]) {
      const card = zone.find((c) => c.instanceId === instanceId);
      if (card) return card;
    }
  }
  return null;
}

// One shared card index for the whole module so display code can call the engine's
// effectiveAtk/effectiveDef directly — the SAME functions combat uses — instead of
// re-deriving aura/buff math in the UI (which is how they previously drifted).
const CARD_INDEX: CardIndex = buildCardIndex(ALL_CARDS as CardDef[]);

function targetLabel(state: GameState, target: TargetRef | undefined): string {
  if (!target) return "";
  if (target.kind === "player") return state.players[target.playerId]?.name ?? target.playerId;
  const found = findCard(state, target.instanceId);
  const d = found ? cardDefFor(found) : undefined;
  return d?.name ?? "card";
}

function intentLabel(state: GameState, intent: Intent): string {
  switch (intent.kind) {
    case "mulligan":
      return intent.keep ? "Keep hand" : "Mulligan (draw 4)";
    case "playCard": {
      const card = findCard(state, intent.instanceId);
      const name = card ? cardDefFor(card)?.name : "card";
      const t = intent.targets?.[0];
      // Deploy variant self-targets the played card.
      if (t?.kind === "card" && t.instanceId === intent.instanceId) {
        return `Play ${name} (Deploy → back row)`;
      }
      const target = targetLabel(state, t);
      return target ? `Play ${name} -> ${target}` : `Play ${name}`;
    }
    case "moveCharacter": {
      const card = findCard(state, intent.instanceId);
      return `Move ${card ? cardDefFor(card)?.name : "character"} to ${intent.toRow}`;
    }
    case "optimize": {
      const card = findCard(state, intent.instanceId);
      return `Optimize ${card ? cardDefFor(card)?.name : "card"} (+$1)`;
    }
    case "recycle": {
      const card = findCard(state, intent.discardInstanceId);
      return `Recycle ${card ? cardDefFor(card)?.name : "card"} (-$1, draw 1)`;
    }
    case "resale": {
      const card = findCard(state, intent.discardInstanceId);
      return `Resale ${card ? cardDefFor(card)?.name : "card"} (+$1)`;
    }
    case "activateAbility": {
      const source = findCard(state, intent.instanceId);
      const target = targetLabel(state, intent.targets?.[0]);
      return `${source ? cardDefFor(source)?.name : "Ability"} -> ${target}`;
    }
    case "declareAttack": {
      const attacker = findCard(state, intent.attackerId);
      return `Attack: ${attacker ? cardDefFor(attacker)?.name : "card"} -> ${targetLabel(state, intent.target)}`;
    }
    case "guardbreakChoice": {
      const blocked = findCard(state, intent.cannotBlockId);
      return `Guardbreak: exclude ${blocked ? cardDefFor(blocked)?.name : "card"}`;
    }
    case "declareBlock": {
      const blocker = findCard(state, intent.blockerId);
      return `Block with ${blocker ? cardDefFor(blocker)?.name : "card"}`;
    }
    case "skipBlock":
      return "Take hit (no block)";
    case "reassembleChoice": {
      const card = findCard(state, intent.instanceId);
      const d = card ? cardDefFor(card) : undefined;
      return intent.pay ? `Reassemble ${d?.name ?? "card"} (-$${d?.reassembleCost ?? 1})` : `Decline Reassemble`;
    }
    case "resolveChoice":
      return choiceOptionLabel(state, intent.optionIndex) ?? `Choose option ${intent.optionIndex + 1}`;
    case "advancePhase":
      return "Next Phase";
    case "endTurn":
      return "End Turn";
    case "concede":
      return "Concede";
  }
}

/** Read the human-readable label of a pending-choice option (from engine priv). */
function choiceOptionLabel(state: GameState, idx: number): string | undefined {
  const pc = (state as unknown as { __ew?: { pendingChoice?: { options: { label: string }[] } } }).__ew?.pendingChoice;
  return pc?.options[idx]?.label;
}

function intentCategory(intent: Intent): string {
  switch (intent.kind) {
    case "mulligan": return "Opening";
    case "playCard": return "Play";
    case "moveCharacter": return "Move";
    case "optimize": return "Income";
    case "recycle":
    case "resale": return "Hand";
    case "activateAbility": return "Ability";
    case "declareAttack":
    case "guardbreakChoice":
    case "declareBlock":
    case "skipBlock": return "Combat";
    case "reassembleChoice": return "Reassemble";
    case "resolveChoice": return "Choice";
    case "advancePhase": return "Phase";
    case "endTurn": return "Turn";
    case "concede": return "Game";
  }
}

function involvesInstance(intent: Intent, instanceId: string): boolean {
  const targetMatches = (targets: TargetRef[] | undefined) =>
    targets?.some((t) => t.kind === "card" && t.instanceId === instanceId) === true;
  switch (intent.kind) {
    case "playCard":
    case "activateAbility":
      return intent.instanceId === instanceId || targetMatches(intent.targets);
    case "moveCharacter":
    case "optimize":
      return intent.instanceId === instanceId;
    case "recycle":
    case "resale":
      return intent.discardInstanceId === instanceId;
    case "declareAttack":
      return intent.attackerId === instanceId || (intent.target.kind === "card" && intent.target.instanceId === instanceId);
    case "guardbreakChoice":
      return intent.attackerId === instanceId || intent.cannotBlockId === instanceId;
    case "declareBlock":
      return intent.blockerId === instanceId || intent.attackerId === instanceId;
    case "skipBlock":
      return intent.attackerId === instanceId;
    case "reassembleChoice":
      return intent.instanceId === instanceId;
    default:
      return false;
  }
}

/** Board cards an intent acts on — used to spotlight them when it resolves. */
function affectedCardIds(intent: Intent): string[] {
  switch (intent.kind) {
    case "playCard":
    case "moveCharacter":
    case "optimize":
    case "reassembleChoice":
      return [intent.instanceId];
    case "activateAbility": {
      const t = intent.targets?.[0];
      return [intent.instanceId, ...(t?.kind === "card" ? [t.instanceId] : [])];
    }
    case "declareAttack":
      return [intent.attackerId, ...(intent.target.kind === "card" ? [intent.target.instanceId] : [])];
    case "declareBlock":
      return [intent.blockerId, intent.attackerId];
    default:
      return []; // recycle/resale (hand only), skipBlock, phase/turn — no board spotlight
  }
}

/** Transient visual feedback for the most recently applied intent. */
interface ActionFx {
  id: number;
  actorId: PlayerId;
  caption: string | null;       // null => no banner
  category: string;
  spotlightIds: Set<string>;    // cards to pulse
  isKill: boolean;              // a destroy happened → impact flash
  money: Record<string, number>; // per-player money delta this action
}

const PHASE_LABELS: Record<Phase, string> = {
  start: "Start",
  draw: "Draw",
  income: "Income",
  build: "Build",
  combat: "Combat",
  end: "End",
};

const PHASE_ORDER: Phase[] = ["start", "draw", "income", "build", "combat", "end"];

const CardSlot = forwardRef<HTMLDivElement, {
  card: CardInstance;
  selected: boolean;
  legal: boolean;
  isAttacker?: boolean;
  isTarget?: boolean;
  isPendingTarget?: boolean;
  isGuardbreakTarget?: boolean;
  isBlocker?: boolean;
  isActionable?: boolean;
  lungeDir?: 1 | -1 | 0;
  onClick: () => void;
  previewDamage?: number;
  frozen?: boolean;
  displayDef?: number | null;
  displayAtk?: number | null;
  spotlight?: boolean;
  spotlightKill?: boolean;
  keywordTitles?: Partial<Record<string, string>>;
}>(function CardSlot({
  card,
  selected,
  legal,
  isAttacker,
  isTarget,
  isPendingTarget,
  isGuardbreakTarget,
  isBlocker,
  isActionable,
  lungeDir,
  onClick,
  previewDamage,
  frozen,
  displayDef,
  displayAtk,
  spotlight,
  spotlightKill,
  keywordTitles,
}, ref) {
  const d = cardDefFor(card);
  if (!d) return <div ref={ref} className="ew-card-slot ew-card-slot--hidden">?</div>;
  const shownDef = displayDef ?? card.currentDef;
  const damaged = shownDef != null && d.def != null && shownDef < d.def;
  const lunge = lungeDir
    ? { y: lungeDir * -34, scale: 1.06 }
    : { y: 0, scale: 1 };
  return (
    <motion.div
      ref={ref}
      className={
        "ew-card-slot" +
        (selected ? " is-selected" : "") +
        (legal ? " is-legal" : "") +
        (isActionable ? " is-actionable" : "") +
        (isAttacker ? " is-attacker" : "") +
        (isTarget ? " is-target" : "") +
        (isPendingTarget ? " is-pending-target" : "") +
        (isGuardbreakTarget ? " is-guardbreak" : "") +
        (isBlocker ? " is-blocker" : "") +
        (spotlight ? " is-spotlight" : "") +
        (spotlight && spotlightKill ? " is-spotlight-kill" : "")
      }
      layoutId={card.instanceId}
      layout="position"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, ...lunge }}
      exit={{ opacity: 0, scale: 0.55, rotate: 12, filter: "blur(4px)" }}
      transition={{ type: "spring", stiffness: 360, damping: 26 }}
      whileHover={{ scale: 1.1, zIndex: 20, transition: { duration: 0.12 } }}
      onClick={onClick}
    >
      <Card
        card={d}
        size="sm"
        exhausted={card.exhausted}
        currentDef={shownDef}
        currentAtk={displayAtk}
        keywordTitles={keywordTitles}
      />
      {damaged && (
        <span className="ew-card-slot__hp" title="Current DEF">
          {shownDef}
        </span>
      )}
      {frozen && (
        <span className="ew-card-slot__frozen" title="Income frozen this turn (Asset Freeze)">
          ❄ no income
        </span>
      )}
      {previewDamage !== undefined && previewDamage > 0 && (
        <motion.span
          className="ew-card-slot__damage"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 20 }}
        >
          -{previewDamage}
        </motion.span>
      )}
    </motion.div>
  );
});

function CardBack({ count }: { count: number }) {
  return (
    <div className="ew-card-slot ew-card-slot--back">
      <div className="ew-card-back">
        <span className="ew-card-back__count">{count}</span>
      </div>
    </div>
  );
}

interface ZoneFlags {
  selectedId: string | null;
  selectedAttackerId?: string | null;
  legalInstanceIds: Set<string>;
  actionableIds?: Set<string>;
  attackerIds?: Set<string>;
  targetIds?: Set<string>;
  pendingTargetIds?: Set<string>;
  guardbreakIds?: Set<string>;
  blockerIds?: Set<string>;
  lungingId?: string | null;
  lungeDir?: 1 | -1;
  damagePreview?: Map<string, number>;
  frozenIds?: Set<string>;
  displayDefById?: Map<string, number>;
  displayAtkById?: Map<string, number>;
  spotlightIds?: Set<string>;
  spotlightKill?: boolean;
  keywordTitles?: Partial<Record<string, string>>;
}

function Zone({
  title,
  cards,
  flags,
  onSelect,
  compact,
}: {
  title: string;
  cards: CardInstance[];
  flags: ZoneFlags;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <section className={"ew-zone" + (compact ? " ew-zone--compact" : "")}>
      <div className="ew-zone__head">
        <span>{title}</span>
        <span className="ew-zone__count">{cards.length}</span>
      </div>
      <div className="ew-zone__cards">
        {cards.length === 0 ? (
          <span className="ew-zone__empty">&mdash;</span>
        ) : (
          <AnimatePresence mode="popLayout">
            {cards.map((card) => (
              <CardSlot
                key={card.instanceId}
                card={card}
                selected={flags.selectedId === card.instanceId || flags.selectedAttackerId === card.instanceId}
                legal={flags.legalInstanceIds.has(card.instanceId)}
                isActionable={flags.actionableIds?.has(card.instanceId)}
                isAttacker={flags.attackerIds?.has(card.instanceId)}
                isTarget={flags.targetIds?.has(card.instanceId)}
                isPendingTarget={flags.pendingTargetIds?.has(card.instanceId)}
                isGuardbreakTarget={flags.guardbreakIds?.has(card.instanceId)}
                isBlocker={flags.blockerIds?.has(card.instanceId)}
                lungeDir={flags.lungingId === card.instanceId ? flags.lungeDir ?? 1 : 0}
                onClick={() => onSelect(card.instanceId)}
                previewDamage={flags.damagePreview?.get(card.instanceId)}
                frozen={flags.frozenIds?.has(card.instanceId)}
                displayDef={flags.displayDefById?.get(card.instanceId)}
                displayAtk={flags.displayAtkById?.get(card.instanceId)}
                spotlight={flags.spotlightIds?.has(card.instanceId)}
                spotlightKill={flags.spotlightKill}
                keywordTitles={flags.keywordTitles}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </section>
  );
}

function MoneyDisplay({ amount, label, delta = 0, deltaKey }: { amount: number; label: string; delta?: number; deltaKey?: number }) {
  return (
    <motion.div className="ew-money" key={`${label}-${amount}`}>
      <span className="ew-money__label">{label}</span>
      <AnimatePresence mode="popLayout">
        <motion.span
          className="ew-money__value"
          key={amount}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 10, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          ${amount}
        </motion.span>
      </AnimatePresence>
      {/* Floating +N / -N chip so money swings (Raid, income, resale) are legible. */}
      <AnimatePresence>
        {delta !== 0 && (
          <motion.span
            key={deltaKey}
            className={"ew-money__delta " + (delta > 0 ? "is-gain" : "is-loss")}
            initial={{ y: 2, opacity: 0, scale: 0.7 }}
            animate={{ y: -20, opacity: 1, scale: 1 }}
            exit={{ y: -28, opacity: 0 }}
            transition={{ duration: 0.45 }}
          >
            {delta > 0 ? `+${delta}` : delta}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PhaseBar({ phase, turnNumber }: { phase: Phase; turnNumber: number }) {
  const currentIdx = PHASE_ORDER.indexOf(phase);
  return (
    <div className="ew-phase-bar">
      <span className="ew-phase-bar__turn">Turn {turnNumber}</span>
      <div className="ew-phase-bar__steps">
        {PHASE_ORDER.map((p, i) => (
          <div
            key={p}
            className={
              "ew-phase-bar__step" +
              (i === currentIdx ? " is-current" : "") +
              (i < currentIdx ? " is-past" : "")
            }
          >
            <span className="ew-phase-bar__dot" />
            <span className="ew-phase-bar__label">{PHASE_LABELS[p]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerPanel({ player, active, isYou, moneyDelta = 0, fxKey, thinking = false }: { player: PlayerState; active: boolean; isYou: boolean; moneyDelta?: number; fxKey?: number; thinking?: boolean }) {
  return (
    <div className={"ew-player" + (active ? " is-active" : "") + (isYou ? " is-you" : "")}>
      <div className="ew-player__name">
        <strong>{player.name}</strong>
        {active && <span className="ew-player__active-badge">ACTIVE</span>}
        {thinking && <span className="ew-player__thinking" title="Opponent is taking its turn">thinking<span className="ew-player__thinking-dots" /></span>}
      </div>
      <div className="ew-player__stats">
        <MoneyDisplay amount={player.money} label="" delta={moneyDelta} deltaKey={fxKey} />
        <span className="ew-player__stat" title="Cards in hand">
          <span className="ew-player__stat-icon">&#9995;</span> {player.hand.length}
        </span>
        <span className="ew-player__stat" title="Cards in deck">
          <span className="ew-player__stat-icon">&#9830;</span> {player.deck.length}
        </span>
        <span className="ew-player__stat" title="Cards in discard">
          <span className="ew-player__stat-icon">&#9850;</span> {player.discard.length}
        </span>
      </div>
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k) ?? [];
    arr.push(item);
    map.set(k, arr);
  }
  return [...map.entries()];
}

function WinnerOverlay({ state, onRestart, onCopyLog, copied }: { state: GameState; onRestart: () => void; onCopyLog: () => void; copied: boolean }) {
  const winner = state.winnerId ? state.players[state.winnerId] : null;
  return (
    <motion.div
      className="ew-winner-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        className="ew-winner-card"
        initial={{ scale: 0.8, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
      >
        <h2 className="ew-winner-card__title">Game Over</h2>
        <p className="ew-winner-card__winner">
          {winner ? `${winner.name} wins!` : "Draw!"}
        </p>
        <div className="ew-winner-card__stats">
          {state.turnOrder.map((pid) => {
            const p = state.players[pid]!;
            return (
              <div key={pid} className="ew-winner-card__player">
                <span>{p.name}</span>
                <span>${p.money}</span>
              </div>
            );
          })}
        </div>
        <button className="ew-btn" onClick={onCopyLog}>
          {copied ? "Copied! ✓" : "📋 Copy game log"}
        </button>
        <button className="ew-btn ew-btn--primary" onClick={onRestart}>
          Play Again
        </button>
      </motion.div>
    </motion.div>
  );
}

export function GameBoard({ mode, deckId }: GameBoardProps) {
  const cards = CARD_INDEX;
  const [aiDeckId, setAiDeckId] = useState(DEFAULT_OPPONENT_DECK);
  // The exact starting state of the current game (cloned), so a finished game can
  // be replayed by applying the recorded intents to it — no deck/seed
  // reconstruction needed, immune to any deck-label confusion.
  const initialStateRef = useRef<GameState | null>(null);
  const [state, setState] = useState<GameState>(() => {
    const s = createSoloGame(cards, deckId, DEFAULT_OPPONENT_DECK, freshSoloSeed());
    initialStateRef.current = JSON.parse(JSON.stringify(s));
    return s;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIntent, setHoveredIntent] = useState<Intent | null>(null);
  const [handOpen, setHandOpen] = useState(false);

  // Log auto-scroll: the log renders oldest→newest, so keep it pinned to the
  // bottom (most recent entry) as new events arrive.
  const panelLogRef = useRef<HTMLDivElement>(null);
  const handLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const el of [panelLogRef.current, handLogRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [state.log.length]);

  const active = state.players[state.activePlayerId]!;
  const opponent = state.players[opponentOf(state, state.activePlayerId)]!;
  const isYourTurn = state.activePlayerId === PLAYER_A;

  const activeIntents = getLegalIntents(state, active.id, cards);
  const opponentIntents = getLegalIntents(state, opponent.id, cards).filter(
    (i) => i.kind === "declareBlock" || i.kind === "skipBlock" || i.kind === "reassembleChoice",
  );
  const allIntents = useMemo(() => [...activeIntents, ...opponentIntents], [activeIntents, opponentIntents]);

  // Combat is driven from YOUR perspective (PLAYER_A): your attack declarations,
  // your guardbreak picks, plus block/reassemble prompts when you are defending.
  const yourCombatIntents = useMemo(
    () =>
      allIntents.filter(
        (i) => i.player === PLAYER_A &&
          (i.kind === "declareAttack" ||
            i.kind === "guardbreakChoice" ||
            i.kind === "declareBlock" ||
            i.kind === "skipBlock" ||
            i.kind === "reassembleChoice"),
      ),
    [allIntents],
  );

  const getTargets = useCallback(
    (attackerId: string) => getLegalAttackTargets(state, attackerId, cards),
    [state, cards],
  );

  const combat = useCombat(state, PLAYER_A, yourCombatIntents, selectedAttackerId, getTargets);

  const legalInstanceIds = useMemo(() => {
    const s = new Set<string>();
    for (const intent of allIntents) {
      for (const pid of state.turnOrder) {
        const player = state.players[pid]!;
        for (const c of [...player.hand, ...player.frontRow, ...player.backRow, ...player.ongoing, ...player.discard]) {
          if (involvesInstance(intent, c.instanceId)) s.add(c.instanceId);
        }
      }
    }
    return s;
  }, [allIntents, state]);

  // Cards you can act on right now via clicking (combat target/blocker/guardbreak).
  const actionableIds = useMemo(() => {
    const s = new Set<string>();
    if (combat.step.kind === "select-target") for (const id of combat.targetCardIds) s.add(id);
    if (combat.step.kind === "guardbreak") for (const id of combat.guardbreakIds) s.add(id);
    if (combat.step.kind === "defend") for (const id of combat.blockerIds) s.add(id);
    return s;
  }, [combat]);

  // Damage preview: hovering an action OR a live combat selection.
  const damagePreview = useMemo(() => {
    const m = new Map<string, number>();
    const previewAttack = (attackerId: string, targetId: string) => {
      const attacker = findCard(state, attackerId);
      if (!attacker) return;
      const atk = effectiveAtk(state, attacker, cards); // includes auras + temp/until-next-turn buffs
      if (atk > 0) m.set(targetId, atk);
    };
    if (hoveredIntent?.kind === "declareAttack" && hoveredIntent.target.kind === "card") {
      previewAttack(hoveredIntent.attackerId, hoveredIntent.target.instanceId);
    }
    // Show damage on every legal target while choosing.
    if (combat.step.kind === "select-target") {
      for (const id of combat.targetCardIds) previewAttack(combat.step.attackerId, id);
    }
    return m;
  }, [hoveredIntent, state, combat]);

  // Effective (aura + buff adjusted) ATK/DEF for every in-play card, straight from
  // the engine — so the card faces show what combat will actually use.
  const displayDefById = useMemo(() => {
    const values = new Map<string, number>();
    for (const pid of state.turnOrder) {
      const p = state.players[pid]!;
      for (const card of [...p.frontRow, ...p.backRow]) {
        if (card.currentDef != null) values.set(card.instanceId, effectiveDef(state, card, cards));
      }
    }
    return values;
  }, [state, cards]);

  const displayAtkById = useMemo(() => {
    const values = new Map<string, number>();
    for (const pid of state.turnOrder) {
      const p = state.players[pid]!;
      for (const card of [...p.frontRow, ...p.backRow]) {
        values.set(card.instanceId, effectiveAtk(state, card, cards));
      }
    }
    return values;
  }, [state, cards]);

  const visibleActions = useMemo(() => {
    // Side list shows non-combat actions (build/income/turn); combat is on-board.
    const actionable = allIntents.filter(
      (i) =>
        i.kind !== "concede" &&
        i.kind !== "declareAttack" &&
        i.kind !== "declareBlock" &&
        i.kind !== "skipBlock" &&
        i.kind !== "guardbreakChoice" &&
        i.kind !== "reassembleChoice",
    );
    if (!selectedId) return actionable;
    const selected = actionable.filter((i) => involvesInstance(i, selectedId));
    return selected.length > 0 ? selected : actionable;
  }, [allIntents, selectedId]);

  // ---- attack lunge tracking ----
  const [lunge, setLunge] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const lungeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- per-action visual feedback (banner caption + board spotlight + money delta) ----
  const [actionFx, setActionFx] = useState<ActionFx | null>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fxSeq = useRef(0);
  // True while the AI's next action is scheduled but not yet applied — drives the
  // "thinking…" badge so each beat of the opponent's turn is framed.
  const [aiPending, setAiPending] = useState(false);

  // Debug: record every applied intent (human + AI), in order, so a finished
  // game can be exported and replayed deterministically to diagnose the AI.
  const historyRef = useRef<Intent[]>([]);
  const [copied, setCopied] = useState(false);

  const dispatch = useCallback((intent: Intent) => {
    const result = applyIntent(state, intent, cards);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    historyRef.current.push(intent);
    // Trigger the lunge animation when an attack is declared.
    if (intent.kind === "declareAttack") {
      const dir: 1 | -1 = intent.player === PLAYER_A ? 1 : -1;
      setLunge({ id: intent.attackerId, dir });
      if (lungeTimer.current) clearTimeout(lungeTimer.current);
      lungeTimer.current = setTimeout(() => setLunge(null), 450);
    }

    // Per-action feedback: spotlight the affected cards, caption what happened,
    // and surface money swings. Skip noisy phase steps. Money delta = post - pre.
    const spotlight = new Set(affectedCardIds(intent));
    for (const e of result.events ?? []) {
      const cid = (e.data as { instanceId?: string } | undefined)?.instanceId;
      if (e.type === "destroy" && cid) spotlight.add(cid);
    }
    const isKill = (result.events ?? []).some((e) => e.type === "destroy");
    const moneyOf = (st: GameState, pid: string) => st.players[pid]?.money ?? 0;
    const money: Record<string, number> = {};
    for (const pid of result.state.turnOrder) {
      money[pid] = moneyOf(result.state, pid) - moneyOf(state, pid);
    }
    const isPhaseNoise = intent.kind === "advancePhase";
    const actorName = state.players[intent.player]?.name ?? "";
    const fx: ActionFx = {
      id: ++fxSeq.current,
      actorId: intent.player,
      caption: isPhaseNoise ? null : `${actorName}: ${intentLabel(state, intent)}`,
      category: intentCategory(intent),
      spotlightIds: spotlight,
      isKill,
      money,
    };
    setActionFx(fx);
    if (fxTimer.current) clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setActionFx(null), 950);

    setState(result.state);
    setSelectedId(null);
    setSelectedAttackerId(null);
    setError(null);
    setHoveredIntent(null);
  }, [state, cards]);

  const resetGame = useCallback((nextAiDeckId = aiDeckId) => {
    historyRef.current = [];
    const fresh = createSoloGame(cards, deckId, nextAiDeckId, freshSoloSeed());
    initialStateRef.current = JSON.parse(JSON.stringify(fresh));
    setState(fresh);
    setSelectedId(null);
    setSelectedAttackerId(null);
    setError(null);
    setHoveredIntent(null);
    setLunge(null);
    setActionFx(null);
    setAiPending(false);
  }, [aiDeckId, cards, deckId]);

  // Export a self-contained record of the current game (seed + both decks + every
  // intent + the event log) to the clipboard, for AI debugging.
  const copyGameLog = useCallback(() => {
    const record = {
      format: "ew-game-log-v1",
      seed: state.rngSeed,
      playerDeckId: deckId ?? null,
      aiDeckId,
      playerDeck: deckById(deckId),
      aiDeck: deckById(aiDeckId),
      winner: state.winnerId,
      turns: state.turnNumber,
      initialState: initialStateRef.current, // ground truth for replay (deck-label independent)
      intents: historyRef.current,
      log: state.log.map((e) => ({ at: e.at, type: e.type, msg: e.message })),
    };
    const text = JSON.stringify(record, null, 2);
    (window as unknown as { __ewGameLog?: string }).__ewGameLog = text; // also retrievable from devtools
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => { console.log("EW GAME LOG:\n" + text); done(); });
    } else {
      console.log("EW GAME LOG:\n" + text);
      done();
    }
  }, [state, deckId, aiDeckId]);

  const cycleAiDeck = useCallback(() => {
    const currentIdx = STARTER_DECKS.findIndex((d) => d.id === aiDeckId);
    const nextDeck = STARTER_DECKS[(currentIdx + 1) % STARTER_DECKS.length] ?? STARTER_DECKS[0]!;
    setAiDeckId(nextDeck.id);
    resetGame(nextDeck.id);
  }, [aiDeckId, resetGame]);

  // Click router: in combat, board clicks resolve to combat intents/selection.
  const handleCardClick = useCallback(
    (instanceId: string) => {
      setSelectedId(instanceId);
      const clicked = findCard(state, instanceId);
      if (clicked?.controllerId === PLAYER_A && clicked.row === null) setHandOpen(true);
      const resolved = combat.intentForCardClick(instanceId);
      if (resolved) {
        dispatch(resolved);
        return;
      }
      // Selecting / re-selecting an attacker during combat.
      if (combat.step.kind === "select-attacker" || combat.step.kind === "select-target") {
        if (combat.attackerIds.has(instanceId)) {
          setSelectedAttackerId((cur) => (cur === instanceId ? null : instanceId));
        }
      }
    },
    [combat, dispatch, state],
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  // Drop a stale attacker selection if it is no longer a legal attacker.
  useEffect(() => {
    if (selectedAttackerId && !combat.attackerIds.has(selectedAttackerId)) {
      setSelectedAttackerId(null);
    }
  }, [combat.attackerIds, selectedAttackerId]);

  // When PLAYER_B is the active attacker and an attack is awaiting YOUR (PLAYER_A)
  // block/skip/reassemble decision, the AI must NOT act (it could otherwise end
  // its turn and skip your interactive defense). This guards the human's combat input.
  const humanMustRespond = useMemo(
    () =>
      (state.activePlayerId === PLAYER_B &&
        yourCombatIntents.some(
          (i) => i.kind === "declareBlock" || i.kind === "skipBlock" || i.kind === "reassembleChoice",
        )) ||
      // A modal/dilemma is awaiting YOUR pick (can arise on either turn).
      getLegalIntents(state, PLAYER_A, cards).some((i) => i.kind === "resolveChoice"),
    [state, yourCombatIntents, cards],
  );

  useEffect(() => {
    if (mode !== "solo" || state.winnerId) return;
    if (humanMustRespond) return;
    if (state.activePlayerId === PLAYER_A) {
      const oppIntents = getLegalIntents(state, PLAYER_B, cards).filter(
        (i) => i.kind === "declareBlock" || i.kind === "skipBlock" || i.kind === "reassembleChoice" || i.kind === "resolveChoice",
      );
      if (oppIntents.length === 0) return;
    } else if (state.activePlayerId !== PLAYER_B) {
      return;
    }

    // The opponent uses the lookahead/search AI (much stronger than the
    // one-step heuristic, which it still uses internally for fast rollouts).
    const aiIntent = pickSearchIntent(state, PLAYER_B, cards);
    if (!aiIntent) return;

    const delay = state.activePlayerId === PLAYER_B && state.phase === "build" ? 600 : 400;
    setAiPending(true);
    const timer = setTimeout(() => {
      const s = stateRef.current;
      if (s.winnerId || s.activePlayerId !== PLAYER_B && !(aiIntent.kind === "declareBlock" || aiIntent.kind === "skipBlock" || aiIntent.kind === "reassembleChoice" || aiIntent.kind === "resolveChoice")) { setAiPending(false); return; }
      setAiPending(false);
      dispatchRef.current(aiIntent);
    }, delay);
    return () => { clearTimeout(timer); setAiPending(false); };
  }, [state, cards, mode, humanMustRespond]);

  if (mode === "online") {
    return (
      <div className="ew-game ew-game--empty">
        <div className="ew-game__empty">
          <h2>Online board shell ready</h2>
          <p>The server stream is WS6 territory; this board is wired for local engine play first.</p>
        </div>
      </div>
    );
  }

  const top = state.players[PLAYER_B]!;
  const bottom = state.players[PLAYER_A]!;
  const aiDeckName = STARTER_DECKS.find((d) => d.id === aiDeckId)?.name ?? "Starter Deck";

  // NB: plain consts (not hooks) — they live after the early `online` return, so
  // they must not be hooks. They are cheap to recompute each render.
  const groupedActions = groupBy(visibleActions, intentCategory);

  // Income breakdown + Optimize prompts (engine pauses here when Optimize is available).
  const yourOptimize = activeIntents.filter((i) => i.kind === "optimize");
  const showIncomePanel = isYourTurn && state.phase === "income";
  const breakdown = incomeBreakdown(bottom, (id) => getCard(id));
  const advanceFromIncome = activeIntents.find((i) => i.kind === "advancePhase") ?? null;

  // Highlight sets per side. Your attackers vs opp targets differ by who acts.
  const yourAttackerIds = combat.step.kind === "select-attacker" || combat.step.kind === "select-target"
    ? combat.attackerIds : new Set<string>();
  const oppTargetIds = combat.step.kind === "select-target" ? combat.targetCardIds : new Set<string>();
  const guardbreakIds = combat.step.kind === "guardbreak" ? combat.guardbreakIds : new Set<string>();
  const yourBlockerIds = combat.step.kind === "defend" ? combat.blockerIds : new Set<string>();
  const reassembleIds = combat.step.kind === "reassemble" ? combat.step.instanceIds : new Set<string>();
  const frozenIds = new Set(frozenIncomeIds(state)); // cards whose income is suppressed (Asset Freeze)
  const spotlightIds = actionFx?.spotlightIds;
  const spotlightKill = actionFx?.isKill ?? false;

  const pendingAttacker = combat.pendingAttackerId ? findCard(state, combat.pendingAttackerId) : null;
  const selectedAttacker = selectedAttackerId ? findCard(state, selectedAttackerId) : null;
  const attackerName = (selectedAttacker && cardDefFor(selectedAttacker)?.name) ||
    (pendingAttacker && cardDefFor(pendingAttacker)?.name) || undefined;

  const oppFlags: ZoneFlags = {
    selectedId,
    legalInstanceIds,
    actionableIds,
    targetIds: oppTargetIds,
    guardbreakIds,
    lungingId: lunge?.dir === -1 ? lunge.id : null,
    lungeDir: -1,
    damagePreview,
    frozenIds,
    displayDefById,
    displayAtkById,
    spotlightIds,
    spotlightKill,
    keywordTitles: KEYWORD_TEXT,
  };
  const yourFlags: ZoneFlags = {
    selectedId,
    selectedAttackerId,
    legalInstanceIds,
    actionableIds,
    attackerIds: yourAttackerIds,
    blockerIds: yourBlockerIds,
    guardbreakIds: reassembleIds,
    lungingId: lunge?.dir === 1 ? lunge.id : null,
    lungeDir: 1,
    displayDefById,
    displayAtkById,
    spotlightIds,
    spotlightKill,
    keywordTitles: KEYWORD_TEXT,
  };

  const reassembleActions = combat.step.kind === "reassemble"
    ? yourCombatIntents
        .filter((i): i is Extract<Intent, { kind: "reassembleChoice" }> => i.kind === "reassembleChoice")
        .map((i) => ({ label: intentLabel(state, i), onClick: () => dispatch(i), primary: i.pay }))
    : undefined;

  return (
    <div
      className={"ew-game" + (handOpen ? " is-hand-open" : "")}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        if (rect.bottom - e.clientY < 96) setHandOpen(true);
      }}
      onWheel={(e) => {
        if (!handOpen || !handLogRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        handLogRef.current.scrollTop += e.deltaY;
      }}
      onMouseLeave={() => setHandOpen(false)}
    >
      <header className="ew-game__hud">
        <PlayerPanel player={top} active={state.activePlayerId === top.id} isYou={false} moneyDelta={actionFx?.money[top.id] ?? 0} fxKey={actionFx?.id} thinking={aiPending} />
        <PhaseBar phase={state.phase} turnNumber={state.turnNumber} />
        <PlayerPanel player={bottom} active={state.activePlayerId === bottom.id} isYou={true} moneyDelta={actionFx?.money[bottom.id] ?? 0} fxKey={actionFx?.id} />
      </header>

      <div className="ew-game__toolbar">
        <button className="ew-toolbar__btn ew-toolbar__btn--concede" onClick={() => dispatch({ kind: "concede", player: PLAYER_A })}>
          Concede
        </button>
        <button className="ew-toolbar__btn" onClick={() => resetGame()}>
          New Game
        </button>
        <button className="ew-toolbar__btn ew-toolbar__btn--ai-deck" onClick={cycleAiDeck} title="Change AI deck and start a new game">
          AI Deck: {aiDeckName}
        </button>
        <button className="ew-toolbar__btn" onClick={copyGameLog} title="Copy a full game log (seed, decks, every move) for AI debugging">
          {copied ? "Copied! ✓" : "📋 Copy log"}
        </button>
        {(selectedId || selectedAttackerId) && (
          <button className="ew-toolbar__btn" onClick={() => { setSelectedId(null); setSelectedAttackerId(null); }}>
            Clear Selection
          </button>
        )}
      </div>

      <div className="ew-game__layout">
        <div className="ew-game__center">
          <main className="ew-board">
            <PhaseBanner phase={state.phase} turnNumber={state.turnNumber} isYou={isYourTurn} />
            <ActionBanner caption={actionFx?.caption ?? null} category={actionFx?.category ?? ""} isYou={actionFx?.actorId === PLAYER_A} fxId={actionFx?.id} />
            <CombatPrompt
              step={combat.step}
              attackerName={attackerName}
              onCancelAttacker={selectedAttackerId ? () => setSelectedAttackerId(null) : undefined}
              onDirectAttack={
                combat.directAttackIntent ? () => dispatch(combat.directAttackIntent!) : undefined
              }
              onSkipBlock={() => {
                const skip = yourCombatIntents.find(
                  (i) => i.kind === "skipBlock" && i.attackerId === combat.pendingAttackerId,
                );
                if (skip) dispatch(skip);
              }}
              reassembleActions={reassembleActions}
            />
            <section className="ew-hand-zone ew-hand-zone--opp">
              <div className="ew-hand-zone__head">
                <span>Opp. Hand</span>
                <span className="ew-zone__count">{top.hand.length}</span>
              </div>
              <div className="ew-hand-zone__cards">
                <CardBack count={top.hand.length} />
              </div>
            </section>
            <Zone title="Opp. Ongoing" cards={top.ongoing} flags={{ selectedId, legalInstanceIds, keywordTitles: KEYWORD_TEXT }} onSelect={handleCardClick} compact />
            <Zone title="Opp. Back Row" cards={top.backRow} flags={oppFlags} onSelect={handleCardClick} compact />
            <Zone title="Opp. Front Row" cards={top.frontRow} flags={oppFlags} onSelect={handleCardClick} />
            <div className="ew-board__divider" />
            <Zone title="Your Front Row" cards={bottom.frontRow} flags={yourFlags} onSelect={handleCardClick} />
            <Zone title="Your Back Row" cards={bottom.backRow} flags={{ selectedId, legalInstanceIds, guardbreakIds: reassembleIds, frozenIds, displayDefById, displayAtkById, spotlightIds, spotlightKill, keywordTitles: KEYWORD_TEXT }} onSelect={handleCardClick} />
            <Zone title="Your Ongoing" cards={bottom.ongoing} flags={{ selectedId, legalInstanceIds, keywordTitles: KEYWORD_TEXT }} onSelect={handleCardClick} compact />
          </main>

          <aside className="ew-game__side">
            <AnimatePresence>
              {showIncomePanel && (
                <IncomePanel
                  breakdown={breakdown}
                  optimizeActions={yourOptimize.map((i) => ({
                    label: intentLabel(state, i),
                    onClick: () => dispatch(i),
                  }))}
                  onCollect={() => advanceFromIncome && dispatch(advanceFromIncome)}
                />
              )}
            </AnimatePresence>
            <section className="ew-panel ew-panel--actions">
              <div className="ew-panel__head">
                <h3>Actions</h3>
                {error && <button className="ew-panel__dismiss" onClick={() => setError(null)}>Dismiss</button>}
              </div>
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="ew-error"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="ew-actions">
                {groupedActions.length === 0 ? (
                  <span className="ew-muted">Waiting...</span>
                ) : (
                  groupedActions.map(([category, intents]) => (
                    <div key={category} className="ew-actions__group">
                      <span className="ew-actions__group-label">{category}</span>
                      <div className="ew-actions__group-items">
                        {intents.map((intent, idx) => (
                          <motion.button
                            key={`${intent.kind}-${idx}-${JSON.stringify(intent)}`}
                            className={
                              "ew-action" +
                              (intent.kind === "endTurn" || intent.kind === "advancePhase" ? " ew-action--phase" : "")
                            }
                            onClick={() => dispatch(intent)}
                            onMouseEnter={() => setHoveredIntent(intent)}
                            onMouseLeave={() => setHoveredIntent(null)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                          >
                            {intent.player !== active.id && (
                              <span className="ew-action__player">{state.players[intent.player]?.name}: </span>
                            )}
                            {intentLabel(state, intent)}
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="ew-panel ew-panel--detail">
              <h3>Details</h3>
              {selectedId ? (
                <SelectedCard state={state} instanceId={selectedId} />
              ) : (
                <span className="ew-muted">Click a card for details.</span>
              )}
            </section>

            <section className="ew-panel ew-panel--log">
              <h3>Log</h3>
              <div className="ew-log-scroll" ref={panelLogRef}>
                {state.log.slice(-20).map((event) => (
                  <motion.p
                    key={event.at}
                    className={"ew-log-entry" + (event.type === "gameOver" ? " ew-log-entry--important" : "")}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {event.message}
                  </motion.p>
                ))}
              </div>
            </section>
          </aside>
        </div>

        <section className="ew-hand-log" aria-label="Game log">
          <h3>Log</h3>
          <div className="ew-log-scroll" ref={handLogRef}>
            {state.log.slice(-12).map((event) => (
              <motion.p
                key={`hand-${event.at}`}
                className={"ew-log-entry" + (event.type === "gameOver" ? " ew-log-entry--important" : "")}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
              >
                {event.message}
              </motion.p>
            ))}
          </div>
        </section>

        <section
          className="ew-hand"
          style={handOpen ? { transform: "translateY(0)" } : undefined}
          onMouseEnter={() => setHandOpen(true)}
          onMouseLeave={() => setHandOpen(false)}
        >
          <div className="ew-hand__head">
            <span>{isYourTurn ? "Your Hand" : "Opponent's Turn"}</span>
            <span className="ew-zone__count">{bottom.hand.length}</span>
          </div>
          <div className="ew-hand__cards">
            <AnimatePresence mode="popLayout">
              {bottom.hand.map((card) => {
                const d = cardDefFor(card);
                if (!d) return null;
                return (
                  <CardSlot
                    key={card.instanceId}
                    card={card}
                    selected={selectedId === card.instanceId}
                    legal={legalInstanceIds.has(card.instanceId)}
                    isActionable={legalInstanceIds.has(card.instanceId) && state.phase === "build"}
                    onClick={() => handleCardClick(card.instanceId)}
                    keywordTitles={KEYWORD_TEXT}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {state.winnerId && <WinnerOverlay state={state} onRestart={resetGame} onCopyLog={copyGameLog} copied={copied} />}
      </AnimatePresence>
    </div>
  );
}

function SelectedCard({ state, instanceId }: { state: GameState; instanceId: string }) {
  const card = findCard(state, instanceId);
  const d = card ? cardDefFor(card) : undefined;
  if (!card || !d) return <span className="ew-muted">Unknown card.</span>;
  const art = artUrl(d);
  return (
    <div className="ew-selected">
      <div className="ew-selected__art" style={{ ["--faction-primary" as string]: "var(--accent)" }}>
        {art ? <img src={art} alt={d.name} /> : <Card card={d} size="md" showText />}
      </div>
      <div className="ew-selected__title">
        <strong>{d.name}</strong>
        <span>{d.faction} / {d.type}</span>
      </div>
      {d.text && <p className="ew-selected__text">{d.text}</p>}
      {d.keywords.length > 0 && (
        <ul className="ew-selected__keywords">
          {d.keywords.map((k) => (
            <li key={k}><strong>{k}:</strong> {KEYWORD_TEXT[k]}</li>
          ))}
        </ul>
      )}
      <dl className="ew-selected__info">
        <div><dt>Zone</dt><dd>{card.row ?? "hidden"}</dd></div>
        <div><dt>Controller</dt><dd>{state.players[card.controllerId]?.name}</dd></div>
        {d.atk !== null && <div><dt>ATK</dt><dd>{effectiveAtk(state, card, CARD_INDEX)}</dd></div>}
        {d.def !== null && <div><dt>DEF</dt><dd>{card.currentDef != null ? effectiveDef(state, card, CARD_INDEX) : d.def}</dd></div>}
        {d.income !== null && d.income !== 0 && <div><dt>Income</dt><dd>{d.income}{card.tempIncomeModifier ? ` (${card.tempIncomeModifier > 0 ? "+" : ""}${card.tempIncomeModifier})` : ""}</dd></div>}
        {card.exhausted && <div><dt>Status</dt><dd className="ew-selected__exhausted">Exhausted</dd></div>}
        {card.cannotAttack && <div><dt>Status</dt><dd>Cannot Attack</dd></div>}
        {card.cannotBlock && <div><dt>Status</dt><dd>Cannot Block</dd></div>}
        {(card.reassembledCount ?? 0) > 0 && <div><dt>Reassembled</dt><dd>{card.reassembledCount}x</dd></div>}
      </dl>
    </div>
  );
}
