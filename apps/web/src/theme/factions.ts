/**
 * Faction theming tokens.
 *
 * Palette cues (from lore / task brief):
 *   - Yoko Imperium  — administrative / clean. Cool corporate blue + bright ink.
 *   - Spooky Ones    — glitchy ghost neon. Phantom violet/cyan on void black.
 *   - Linda Bioroids — techno-zombie / bio. Toxic bio-green + necrotic magenta.
 *   - System X       — industrial, red-glasses / Char-red. Hot crimson + steel.
 *   - Neutral        — unaligned infrastructure. Muted slate / brass.
 *
 * These feed CSS custom properties (see tokens.css). The `Card` frame and any
 * faction-tinted UI read `var(--faction-*)`, set per-element by `factionVars()`.
 */

import type { Faction } from "@ew/shared";

export interface FactionTheme {
  /** Primary accent (borders, glows, headings). */
  primary: string;
  /** Secondary accent (gradients, highlights). */
  secondary: string;
  /** Deep base used behind art / frame fill. */
  base: string;
  /** Readable foreground on top of `base`. */
  ink: string;
  /** Short label for chips/badges. */
  label: string;
}

export const FACTION_THEME: Record<Faction, FactionTheme> = {
  "Yoko Imperium": {
    primary: "#4aa3ff",
    secondary: "#bfe3ff",
    base: "#0c1c33",
    ink: "#eaf4ff",
    label: "Yoko",
  },
  "Spooky Ones": {
    primary: "#b86bff",
    secondary: "#39f6e6",
    base: "#120a22",
    ink: "#f0e6ff",
    label: "Spooky",
  },
  "Linda Bioroids": {
    primary: "#6dff8f",
    secondary: "#ff4fd8",
    base: "#0a1f10",
    ink: "#e8ffe9",
    label: "Linda",
  },
  "System X": {
    primary: "#ff3b3b",
    secondary: "#ff9a6b",
    base: "#1f0a0a",
    ink: "#ffe9e3",
    label: "System X",
  },
  Neutral: {
    primary: "#b7a98a",
    secondary: "#d9d2c2",
    base: "#1a1814",
    ink: "#f3eee3",
    label: "Neutral",
  },
};

/** Inline CSS-variable map for a faction; spread onto a `style` prop. */
export function factionVars(faction: Faction): Record<string, string> {
  const t = FACTION_THEME[faction];
  return {
    "--faction-primary": t.primary,
    "--faction-secondary": t.secondary,
    "--faction-base": t.base,
    "--faction-ink": t.ink,
  };
}
