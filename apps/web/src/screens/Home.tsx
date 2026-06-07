/**
 * Home / main menu. Entry point when launched without a `?mode=`.
 * Also doubles as a small showcase of the design system (faction palette +
 * Card frame) so WS4/WS5 can see the baseline they plug into.
 */

import { navigate } from "../router";
import { FACTION_THEME } from "../theme/factions";
import { ALL_CARDS } from "../cards";
import { Card } from "../components/Card";
import type { Faction } from "@ew/shared";

const FACTIONS: Faction[] = [
  "Yoko Imperium",
  "Spooky Ones",
  "Linda Bioroids",
  "System X",
  "Neutral",
];

// One representative card per faction for the preview gallery.
function sampleCards() {
  const picked: typeof ALL_CARDS[number][] = [];
  for (const f of FACTIONS) {
    const c = ALL_CARDS.find((x) => x.faction === f);
    if (c) picked.push(c);
  }
  return picked;
}

export function Home() {
  const samples = sampleCards();
  return (
    <div className="ew-screen">
      <div>
        <h1 className="ew-screen__title">Economy Warfare</h1>
        <p className="ew-screen__lead">
          Build a 40-card deck, then grind your opponent's economy to zero.
          Income, infrastructure, and raids — out-build and out-bank your rival.
        </p>
      </div>

      <div className="ew-home__grid">
        <button
          className="ew-home__tile"
          onClick={() => navigate({ mode: "deck" })}
        >
          <span className="ew-home__tile-tag">Build</span>
          <h3>Deck Editor</h3>
          <p>Assemble and save 40-card decks from the full card pool.</p>
        </button>
        <button
          className="ew-home__tile"
          onClick={() => navigate({ mode: "solo" })}
        >
          <span className="ew-home__tile-tag">Practice</span>
          <h3>Play Solo</h3>
          <p>Face the Solo AI offline. Runs entirely in your browser.</p>
        </button>
        <button
          className="ew-home__tile"
          onClick={() => navigate({ mode: "online" })}
        >
          <span className="ew-home__tile-tag">Compete</span>
          <h3>Play Online</h3>
          <p>Server-authoritative 1v1. Join with a room code.</p>
        </button>
      </div>

      <section>
        <h2 className="ew-screen__title" style={{ fontSize: 18 }}>
          Factions
        </h2>
        <div className="ew-faction-strip">
          {FACTIONS.map((f) => (
            <span
              key={f}
              className="ew-faction-swatch"
              style={{ ["--sw" as string]: FACTION_THEME[f].primary }}
            >
              {f}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="ew-screen__title" style={{ fontSize: 18 }}>
          Card frame preview
        </h2>
        <div className="ew-card-gallery">
          {samples.map((c) => (
            <Card key={c.id} card={c} size="md" showText />
          ))}
        </div>
      </section>
    </div>
  );
}
