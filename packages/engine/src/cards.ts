/**
 * Test/dev helper: load data/cards.json and data/starter_decks.json into the
 * engine's CardIndex / DeckList shapes.
 *
 * This is a convenience for tests (and tools). It uses node:fs and is therefore
 * NOT part of the pure runtime engine — production callers (server/web) pass an
 * already-parsed cards array into buildCardIndex. Keep fs usage confined here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CardDef, DeckList } from "@ew/shared";
import { buildCardIndex, type CardIndex } from "./index";

// packages/engine/src -> repo root is three levels up.
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "..", "..", "..", "data");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf8")) as T;
}

/** Load the canonical card definitions from data/cards.json. */
export function loadCardDefs(): CardDef[] {
  return readJson<{ cards: CardDef[] }>("cards.json").cards;
}

/** Build a CardIndex from data/cards.json. */
export function loadCardIndex(): CardIndex {
  return buildCardIndex(loadCardDefs());
}

/** Load the 4 starter decks from data/starter_decks.json. */
export function loadStarterDecks(): DeckList[] {
  return readJson<{ decks: DeckList[] }>("starter_decks.json").decks;
}

/** Get one starter deck by id (e.g. "system-x-starter"). */
export function starterDeck(id: string): DeckList {
  const deck = loadStarterDecks().find((d) => d.id === id);
  if (!deck) throw new Error(`No starter deck "${id}"`);
  return deck;
}
