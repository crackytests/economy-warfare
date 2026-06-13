import { useMemo, useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CardDef, DeckList, Faction } from "@ew/shared";
import { DECK_RULES } from "@ew/shared";
import { validateDeck, buildCardIndex, type CardIndex } from "@ew/engine";
import { UnlimitedOwnership } from "@ew/shared/ownership";
import { Card } from "../components/Card";
import { ALL_CARDS, getCard } from "../cards";
import { FACTION_THEME, factionVars } from "../theme/factions";
import { KEYWORD_TEXT } from "../game/keywords";
import starterDecksJson from "../../../../data/starter_decks.json";
import { ACTIVE_DECK_ID, loadSavedDecks, saveActiveDeck, saveDecks } from "./storage";
import "./DeckEditor.css";

export interface DeckEditorProps {
  deckId?: string | null;
  onPlay?: (deckId: string, mode: "solo" | "online") => void;
}

interface StarterDecksFile {
  decks: DeckList[];
}

const STARTER_DECKS = (starterDecksJson as StarterDecksFile).decks;

const FACTIONS: Faction[] = [
  "Yoko Imperium",
  "Spooky Ones",
  "Linda Bioroids",
  "System X",
  "Neutral",
];

type SortKey = "name" | "cost" | "atk" | "def" | "income";

function sortCards(cards: CardDef[], key: SortKey): CardDef[] {
  return [...cards].sort((a, b) => {
    switch (key) {
      case "name": return a.name.localeCompare(b.name);
      case "cost": return a.cost - b.cost;
      case "atk": return (b.atk ?? -1) - (a.atk ?? -1);
      case "def": return (b.def ?? -1) - (a.def ?? -1);
      case "income": return (b.income ?? 0) - (a.income ?? 0);
    }
  });
}

function deckToCounts(deck: DeckList): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of deck.cards) m.set(c.id, c.count);
  return m;
}

function countsToDeck(name: string, faction: Faction | "Mixed", counts: Map<string, number>): DeckList {
  const cards: DeckList["cards"] = [];
  for (const [id, count] of counts) {
    if (count > 0) cards.push({ id, count });
  }
  return { id: `custom-${Date.now()}`, name, faction, cards };
}

function totalCards(counts: Map<string, number>): number {
  let n = 0;
  for (const c of counts.values()) n += c;
  return n;
}

export function DeckEditor({ deckId, onPlay }: DeckEditorProps) {
  const cards = useMemo(() => buildCardIndex(ALL_CARDS as CardDef[]), []);
  const ownership = useMemo(() => new UnlimitedOwnership(), []);

  const savedDecks = useMemo(() => loadSavedDecks(), []);
  const [savedList, setSavedList] = useState<DeckList[]>(savedDecks);
  const allDecks = useMemo(() => [...STARTER_DECKS, ...savedList], [savedList]);

  const initialDeck = useMemo(
    () => allDecks.find((d) => d.id === deckId) ?? null,
    [allDecks, deckId],
  );

  const [deckName, setDeckName] = useState(initialDeck?.name ?? "New Deck");
  const [counts, setCounts] = useState<Map<string, number>>(
    () => initialDeck ? deckToCounts(initialDeck) : new Map(),
  );
  const [search, setSearch] = useState("");
  const [factionFilter, setFactionFilter] = useState<Faction | "All">("All");
  const [sortBy, setSortBy] = useState<SortKey>("cost");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showStarterPicker, setShowStarterPicker] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const total = totalCards(counts);
  const legality = useMemo(() => {
    const deck = countsToDeck(deckName, "Mixed", counts);
    const structural = validateDeck(deck, cards);
    return structural;
  }, [counts, deckName, cards]);

  const addCard = useCallback((cardId: string) => {
    setCounts((prev) => {
      const next = new Map(prev);
      const cur = next.get(cardId) ?? 0;
      if (cur >= DECK_RULES.maxCopies) return prev;
      next.set(cardId, cur + 1);
      return next;
    });
  }, []);

  const removeCard = useCallback((cardId: string) => {
    setCounts((prev) => {
      const next = new Map(prev);
      const cur = next.get(cardId) ?? 0;
      if (cur <= 0) return prev;
      if (cur === 1) next.delete(cardId);
      else next.set(cardId, cur - 1);
      return next;
    });
  }, []);

  const setCardCount = useCallback((cardId: string, count: number) => {
    setCounts((prev) => {
      const next = new Map(prev);
      if (count <= 0) next.delete(cardId);
      else next.set(cardId, Math.min(count, DECK_RULES.maxCopies));
      return next;
    });
  }, []);

  const loadDeck = useCallback((deck: DeckList) => {
    setCounts(deckToCounts(deck));
    setDeckName(deck.name);
    setShowStarterPicker(false);
  }, []);

  const deleteDeck = useCallback((id: string) => {
    setSavedList((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDecks(next);
      return next;
    });
  }, []);

  const saveDeck = useCallback(() => {
    const deck = countsToDeck(deckName, "Mixed", counts);
    if (!legality.ok) {
      setSaveMsg("Fix deck errors before saving.");
      return;
    }
    const existing = savedList.findIndex((d) => d.name === deckName);
    const next = [...savedList];
    if (existing >= 0) {
      deck.id = next[existing]!.id;
      next[existing] = deck;
    } else {
      next.push(deck);
    }
    setSavedList(next);
    saveDecks(next);
    setSaveMsg("Deck saved!");
    setTimeout(() => setSaveMsg(null), 2000);
  }, [deckName, counts, legality, savedList]);

  const playCurrentDeck = useCallback((mode: "solo" | "online") => {
    if (!legality.ok) return;
    saveActiveDeck(countsToDeck(deckName, "Mixed", counts));
    onPlay?.(ACTIVE_DECK_ID, mode);
  }, [counts, deckName, legality.ok, onPlay]);

  const filteredPool = useMemo(() => {
    let pool = ALL_CARDS as CardDef[];
    if (factionFilter !== "All") {
      pool = pool.filter((c) => c.faction === factionFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      pool = pool.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q) ||
          c.text.toLowerCase().includes(q) ||
          c.keywords.some((k) => k.toLowerCase().includes(q)),
      );
    }
    return sortCards(pool, sortBy);
  }, [factionFilter, search, sortBy]);

  const deckCards = useMemo(() => {
    const out: { def: CardDef; count: number }[] = [];
    for (const [id, count] of counts) {
      const d = getCard(id);
      if (d) out.push({ def: d, count });
    }
    return out.sort((a, b) => a.def.name.localeCompare(b.def.name));
  }, [counts]);

  const selectedDef = selectedCardId ? getCard(selectedCardId) : null;

  return (
    <div className="ew-deck">
      <header className="ew-deck__header">
        <div className="ew-deck__title-row">
          <input
            className="ew-deck__name-input"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder="Deck name"
          />
          <div className="ew-deck__header-actions">
            <button className="ew-btn ew-btn--sm" onClick={() => setShowStarterPicker(!showStarterPicker)}>
              Load Deck
            </button>
            <button className="ew-btn ew-btn--sm ew-btn--primary" onClick={saveDeck} disabled={!legality.ok}>
              Save
            </button>
            {onPlay && legality.ok && (
              <>
                <button className="ew-btn ew-btn--sm" onClick={() => playCurrentDeck("solo")}>
                  Play Solo
                </button>
              </>
            )}
          </div>
        </div>
        <div className="ew-deck__status">
          <span className={total === DECK_RULES.size ? "ew-deck__count--ok" : "ew-deck__count--bad"}>
            {total} / {DECK_RULES.size}
          </span>
          {legality.reasons.length > 0 && (
            <span className="ew-deck__errors">
              {legality.reasons.map((r, i) => (
                <span key={i} className="ew-deck__error">{r}</span>
              ))}
            </span>
          )}
          <AnimatePresence>
            {saveMsg && (
              <motion.span
                className="ew-deck__save-msg"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {saveMsg}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </header>

      <AnimatePresence>
        {showStarterPicker && (
          <motion.div
            className="ew-deck__picker"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="ew-deck__picker-grid">
              {allDecks.map((deck) => {
                const isSaved = savedList.some((d) => d.id === deck.id);
                return (
                  <div key={deck.id} className="ew-deck__picker-cell">
                    <button
                      className="ew-deck__picker-tile"
                      onClick={() => loadDeck(deck)}
                    >
                      <span className="ew-deck__picker-faction" style={{ color: FACTION_THEME[deck.faction as Faction]?.primary ?? "var(--ink-2)" }}>
                        {deck.faction}
                      </span>
                      <span className="ew-deck__picker-name">{deck.name}</span>
                    </button>
                    {isSaved && (
                      <button
                        className="ew-deck__picker-delete"
                        title="Delete saved deck"
                        aria-label={`Delete ${deck.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete saved deck "${deck.name}"?`)) deleteDeck(deck.id);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ew-deck__body">
        <section className="ew-deck__pool">
          <div className="ew-deck__filters">
            <input
              className="ew-deck__search"
              type="text"
              placeholder="Search cards..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="ew-deck__faction-filters">
              <button
                className={"ew-deck__faction-btn" + (factionFilter === "All" ? " is-active" : "")}
                onClick={() => setFactionFilter("All")}
              >
                All
              </button>
              {FACTIONS.map((f) => (
                <button
                  key={f}
                  className={"ew-deck__faction-btn" + (factionFilter === f ? " is-active" : "")}
                  onClick={() => setFactionFilter(f)}
                  style={factionFilter === f ? { background: FACTION_THEME[f].primary, color: "#000" } : { "--faction-c": FACTION_THEME[f].primary } as React.CSSProperties}
                >
                  {FACTION_THEME[f].label}
                </button>
              ))}
            </div>
            <select className="ew-deck__sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
              <option value="cost">Cost</option>
              <option value="name">Name</option>
              <option value="atk">ATK</option>
              <option value="def">DEF</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div className="ew-deck__pool-grid">
            {filteredPool.map((card) => (
              <DeckPoolCard
                key={card.id}
                card={card}
                count={counts.get(card.id) ?? 0}
                onAdd={addCard}
                onSelected={() => setSelectedCardId(card.id)}
              />
            ))}
            {filteredPool.length === 0 && (
              <span className="ew-muted">No cards match your filters.</span>
            )}
          </div>
        </section>

        <section className="ew-deck__list">
          <h3 className="ew-deck__list-title">
            Deck
            <span className="ew-deck__list-count">{total}</span>
          </h3>
          {deckCards.length === 0 ? (
            <span className="ew-muted">Click cards to add them.</span>
          ) : (
            <div className="ew-deck__list-cards">
              {deckCards.map(({ def, count }) => (
                <DeckListRow
                  key={def.id}
                  card={def}
                  count={count}
                  onAdd={addCard}
                  onRemove={removeCard}
                  onSetCount={setCardCount}
                  onSelected={() => setSelectedCardId(def.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {selectedDef && (
          <CardDetailOverlay
            card={selectedDef}
            count={counts.get(selectedDef.id) ?? 0}
            ownership={ownership}
            onAdd={addCard}
            onRemove={removeCard}
            onClose={() => setSelectedCardId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function DeckPoolCard({
  card,
  count,
  onAdd,
  onSelected,
}: {
  card: CardDef;
  count: number;
  onAdd: (id: string) => void;
  onSelected: () => void;
}) {
  return (
    <div className="ew-deck-pool-card" onClick={onSelected}>
      <Card card={card} size="sm" />
      <div className="ew-deck-pool-card__footer">
        <button
          className="ew-deck-pool-card__add"
          onClick={(e) => { e.stopPropagation(); onAdd(card.id); }}
          disabled={count >= DECK_RULES.maxCopies}
        >
          +
        </button>
        {count > 0 && (
          <span className="ew-deck-pool-card__count">{count}</span>
        )}
      </div>
    </div>
  );
}

function DeckListRow({
  card,
  count,
  onAdd,
  onRemove,
  onSetCount,
  onSelected,
}: {
  card: CardDef;
  count: number;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onSetCount: (id: string, count: number) => void;
  onSelected: () => void;
}) {
  const theme = FACTION_THEME[card.faction];
  return (
    <div className="ew-deck-list-row" style={factionVars(card.faction)}>
      <div className="ew-deck-list-row__faction-dot" style={{ background: theme.primary }} />
      <span className="ew-deck-list-row__cost">{card.cost}</span>
      <span className="ew-deck-list-row__name" onClick={onSelected}>{card.name}</span>
      <span className="ew-deck-list-row__type">{card.type}</span>
      <div className="ew-deck-list-row__controls">
        <button onClick={() => onRemove(card.id)}>-</button>
        <input
          type="number"
          min={0}
          max={DECK_RULES.maxCopies}
          value={count}
          onChange={(e) => onSetCount(card.id, Math.max(0, Math.min(DECK_RULES.maxCopies, parseInt(e.target.value) || 0)))}
        />
        <button onClick={() => onAdd(card.id)} disabled={count >= DECK_RULES.maxCopies}>+</button>
      </div>
    </div>
  );
}

function CardDetailOverlay({
  card,
  count,
  ownership,
  onAdd,
  onRemove,
  onClose,
}: {
  card: CardDef;
  count: number;
  ownership: UnlimitedOwnership;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [valuation, setValuation] = useState<number | null>(null);
  useEffect(() => {
    ownership.valuation(card.id).then((v: { price: number }) => setValuation(v.price));
  }, [card.id, ownership]);

  return (
    <motion.div
      className="ew-card-detail-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="ew-card-detail"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        onClick={(e) => e.stopPropagation()}
      >
        <Card card={card} size="lg" showText />
        <div className="ew-card-detail__info">
          <div className="ew-card-detail__row">
            <span>In Deck</span>
            <div className="ew-card-detail__controls">
              <button className="ew-btn ew-btn--sm" onClick={() => onRemove(card.id)} disabled={count <= 0}>-</button>
              <strong>{count}</strong>
              <button className="ew-btn ew-btn--sm" onClick={() => onAdd(card.id)} disabled={count >= DECK_RULES.maxCopies}>+</button>
            </div>
          </div>
          <div className="ew-card-detail__row">
            <span>Value</span>
            <span className="ew-card-detail__value">${valuation ?? "..."}</span>
          </div>
          <div className="ew-card-detail__row ew-card-detail__row--keywords">
            <span>Keywords</span>
            <span>{card.keywords.length > 0 ? card.keywords.join(", ") : "None"}</span>
          </div>
          {card.keywords.length > 0 && (
            <ul className="ew-card-detail__keywords">
              {card.keywords.map((k) => (
                <li key={k}>
                  <strong>{k}:</strong> {KEYWORD_TEXT[k]}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="ew-btn ew-card-detail__close" onClick={onClose}>Close</button>
      </motion.div>
    </motion.div>
  );
}
