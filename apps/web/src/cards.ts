/**
 * Card data access for the web client.
 *
 * `data/cards.json` is the single source of truth (owned by the data agent).
 * We import it directly (Vite's `resolveJsonModule`) and expose a typed index.
 *
 * NOTE on the engine: `@ew/engine` exposes `buildCardIndex`, but while the
 * engine is still stubbed those functions throw. Card *display* (deck editor,
 * card frame, previews) only needs the static `CardDef[]`, so we build a local
 * lookup here and do NOT call the engine for it. Anything that advances actual
 * game state must still go through `@ew/engine.applyIntent` — see
 * `src/game/GameBoard.tsx`.
 */

import type { CardDef } from "@ew/shared";
import cardsJson from "../../../data/cards.json";

interface CardsFile {
  version: string;
  cards: CardDef[];
}

const file = cardsJson as unknown as CardsFile;

export const ALL_CARDS: readonly CardDef[] = file.cards;

const BY_ID = new Map<string, CardDef>(file.cards.map((c) => [c.id, c]));

export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}

/**
 * Optimized art path served from public/cards. See scripts/prepare-art.mjs.
 *
 * Without `sharp`, the plain-copy fallback keeps the source extension from the
 * card's `art` field. With `sharp` installed, the emitted file is `<id>.webp`.
 * Prefer the source extension for this dev box; the `<Card/>` frame handles
 * load failure by showing a placeholder, so optimized webp builds still fail
 * gracefully until the manifest is moved out of `public`.
 */
function artExtension(art: string): string {
  const filename = art.split(/[\\/]/).pop() ?? art;
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "webp";
}

export function artUrl(card: CardDef): string | null {
  if (!card.art) return null;
  return `${import.meta.env.BASE_URL}cards/${card.id}.${artExtension(card.art)}`;
}
