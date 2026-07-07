/**
 * How to Play screen (mode=guide).
 *
 * A scannable in-app version of the complete player reference. It favors
 * quick onboarding inside a modal over exhaustive rules-lawyer detail.
 */

import type { CardDef } from "@ew/shared";
import { Card } from "../components/Card";
import { getCard } from "../cards";
import { navigate } from "../router";

interface GuideCard {
  title: string;
  body: string;
}

interface GlossaryItem {
  term: string;
  body: string;
}

const FEATURED_IDS = [
  "phase-wraith",
  "data-yoko",
  "linda-husk",
  "demolisher-x",
];

const QUICK_RULES: GuideCard[] = [
  {
    title: "Money is life",
    body:
      "You spend money to play cards, and you lose when you hit 0 money with no income source left at end of turn.",
  },
  {
    title: "Front row fights",
    body:
      "Ready front-row Characters and Vehicles can attack. Front-row Characters can also block for you.",
  },
  {
    title: "Back row earns",
    body:
      "Back-row Characters and Locations are your economy. They make money, but they usually cannot fight.",
  },
  {
    title: "Drain the bank",
    body:
      "Destroy income, steal with Raid, land direct hits, and force awkward choices until the opponent cannot recover.",
  },
];

const TURN_STEPS: GuideCard[] = [
  { title: "1. Start", body: "Ready your exhausted cards. Start-of-turn effects trigger." },
  { title: "2. Draw", body: "Draw one card. If the deck is empty, you simply stop drawing." },
  { title: "3. Income", body: "Collect money from back-row earners and Locations. Optimize can exhaust for extra cash here." },
  { title: "4. Build", body: "Play cards, move one non-Vehicle character between rows, and choose Recycle or Resale once." },
  { title: "5. Combat", body: "Attack, choose targets, assign blocks, deal damage, and resolve Raid or Reassemble." },
  { title: "6. End", body: "Temporary effects wear off, losses are checked, and the turn passes." },
];

const KEYWORDS: GlossaryItem[] = [
  { term: "Raid X", body: "When this deals combat damage, steal X money from the opponent." },
  { term: "Reassemble", body: "When destroyed, pay its reassemble cost to return it exhausted in the back row with -1 DEF." },
  { term: "Optimize", body: "During Income, exhaust this card for +1 money. Optimize (Linda) needs another Linda card." },
  { term: "Deploy", body: "When it enters, move it between rows for free. Vehicles still cannot move to the back." },
  { term: "Guardbreak", body: "When attacking, choose an enemy front-row character that cannot block this attack." },
  { term: "Siege", body: "Attack the enemy back row through the front line. That back-row strike cannot be blocked." },
  { term: "Fork", body: "Create a temporary token copy when the card enters play." },
  { term: "Vehicle", body: "A front-line unit that enters the front row and cannot move to the back row." },
];

const FACTIONS: GuideCard[] = [
  {
    title: "Yoko Imperium",
    body:
      "Stable income, Optimize, defensive buffs, and control. Yoko wants to out-value the table, then close with money drain.",
  },
  {
    title: "Spooky Ones",
    body:
      "Fragile pressure with Raid, Guardbreak, bounce, and disruption. Spooky wins by making the opponent's money disappear.",
  },
  {
    title: "Linda Bioroids",
    body:
      "Attrition, Reassemble, tokens, and recursion. Linda boards are annoying to truly kill and love long games.",
  },
  {
    title: "System X",
    body:
      "Vehicles, Locations, ramp, and Siege. System X builds infrastructure, then breaks the enemy back row.",
  },
];

const STARTERS: GuideCard[] = [
  { title: "Spooky Reboot", body: "Aggressive Raid plus bounce. Great if you like tempo and economic pressure." },
  { title: "Linda Parallel", body: "Self-replicating swarm with Reassemble and token tricks." },
  { title: "Yoko Continuity", body: "Income, control, and late-game money drain." },
  { title: "System X Mobilize", body: "Ramp into vehicles and unblockable Siege pressure." },
];

const TIPS = [
  "Do not move your last income source forward unless you can survive the crack-back.",
  "Attack income before attacking the player; broke opponents cannot rebuild.",
  "Hold removal for engines: Locations, Ongoings, and high-income back-row cards.",
  "Direct attacks are only available once the enemy has no back row and has taken a first turn.",
  "Recycle fixes a bad hand; Resale converts an extra card into money right now.",
];

function isCard(card: CardDef | undefined): card is CardDef {
  return card !== undefined;
}

function MiniCardGrid({ items }: { items: GuideCard[] }) {
  return (
    <div className="ew-guide__mini-grid">
      {items.map((item) => (
        <article className="ew-guide__mini" key={item.title}>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>
      ))}
    </div>
  );
}

export function HowToPlay() {
  const featured = FEATURED_IDS.map(getCard).filter(isCard);

  return (
    <div className="ew-screen ew-guide">
      <section className="ew-guide__hero" aria-labelledby="guide-title">
        <div className="ew-guide__hero-copy">
          <span className="ew-guide__eyebrow">Player Reference</span>
          <h1 id="guide-title" className="ew-screen__title">How to Play</h1>
          <p className="ew-screen__lead">
            Economy Warfare is a 1v1 tactical card game where money is both
            your resource and your life total. Build an economy, protect your
            income, and collapse your rival's bank before they do the same to you.
          </p>
          <div className="ew-guide__actions">
            <button className="ew-btn ew-btn--primary" onClick={() => navigate({ mode: "deck" })}>
              Build a deck
            </button>
            <button className="ew-btn" onClick={() => navigate({ mode: "solo" })}>
              Practice solo
            </button>
          </div>
        </div>

        <div className="ew-guide__hero-panel" aria-label="Win condition">
          <span className="ew-guide__stat-label">You lose when</span>
          <strong>0 money</strong>
          <span>and no income source at end of turn</span>
        </div>
      </section>

      <nav className="ew-guide__toc" aria-label="Guide sections">
        <a href="#guide-core">Core</a>
        <a href="#guide-turn">Turn</a>
        <a href="#guide-combat">Combat</a>
        <a href="#guide-keywords">Keywords</a>
        <a href="#guide-factions">Factions</a>
        <a href="#guide-tips">Tips</a>
      </nav>

      <section id="guide-core" className="ew-guide__section">
        <div className="ew-guide__section-head">
          <span className="ew-guide__eyebrow">The short version</span>
          <h2>Core Ideas</h2>
        </div>
        <MiniCardGrid items={QUICK_RULES} />
      </section>

      <section className="ew-guide__section">
        <div className="ew-guide__board">
          <div className="ew-guide__row ew-guide__row--opponent">Opponent back row: income and Locations</div>
          <div className="ew-guide__row ew-guide__row--opponent">Opponent front row: blockers and attackers</div>
          <div className="ew-guide__row ew-guide__row--you">Your front row: attackers and blockers</div>
          <div className="ew-guide__row ew-guide__row--you">Your back row: income and infrastructure</div>
        </div>
        <div>
          <span className="ew-guide__eyebrow">Board shape</span>
          <h2>Two rows, two jobs</h2>
          <p>
            A back-row unit earns money but cannot fight. A front-row unit can
            attack and block, but usually stops earning. Each Build phase you
            may move one non-Vehicle character, so every row choice is a budget
            decision.
          </p>
        </div>
      </section>

      <section id="guide-turn" className="ew-guide__section">
        <div className="ew-guide__section-head">
          <span className="ew-guide__eyebrow">Six phases</span>
          <h2>Your Turn</h2>
        </div>
        <div className="ew-guide__timeline">
          {TURN_STEPS.map((step) => (
            <article key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="guide-combat" className="ew-guide__section ew-guide__section--split">
        <div>
          <span className="ew-guide__eyebrow">Combat priorities</span>
          <h2>Who can you attack?</h2>
          <ol className="ew-guide__ordered">
            <li>If the defender has a front row, attack the front row first.</li>
            <li>Siege attackers can bypass the front row and hit the back row unblockably.</li>
            <li>If there is no front row, the back row is exposed.</li>
            <li>If there is no back row and first-turn protection is over, attack money directly.</li>
          </ol>
        </div>
        <div className="ew-guide__callout">
          <h3>Damage is not pooled</h3>
          <p>
            Each attacker fights one target. Multiple attackers do not combine
            damage into one defender, so picking the right target matters.
          </p>
        </div>
      </section>

      <section id="guide-keywords" className="ew-guide__section">
        <div className="ew-guide__section-head">
          <span className="ew-guide__eyebrow">Recurring rules text</span>
          <h2>Keyword Glossary</h2>
        </div>
        <div className="ew-guide__glossary">
          {KEYWORDS.map((item) => (
            <article key={item.term}>
              <h3>{item.term}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="guide-factions" className="ew-guide__section">
        <div className="ew-guide__section-head">
          <span className="ew-guide__eyebrow">Pick a plan</span>
          <h2>Factions and Starters</h2>
        </div>
        <MiniCardGrid items={FACTIONS} />
        <div className="ew-guide__starter-strip">
          {STARTERS.map((starter) => (
            <article key={starter.title}>
              <strong>{starter.title}</strong>
              <span>{starter.body}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="ew-guide__section">
        <div className="ew-guide__section-head">
          <span className="ew-guide__eyebrow">Signature examples</span>
          <h2>Cards to Notice</h2>
        </div>
        <div className="ew-guide__cards">
          {featured.map((card) => (
            <Card key={card.id} card={card} size="md" showText />
          ))}
        </div>
      </section>

      <section id="guide-tips" className="ew-guide__section ew-guide__section--split">
        <div>
          <span className="ew-guide__eyebrow">First games</span>
          <h2>Strategy Quick Reference</h2>
          <ul className="ew-guide__tips">
            {TIPS.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </div>
        <div className="ew-guide__callout ew-guide__callout--gold">
          <h3>Good default plan</h3>
          <p>
            Spend early turns building income, move pressure forward once you
            can still survive a bad turn, then attack the opponent's earners
            before going for direct money hits.
          </p>
        </div>
      </section>
    </div>
  );
}
