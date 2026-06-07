import type { CardDef } from "@ew/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface CardsFile {
  version: string;
  cards: CardDef[];
}

const dataPath = resolve(__dirname, "../../../data/cards.json");
const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as CardsFile;

export const ALL_CARDS: readonly CardDef[] = raw.cards;
