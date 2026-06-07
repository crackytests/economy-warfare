/**
 * Ownership / collection boundary.
 *
 * FUTURE: each card will sit on its own bonding curve — the more copies of a
 * card are owned across all players, the more valuable that card becomes. That
 * economy is NOT implemented now, but everything is funneled through this
 * interface so it can be slotted in later without touching the rules engine or
 * the gameplay UI.
 *
 * HARD RULE: the rules engine (packages/engine) must NEVER import this file.
 * Only the deck editor, matchmaking/lobby, and (later) the marketplace consume
 * it. Gameplay is ownership-agnostic — a legal DeckList plays identically
 * regardless of how it was acquired.
 */

import type { DeckList, PlayerId } from "./types";

export interface DeckLegality {
  ok: boolean;
  reasons: string[];
}

export interface CardValuation {
  cardId: string;
  /** Current price on the card's bonding curve (in whatever unit). 0 in the stub. */
  price: number;
  /** Total copies minted/owned across the system — the bonding-curve input. */
  supply: number;
}

export interface CardOwnership {
  /** How many copies the user owns. Infinity in the "everything unlocked" stub. */
  ownedCount(userId: PlayerId, cardId: string): Promise<number>;

  /** Validate a deck against ownership + DECK_RULES. */
  validateDeck(userId: PlayerId, deck: DeckList): Promise<DeckLegality>;

  /** Bonding-curve valuation for a card. Stubbed flat now. */
  valuation(cardId: string): Promise<CardValuation>;
}

/**
 * Default stub: everyone owns everything, all cards are free.
 * The deck editor uses this today; only DECK_RULES (size, copy limits) are
 * enforced. Swap this implementation later for the on-chain / bonding-curve one.
 */
export class UnlimitedOwnership implements CardOwnership {
  async ownedCount(): Promise<number> {
    return Number.POSITIVE_INFINITY;
  }

  async validateDeck(_userId: PlayerId, deck: DeckList): Promise<DeckLegality> {
    // NOTE: structural DECK_RULES validation (size/copies) is implemented in the
    // engine's deck validator (packages/engine) and reused here. This stub adds
    // no ownership restrictions on top.
    const reasons: string[] = [];
    const total = deck.cards.reduce((n, c) => n + c.count, 0);
    if (total !== 40) reasons.push(`Deck must have 40 cards (has ${total}).`);
    for (const c of deck.cards) {
      if (c.count > 4) reasons.push(`Too many copies of ${c.id} (${c.count} > 4).`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  async valuation(cardId: string): Promise<CardValuation> {
    return { cardId, price: 0, supply: 0 };
  }
}
