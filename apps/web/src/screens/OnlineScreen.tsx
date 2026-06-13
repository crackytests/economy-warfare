import { useEffect, useMemo, useRef, useState } from "react";
import type { CardDef, CardInstance, DeckList, GameState, Intent, Phase, PlayerId, TableInfo, TargetRef } from "@ew/shared";
import { buildCardIndex, getLegalIntents, effectiveAtk, effectiveDef, type CardIndex } from "@ew/engine";
import { useOnlineServer } from "../game/useOnlineServer";
import { Card } from "../components/Card";
import { ALL_CARDS, artUrl, getCard } from "../cards";
import { ACTIVE_DECK_ID, loadActiveDeck, loadSavedDecks } from "../deck/storage";
import { KEYWORD_TEXT } from "../game/keywords";
import starterDecksJson from "../../../../data/starter_decks.json";
import "../game/GameBoard.css";

interface StarterDecksFile {
  decks: DeckList[];
}
const STARTER_DECKS = (starterDecksJson as StarterDecksFile).decks;

/** All decks selectable in the lobby: the player's saved decks, then starters. */
function allSelectableDecks(): DeckList[] {
  const active = loadActiveDeck();
  const saved = loadSavedDecks();
  const decks = active ? [active, ...saved.filter((d) => d.id !== active.id)] : saved;
  const seen = new Set(decks.map((d) => d.id));
  return [...decks, ...STARTER_DECKS.filter((d) => !seen.has(d.id))];
}

function deckOptionLabel(deck: DeckList): string {
  if (deck.id === ACTIVE_DECK_ID) return `${deck.name} (current editor deck)`;
  if (STARTER_DECKS.some((s) => s.id === deck.id)) return `${deck.name} (starter)`;
  return deck.name;
}

function opponentOf(state: GameState, player: PlayerId): PlayerId {
  return state.turnOrder[0] === player ? state.turnOrder[1] : state.turnOrder[0];
}

function findCard(state: GameState, instanceId: string) {
  for (const pid of state.turnOrder) {
    const p = state.players[pid]!;
    for (const zone of [p.hand, p.frontRow, p.backRow, p.ongoing, p.discard]) {
      const c = zone.find((x) => x.instanceId === instanceId);
      if (c) return c;
    }
  }
  return null;
}

// Shared index so the online view shows effective (aura/buff-adjusted) stats via
// the engine's own effectiveAtk/effectiveDef — no UI-side re-derivation.
const CARD_INDEX: CardIndex = buildCardIndex(ALL_CARDS as CardDef[]);

function targetLabel(state: GameState, target: TargetRef | undefined): string {
  if (!target) return "";
  if (target.kind === "player") return state.players[target.playerId]?.name ?? target.playerId;
  const card = findCard(state, target.instanceId);
  return (card ? getCard(card.cardId)?.name : undefined) ?? "card";
}

function intentLabel(state: GameState, intent: Intent): string {
  switch (intent.kind) {
    case "mulligan":
      return intent.keep ? "Keep hand" : "Mulligan (draw 4)";
    case "playCard": {
      const c = findCard(state, intent.instanceId);
      const name = (c ? getCard(c.cardId)?.name : undefined) ?? "card";
      const tgt = targetLabel(state, intent.targets?.[0]);
      return tgt ? `Play ${name} -> ${tgt}` : `Play ${name}`;
    }
    case "moveCharacter": {
      const c = findCard(state, intent.instanceId);
      return `Move ${(c ? getCard(c.cardId)?.name : undefined) ?? "character"} to ${intent.toRow}`;
    }
    case "optimize": {
      const c = findCard(state, intent.instanceId);
      return `Optimize ${(c ? getCard(c.cardId)?.name : undefined) ?? "card"} (+$1)`;
    }
    case "recycle": {
      const c = findCard(state, intent.discardInstanceId);
      return `Recycle ${(c ? getCard(c.cardId)?.name : undefined) ?? "card"} (-$1, draw 1)`;
    }
    case "resale": {
      const c = findCard(state, intent.discardInstanceId);
      return `Resale ${(c ? getCard(c.cardId)?.name : undefined) ?? "card"} (+$1)`;
    }
    case "activateAbility":
      return `Ability -> ${targetLabel(state, intent.targets?.[0])}`;
    case "declareAttack": {
      const atk = findCard(state, intent.attackerId);
      return `Attack: ${(atk ? getCard(atk.cardId)?.name : undefined) ?? "card"} -> ${targetLabel(state, intent.target)}`;
    }
    case "guardbreakChoice":
      return "Guardbreak choice";
    case "declareBlock": {
      const b = findCard(state, intent.blockerId);
      return `Block with ${(b ? getCard(b.cardId)?.name : undefined) ?? "card"}`;
    }
    case "skipBlock":
      return "Take hit (no block)";
    case "reassembleChoice":
      return intent.pay ? "Reassemble (pay)" : "Decline Reassemble";
    case "resolveChoice":
      return `Choose option ${intent.optionIndex + 1}`;
    case "advancePhase":
      return "Next Phase";
    case "endTurn":
      return "End Turn";
    case "concede":
      return "Concede";
  }
}

function intentTouchesCard(intent: Intent, instanceId: string): boolean {
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

const PHASE_LABELS: Record<Phase, string> = {
  start: "Start",
  draw: "Draw",
  income: "Income",
  build: "Build",
  combat: "Combat",
  end: "End",
};

const PHASE_ORDER: Phase[] = ["start", "draw", "income", "build", "combat", "end"];

function OnlinePhaseBar({ phase, turnNumber }: { phase: Phase; turnNumber: number }) {
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

function OnlinePlayerPanel({
  player,
  active,
  isYou,
}: {
  player: GameState["players"][PlayerId];
  active: boolean;
  isYou: boolean;
}) {
  return (
    <div className={"ew-player" + (active ? " is-active" : "") + (isYou ? " is-you" : "")}>
      <div className="ew-player__name">
        <strong>{isYou ? "You" : player.name}</strong>
        {active && <span className="ew-player__active-badge">ACTIVE</span>}
      </div>
      <div className="ew-player__stats">
        <span className="ew-money__value">${player.money}</span>
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

function OnlineCard({
  card,
  state,
  selected,
  legal,
  onSelect,
}: {
  card: CardInstance;
  state: GameState;
  selected: boolean;
  legal: boolean;
  onSelect: (instanceId: string) => void;
}) {
  const d = getCard(card.cardId);
  const shownDef = card.currentDef == null ? null : effectiveDef(state, card, CARD_INDEX);
  const shownAtk = effectiveAtk(state, card, CARD_INDEX);
  if (!d) {
    return (
      <div className="ew-card-slot ew-card-slot--back">
        <div className="ew-card-back" />
      </div>
    );
  }
  return (
    <div
      className={"ew-card-slot" + (selected ? " is-selected" : "") + (legal ? " is-legal" : "")}
      onClick={() => onSelect(card.instanceId)}
    >
      <Card
        card={d}
        size="sm"
        exhausted={card.exhausted}
        currentDef={shownDef}
        currentAtk={shownAtk}
        keywordTitles={KEYWORD_TEXT}
      />
    </div>
  );
}

function OnlineCardBack({ count }: { count: number }) {
  return (
    <div className="ew-card-slot ew-card-slot--back">
      <div className="ew-card-back">
        <span className="ew-card-back__count">{count}</span>
      </div>
    </div>
  );
}

function OnlineRow({
  title,
  cards,
  state,
  selectedId,
  legalInstanceIds,
  onSelect,
  compact,
}: {
  title: string;
  cards: CardInstance[];
  state: GameState;
  selectedId: string | null;
  legalInstanceIds: Set<string>;
  onSelect: (instanceId: string) => void;
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
          cards.map((card) => (
            <OnlineCard
              key={card.instanceId}
              card={card}
              state={state}
              selected={selectedId === card.instanceId}
              legal={legalInstanceIds.has(card.instanceId)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </section>
  );
}

function OnlineSelectedCard({ state, instanceId, cards }: { state: GameState; instanceId: string; cards: CardIndex }) {
  const card = findCard(state, instanceId);
  const d = card ? getCard(card.cardId) : undefined;
  if (!card || !d) return <span className="ew-muted">Unknown card.</span>;
  const art = artUrl(d);
  return (
    <div className="ew-selected">
      <div className="ew-selected__art">
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
            <li key={k}>
              <strong>{k}:</strong> {KEYWORD_TEXT[k]}
            </li>
          ))}
        </ul>
      )}
      <dl className="ew-selected__info">
        <div><dt>Zone</dt><dd>{card.row ?? "hidden"}</dd></div>
        <div><dt>Controller</dt><dd>{state.players[card.controllerId]?.name}</dd></div>
        {d.atk !== null && <div><dt>ATK</dt><dd>{effectiveAtk(state, card, CARD_INDEX)}</dd></div>}
        {d.def !== null && <div><dt>DEF</dt><dd>{card.currentDef != null ? effectiveDef(state, card, CARD_INDEX) : d.def}</dd></div>}
        {d.income !== null && d.income !== 0 && <div><dt>Income</dt><dd>{d.income}</dd></div>}
        {card.exhausted && <div><dt>Status</dt><dd className="ew-selected__exhausted">Exhausted</dd></div>}
      </dl>
    </div>
  );
}

/** The live online board, driven entirely by the server's redacted view. */
function OnlineBoard({
  state,
  youAre,
  cards,
  roomId,
  events,
  error,
  gameOver,
  spectator = false,
  spectatorCount = 0,
  onIntent,
  onLeave,
  onClearError,
}: {
  state: GameState;
  youAre: PlayerId;
  cards: CardIndex;
  roomId: string | null;
  events: string[];
  error: string | null;
  gameOver: PlayerId | null;
  spectator?: boolean;
  spectatorCount?: number;
  onIntent: (intent: Intent) => void;
  onLeave: () => void;
  onClearError: () => void;
}) {
  const me = state.players[youAre]!;
  const oppId = opponentOf(state, youAre);
  const opp = state.players[oppId]!;
  const isMyTurn = state.activePlayerId === youAre;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handOpen, setHandOpen] = useState(false);
  const handLogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (handLogRef.current) handLogRef.current.scrollTop = handLogRef.current.scrollHeight;
  }, [events.length]);

  // Legal intents come from the pure engine run over the redacted view. Hidden
  // opponent cards are "__hidden__" and simply yield no extra affordances. This
  // is advisory UI only — the server re-validates every intent authoritatively.
  // Spectators have no seat and never act, so they get no affordances at all.
  const myIntents = useMemo(
    () => (spectator ? [] : getLegalIntents(state, youAre, cards).filter((i) => i.kind !== "concede")),
    [spectator, state, youAre, cards],
  );

  const legalInstanceIds = useMemo(() => {
    const legal = new Set<string>();
    for (const intent of myIntents) {
      for (const playerId of state.turnOrder) {
        const player = state.players[playerId]!;
        for (const card of [...player.hand, ...player.frontRow, ...player.backRow, ...player.ongoing, ...player.discard]) {
          if (intentTouchesCard(intent, card.instanceId)) legal.add(card.instanceId);
        }
      }
    }
    return legal;
  }, [myIntents, state]);

  function selectCard(instanceId: string) {
    setSelectedId(instanceId);
    const card = findCard(state, instanceId);
    if (card?.controllerId === youAre && card.row === null) setHandOpen(true);
  }

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
        <OnlinePlayerPanel player={opp} active={state.activePlayerId === oppId} isYou={false} />
        <OnlinePhaseBar phase={state.phase} turnNumber={state.turnNumber} />
        <OnlinePlayerPanel player={me} active={state.activePlayerId === youAre} isYou />
      </header>

      <div className="ew-game__toolbar">
        <span className="ew-muted" style={{ padding: 0 }}>
          Room: <strong>{roomId}</strong> ·{" "}
          {spectator
            ? `Spectating — ${state.players[state.activePlayerId]?.name ?? ""}'s turn`
            : isMyTurn
              ? "Your turn"
              : `${opp.name}'s turn`}
        </span>
        {spectatorCount > 0 && (
          <span className="ew-watching" title={`${spectatorCount} watching`}>
            <span className="ew-watching__eye" aria-hidden="true">&#128065;</span> {spectatorCount}
          </span>
        )}
        {!spectator && !gameOver && (
          <button
            className="ew-toolbar__btn ew-toolbar__btn--concede"
            onClick={() => onIntent({ kind: "concede", player: youAre })}
          >
            Concede
          </button>
        )}
        <button className="ew-toolbar__btn" onClick={onLeave}>
          {spectator ? "Stop watching" : "Leave"}
        </button>
        {selectedId && (
          <button className="ew-toolbar__btn" onClick={() => setSelectedId(null)}>
            Clear Selection
          </button>
        )}
      </div>

      {gameOver && (
        <div
          style={{
            padding: "var(--sp-3)",
            textAlign: "center",
            color: "var(--accent)",
            fontFamily: "var(--font-display)",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {state.players[gameOver]?.name ?? gameOver} wins!
        </div>
      )}

      <div className="ew-game__layout">
        <div className="ew-game__center">
          <main className="ew-board">
            <section className="ew-hand-zone ew-hand-zone--opp">
              <div className="ew-hand-zone__head">
                <span>Opp. Hand</span>
                <span className="ew-zone__count">{opp.hand.length}</span>
              </div>
              <div className="ew-hand-zone__cards">
                <OnlineCardBack count={opp.hand.length} />
              </div>
            </section>
            <OnlineRow title="Opp. Ongoing" cards={opp.ongoing} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} compact />
            <OnlineRow title="Opp. Back Row" cards={opp.backRow} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} compact />
            <OnlineRow title="Opp. Front Row" cards={opp.frontRow} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} />
            <div className="ew-board__divider" />
            <OnlineRow title="Your Front Row" cards={me.frontRow} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} />
            <OnlineRow title="Your Back Row" cards={me.backRow} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} />
            <OnlineRow title="Your Ongoing" cards={me.ongoing} state={state} selectedId={selectedId} legalInstanceIds={legalInstanceIds} onSelect={selectCard} compact />
          </main>

          <aside className="ew-game__side">
            <section className="ew-panel ew-panel--actions">
              <div className="ew-panel__head">
                <h3>Actions</h3>
                {error && (
                  <button className="ew-panel__dismiss" onClick={onClearError}>
                    Dismiss
                  </button>
                )}
              </div>
              {error && <div className="ew-error">{error}</div>}
              <div className="ew-actions">
                {gameOver ? (
                  <span className="ew-muted">Game over.</span>
                ) : spectator ? (
                  <span className="ew-muted">Spectating — read only. You can click cards to inspect them.</span>
                ) : myIntents.length === 0 ? (
                  <span className="ew-muted">
                    {isMyTurn ? "No actions available." : "Waiting for opponent..."}
                  </span>
                ) : (
                  myIntents.map((intent, i) => (
                    <button
                      key={`${intent.kind}-${i}`}
                      className={
                        "ew-action" +
                        (intent.kind === "endTurn" || intent.kind === "advancePhase"
                          ? " ew-action--phase"
                          : "") +
                        (intent.kind === "declareAttack" ? " ew-action--attack" : "")
                      }
                      onClick={() => onIntent(intent)}
                    >
                      {intentLabel(state, intent)}
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="ew-panel ew-panel--detail">
              <h3>Details</h3>
              {selectedId ? (
                <OnlineSelectedCard state={state} instanceId={selectedId} cards={cards} />
              ) : (
                <span className="ew-muted">Click a card for details.</span>
              )}
            </section>
          </aside>
        </div>

        <section className="ew-hand-log" aria-label="Game log">
          <h3>Log</h3>
          <div className="ew-log-scroll" ref={handLogRef}>
            {events.slice(-12).map((e, i) => (
              <p key={`${e}-${i}`} className="ew-log-entry">
                {e}
              </p>
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
            <span>{isMyTurn ? "Your Hand" : "Opponent's Turn"}</span>
            <span className="ew-zone__count">{me.hand.length}</span>
          </div>
          <div className="ew-hand__cards">
            {me.hand.map((card) => (
              <OnlineCard
                key={card.instanceId}
                card={card}
                state={state}
                selected={selectedId === card.instanceId}
                legal={legalInstanceIds.has(card.instanceId)}
                onSelect={selectCard}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

/** One browsable table: two seats you can sit in, or a live game you can watch. */
function LobbyTable({
  table,
  isNew,
  disabled,
  onSit,
  onWatch,
}: {
  table: TableInfo;
  isNew?: boolean;
  disabled?: boolean;
  onSit: (seat: PlayerId) => void;
  onWatch?: () => void;
}) {
  const live = table.status === "live" || table.status === "over";
  const statusText =
    table.status === "live" ? "In game" : table.status === "over" ? "Finished" : table.status === "waiting" ? "Waiting" : isNew ? "New table" : "Open";

  const seat = (id: PlayerId) => {
    const name = id === "p1" ? table.seats.p1 : table.seats.p2;
    const occupied = name != null;
    const canSit = !occupied && !live && !disabled;
    return (
      <button
        className="ew-table__seat"
        disabled={!canSit}
        aria-label={occupied ? `${name} is seated` : "Sit in this seat"}
        onClick={() => canSit && onSit(id)}
      >
        <span className={"ew-table__disc" + (occupied ? " is-occupied" : canSit ? " is-open" : " is-empty")}>
          {occupied ? initials(name!) : canSit ? "+" : ""}
        </span>
        <span className="ew-table__seat-name">{occupied ? name : canSit ? "Sit here" : "—"}</span>
      </button>
    );
  };

  return (
    <div className={"ew-table" + (isNew ? " is-new" : "")}>
      {seat("p1")}
      <div className="ew-table__surface">
        <span className="ew-table__code">{isNew ? "click a seat" : table.code}</span>
        <span className={"ew-table__status ew-table__status--" + table.status}>{statusText}</span>
        {live && onWatch && (
          <button className="ew-btn ew-btn--sm" style={{ marginTop: 6 }} onClick={onWatch} disabled={disabled}>
            Watch{table.spectators > 0 ? ` (${table.spectators})` : ""}
          </button>
        )}
      </div>
      {seat("p2")}
    </div>
  );
}

export function OnlineScreen({ deckId }: { deckId: string | null }) {
  const cards = useMemo(() => buildCardIndex(ALL_CARDS as CardDef[]), []);
  const selectableDecks = useMemo(() => allSelectableDecks(), []);

  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("Player");
  const [chosenDeckId, setChosenDeckId] = useState<string>(
    () =>
      selectableDecks.find((d) => d.id === deckId)?.id ??
      selectableDecks.find((d) => d.id === "systemx-mobilize-starter")?.id ??
      selectableDecks[0]?.id ??
      "",
  );

  // Connect as soon as the screen mounts so the lobby populates while browsing.
  const transport = useOnlineServer(true);
  const {
    status,
    connected,
    view,
    youAre,
    roomId,
    inRoom,
    gameStarted,
    spectating,
    tables,
    events,
    error,
    gameOver,
    serverUrl,
    joinRoom,
    spectateRoom,
    sendIntent,
    leaveRoom,
    clearError,
  } = transport;

  const chosenDeck = selectableDecks.find((d) => d.id === chosenDeckId) ?? selectableDecks[0]!;
  const ready = !!playerName && connected;

  const sit = (code: string, seat: PlayerId) => joinRoom(code, playerName, chosenDeck, { seat });
  const createPrivate = () => joinRoom("", playerName, chosenDeck, { private: true });

  // ---- In-game (player or spectator) ----
  if (gameStarted && view) {
    return (
      <OnlineBoard
        state={view.state}
        youAre={view.youAre}
        cards={cards}
        roomId={roomId}
        events={events}
        error={error}
        gameOver={gameOver}
        spectator={!!view.spectator}
        spectatorCount={view.spectators ?? 0}
        onIntent={(intent) => sendIntent({ ...intent, player: youAre ?? view.youAre } as Intent)}
        onLeave={leaveRoom}
        onClearError={clearError}
      />
    );
  }

  // ---- Spectating, waiting for the game to begin ----
  if (spectating) {
    return (
      <div className="ew-screen">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", maxWidth: 420 }}>
          <h1 className="ew-screen__title">Watching {roomId}</h1>
          <p className="ew-muted">Waiting for the game to start…</p>
          {events.length > 0 && <p className="ew-muted">{events[events.length - 1]}</p>}
          <button className="ew-btn" onClick={leaveRoom}>Back to lobby</button>
        </div>
      </div>
    );
  }

  // ---- Waiting for an opponent (you're seated; game not started) ----
  if (inRoom) {
    return (
      <div className="ew-screen">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", maxWidth: 420 }}>
          <h1 className="ew-screen__title">Waiting for opponent</h1>
          <p className="ew-screen__lead">You're seated at this table. Share the code or wait for someone to sit down:</p>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: 4,
              color: "var(--accent)",
              textAlign: "center",
              padding: "var(--sp-3)",
              border: "1px solid var(--line)",
              borderRadius: 8,
            }}
          >
            {roomId}
          </div>
          <p className="ew-muted">You are {youAre}. The game starts when a second player joins.</p>
          {events.length > 0 && <p className="ew-muted">{events[events.length - 1]}</p>}
          {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
          <button className="ew-btn" onClick={leaveRoom}>Leave table</button>
        </div>
      </div>
    );
  }

  // ---- Lobby (browsable tables) ----
  const newTable: TableInfo = { code: "", seats: { p1: null, p2: null }, status: "open", spectators: 0 };
  return (
    <div className="ew-screen ew-screen--wide">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)", width: "100%", maxWidth: 880 }}>
        <h1 className="ew-screen__title">Play Online</h1>

        <div className="ew-lobby__bar">
          <label className="ew-lobby__field">
            <span>Name</span>
            <input className="ew-deck__search" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Player" />
          </label>
          <label className="ew-lobby__field" style={{ flex: 1, minWidth: 180 }}>
            <span>Deck</span>
            <select className="ew-deck__sort" value={chosenDeckId} onChange={(e) => setChosenDeckId(e.target.value)}>
              {selectableDecks.map((d) => (
                <option key={d.id} value={d.id}>{deckOptionLabel(d)}</option>
              ))}
            </select>
          </label>
          <button className="ew-btn ew-btn--sm" disabled={!ready} onClick={createPrivate} title="Create a private table not shown in the lobby">
            Private table
          </button>
        </div>

        {!connected && (
          <p className="ew-muted" style={{ fontSize: 12 }}>
            {status === "connecting" ? "Connecting…" : `Offline — ${serverUrl}`}
          </p>
        )}
        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12, display: "flex", gap: 8 }}>
            {error}
            <button className="ew-panel__dismiss" onClick={clearError}>Dismiss</button>
          </div>
        )}

        <p className="ew-screen__lead" style={{ margin: 0 }}>
          {tables.length === 0 ? "No open tables yet — sit at a new one to start a game." : "Click a seat to sit down. Watch any game in progress."}
        </p>

        <div className="ew-lobby__grid">
          {tables.map((t) => (
            <LobbyTable key={t.code} table={t} disabled={!ready} onSit={(seat) => sit(t.code, seat)} onWatch={() => spectateRoom(t.code)} />
          ))}
          <LobbyTable table={newTable} isNew disabled={!ready} onSit={(seat) => sit("", seat)} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-2)", fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          or join a private table by code
          <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, maxWidth: 360 }}>
          <input
            className="ew-deck__search"
            style={{ flex: 1, textTransform: "uppercase" }}
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.trim().toUpperCase())}
            placeholder="e.g. K7Q2"
          />
          <button className="ew-btn" disabled={!roomCode || !ready} onClick={() => joinRoom(roomCode, playerName, chosenDeck)}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
