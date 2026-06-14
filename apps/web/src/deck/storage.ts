import type { DeckList } from "@ew/shared";

export const DECK_STORAGE_KEY = "ew-decks";
export const ACTIVE_DECK_ID = "current-editor-deck";
const ACTIVE_DECK_STORAGE_KEY = "ew-active-deck";

export function loadSavedDecks(): DeckList[] {
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DeckList[];
  } catch {
    return [];
  }
}

export function saveDecks(decks: DeckList[]): void {
  localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(decks));
}

export function saveActiveDeck(deck: DeckList): void {
  localStorage.setItem(ACTIVE_DECK_STORAGE_KEY, JSON.stringify({ ...deck, id: ACTIVE_DECK_ID }));
}

export function loadActiveDeck(): DeckList | null {
  try {
    const raw = localStorage.getItem(ACTIVE_DECK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DeckList;
  } catch {
    return null;
  }
}

// ---- Online lobby preferences (last-used name + deck) ----------------------

const ONLINE_NAME_KEY = "ew-online-name";
const ONLINE_DECK_KEY = "ew-online-deck";

export function loadOnlineName(): string | null {
  try {
    return localStorage.getItem(ONLINE_NAME_KEY);
  } catch {
    return null;
  }
}

export function saveOnlineName(name: string): void {
  try {
    localStorage.setItem(ONLINE_NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function loadOnlineDeckId(): string | null {
  try {
    return localStorage.getItem(ONLINE_DECK_KEY);
  } catch {
    return null;
  }
}

export function saveOnlineDeckId(id: string): void {
  try {
    localStorage.setItem(ONLINE_DECK_KEY, id);
  } catch {
    /* ignore */
  }
}
