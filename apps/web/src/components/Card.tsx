/**
 * Card — the reusable card frame.
 *
 * Renders a CardDef as a faction-themed card: name, faction, cost, type,
 * ATK/DEF/income, keywords, rules text and art. When `art` is null (the
 * mapping pass / optimization hasn't produced an image yet) it shows a
 * graceful faction-tinted placeholder.
 *
 * This is a *presentational* component — it knows nothing about game state.
 * WS5's in-game board composes it with interaction/animation; WS4's deck
 * editor composes it in the browser grid. Keep it pure and side-effect free.
 */

import { useState } from "react";
import type { CardDef } from "@ew/shared";
import { FACTION_THEME, factionVars } from "../theme/factions";
import { artUrl } from "../cards";
import "./Card.css";

export type CardSize = "sm" | "md" | "lg";

export interface CardProps {
  card: CardDef;
  size?: CardSize;
  /** Show full rules text (detail view) vs. just keywords (grid view). */
  showText?: boolean;
  /** Render exhausted (rotated/dimmed) — used by the board. */
  exhausted?: boolean;
  /** Override DEF shown (current vs base) — used by the board for damage. */
  currentDef?: number | null;
  /** Override ATK shown (effective vs base) — used by the board for auras/buffs. */
  currentAtk?: number | null;
  /** Optional per-keyword tooltip text (board passes the glossary). */
  keywordTitles?: Partial<Record<string, string>>;
  onClick?: () => void;
  className?: string;
}

function Stat({
  label,
  value,
  tone,
  base,
}: {
  label: string;
  value: number;
  tone: "atk" | "def" | "income";
  /** Printed base, to flag when the shown value is buffed/debuffed. */
  base?: number;
}) {
  const buffState =
    base == null || value === base ? "" : value > base ? " is-buffed" : " is-debuffed";
  return (
    <div
      className={`ew-card__stat ew-card__stat--${tone}${buffState}`}
      title={buffState && base != null ? `${label} ${value} (base ${base})` : label}
    >
      <span className="ew-card__stat-value">{value}</span>
      <span className="ew-card__stat-label">{label}</span>
    </div>
  );
}

export function Card({
  card,
  size = "md",
  showText = false,
  exhausted = false,
  currentDef,
  currentAtk,
  keywordTitles,
  onClick,
  className = "",
}: CardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const theme = FACTION_THEME[card.faction];
  const src = artUrl(card);
  const showArt = src && !imgFailed;
  const def = currentDef ?? card.def;
  const atk = currentAtk ?? card.atk;

  const classes = [
    "ew-card",
    `ew-card--${size}`,
    exhausted ? "ew-card--exhausted" : "",
    onClick ? "ew-card--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={factionVars(card.faction)}
      data-faction={card.faction}
      data-type={card.type}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <header className="ew-card__head">
        <span className="ew-card__cost" aria-label={`Cost ${card.cost}`}>
          {card.cost}
        </span>
        <span className="ew-card__name" title={card.name}>
          {card.name}
        </span>
      </header>

      <div className="ew-card__art">
        {showArt ? (
          <img
            src={src}
            alt={card.name}
            loading="lazy"
            draggable={false}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="ew-card__art-placeholder" aria-hidden="true">
            <span className="ew-card__art-mark">{theme.label}</span>
            <span className="ew-card__art-sub">{card.type}</span>
          </div>
        )}
        <span className="ew-card__faction-chip">{theme.label}</span>
      </div>

      <div className="ew-card__body">
        <div className="ew-card__typeline">
          <span>{card.type}</span>
          {card.keywords.length > 0 && (
            <span className="ew-card__keywords">
              {card.keywords.map((k) => (
                <span key={k} className="ew-card__kw" title={keywordTitles?.[k]}>
                  {k}
                </span>
              ))}
            </span>
          )}
        </div>

        {showText && card.text && (
          <p className="ew-card__text">{card.text}</p>
        )}
      </div>

      <footer className="ew-card__stats">
        {card.atk !== null && <Stat label="ATK" value={atk ?? card.atk} tone="atk" base={card.atk} />}
        {def !== null && <Stat label="DEF" value={def} tone="def" base={card.def ?? undefined} />}
        {card.income !== null && card.income !== 0 && (
          <Stat label="INC" value={card.income} tone="income" />
        )}
      </footer>
    </div>
  );
}
