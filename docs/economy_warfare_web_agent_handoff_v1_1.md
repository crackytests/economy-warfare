# Economy Warfare — Web Digital Version Agent Handoff

**Version:** v1.1 implementation snapshot  
**Purpose:** This document gives a coding agent everything important needed to build a browser-based digital prototype of *Economy Warfare*, including rules, state model, card data, starter decks, and implementation notes.

> Theme note: Economy Warfare is a tactical card game where money is both resource and survival. Players do not have life totals. They lose when their economy collapses.

---

## 1. Core Game Summary

Economy Warfare is a 2-player card game with:

- Persistent money (`money`) instead of life.
- Two battlefield rows per player:
  - **Front Row:** combat.
  - **Back Row:** income and infrastructure.
- Characters can move between rows.
- Back-row characters and Locations generate income.
- Players lose when they have no money and no card with income > 0 in any row (see §7).
- Combat targets cards first; direct attacks only happen when the opponent has no back-row cards.
- Actions are played only on your own Build Phase unless a card explicitly says otherwise.

---

## 2. Core Setup

```yaml
players: 2
deck_size: 40
starting_hand_size: 5
mulligan:
  allowed: true
  draw_after_mulligan: 4
starting_money: 5
starting_player: random
```

### First-Turn Raid Protection

```text
Raid cannot steal money from a player who has not yet taken their first turn.
```

Implementation flag:

```ts
player.hasTakenFirstTurn: boolean
```

Raid only steals if `targetPlayer.hasTakenFirstTurn === true`.

---

## 3. Player State Model

Suggested player state:

```ts
type PlayerState = {
  id: string;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];

  money: number;

  frontRow: CardInstance[];
  backRow: CardInstance[];
  ongoing: CardInstance[];

  hasTakenFirstTurn: boolean;
  usedMoveThisTurn: boolean;
  usedRecycleOrResaleThisTurn: boolean;
};
```

---

## 4. Card Instance State

Cards need base stats and mutable runtime stats.

```ts
type CardInstance = {
  instanceId: string;
  cardId: string;

  name: string;
  faction: Faction;
  type: CardType;

  cost: number;
  atk?: number;
  baseDef?: number;
  currentDef?: number;
  income?: number;

  keywords: Keyword[];
  rulesText: string;

  exhausted: boolean;
  cannotReadyNextStart?: boolean;

  // For Reassemble
  reassembledCount?: number;
  defPenaltyFromReassemble?: number;

  // Temporary modifiers
  tempAtkModifier?: number;
  tempDefModifier?: number;
  tempIncomeModifier?: number;

  // Flags
  cannotAttack?: boolean;
  cannotBlock?: boolean;
};
```

Suggested enums:

```ts
type Faction =
  | "Yoko Imperium"
  | "Spooky Ones"
  | "Linda Bioroids"
  | "System X"
  | "Neutral";

type CardType =
  | "Character"
  | "Vehicle"
  | "Location"
  | "Action"
  | "Ongoing";

type Keyword =
  | "Raid"
  | "Reassemble"
  | "Optimize"
  | "OptimizeLinda"
  | "Deploy"
  | "Guardbreak"
  | "Siege"
  | "Vehicle";
```

---

## 5. Zones and Rows

Each player has:

```text
Ongoing Zone
Back Row
Front Row
```

### Placement Rules

- Characters enter the **front row** by default.
- Vehicles enter the **front row** and cannot move.
- Locations enter the **back row**.
- Ongoing cards enter the **ongoing zone**.
- Actions resolve immediately and go to discard.

---

## 6. Turn Structure

```text
1. Start Phase
2. Draw Phase
3. Income Phase
4. Build Phase
5. Combat Phase
6. End Phase
```

### 6.1 Start Phase

- Ready all exhausted cards controlled by active player.
- If a card has `cannotReadyNextStart`, do not ready it; clear that flag instead.
- Resolve start-of-turn effects.
- Set:
  - `usedMoveThisTurn = false`
  - `usedRecycleOrResaleThisTurn = false`

### 6.2 Draw Phase

- Active player draws 1 card.

### 6.3 Income Phase

Active player gains money from:

- Back-row Characters with `income > 0`.
- Locations with `income > 0`.

Important:

```text
Exhausted cards still generate income unless their own text says otherwise.
```

Exception:

```text
Data Relay Station enters exhausted and does not generate income while exhausted.
```

### Optimize

During Income Phase, a ready card with **Optimize** may exhaust to generate +1 money.

For **Optimize (Linda)**:

```text
This card has Optimize if controller controls another Linda Bioroids card.
```

### 6.4 Build Phase

Active player may, in any order:

- Play cards they can afford.
- Activate Build-phase abilities.
- Move one non-Vehicle character between rows.
- Use either Recycle or Resale once.

#### Recycle / Resale

Once per turn, choose exactly one:

```text
Recycle: discard 1 card and pay 1 money to draw 1 card.
Resale: discard 1 card to gain 1 money.
```

A player may also choose neither.

### 6.5 Combat Phase

Combat order:

```text
1. Declare attackers
2. Choose targets
3. Apply Guardbreak choices
4. Declare blockers
5. Resolve damage
6. Resolve combat triggers
7. Destroy cards at 0 or less DEF
8. Resolve Reassemble and destruction triggers
```

### 6.6 End Phase

- Clear temporary modifiers.
- Resolve end-of-turn effects.
- Check loss condition.
- Mark active player as having taken first turn:

```ts
activePlayer.hasTakenFirstTurn = true;
```

---

## 7. Win / Loss Condition

At the end of any turn, a player loses if:

```text
player.money === 0
AND
player controls no card with income > 0 (in ANY row)
```

Income-saving cards (any one keeps you alive at $0) include:

- **Any in-play Character or Location with printed income > 0, in any row** —
  including the front row. A front-row earner does NOT generate income there
  (see §6.3); it only forestalls the loss, so being forced to commit an earner
  to the front line no longer instantly eliminates you.
- Cards that can currently generate income due to active effects.

> **Balance rule change (income-anywhere).** Originally only *back-row* income
> sources saved you. AI-vs-AI tuning showed the back-row-only rule punished the
> defensive factions (Yoko/Linda) for being forced to push earners forward; the
> relaxed rule is balance-neutral-to-positive and reduces feel-bad instant
> eliminations. Engine seam: `LOSS_CONFIG.incomeAnywhereSaves` (default `true`)
> in `packages/engine/src/economy.ts`; set `false` to restore the legacy rule.

---

## 8. Combat Rules

### 8.1 Attacking

Only ready front-row Characters and Vehicles may attack.

When a card attacks:

- It exhausts.
- It chooses exactly one target.
- Damage from multiple attackers does **not** combine.

### 8.2 Legal Targets

Use this as the target legality algorithm:

```ts
function getLegalAttackTargets(attacker, defender) {
  const targets = [];

  const defenderHasFront = defender.frontRow.length > 0;
  const defenderHasBack = defender.backRow.length > 0;

  if (defenderHasFront) {
    // Normal attackers must attack front row first.
    targets.push(...defender.frontRow);

    // Siege exception: Siege attackers may target Locations directly.
    if (attacker.keywords.includes("Siege")) {
      targets.push(...defender.backRow.filter(card => card.type === "Location"));
    }

    // Direct attack only if there is no back row at all.
    if (!defenderHasBack) {
      targets.push("PLAYER_DIRECT");
    }

    return targets;
  }

  // If no front row, back row is exposed.
  if (defenderHasBack) {
    targets.push(...defender.backRow);
    return targets;
  }

  // If no front row and no back row, player may be attacked directly.
  targets.push("PLAYER_DIRECT");
  return targets;
}
```

### 8.3 Direct Attacks

If a player is attacked directly:

- Defender may still block with ready front-row characters if they have any.
- If unblocked, the defender loses money equal to the attacker's ATK.
- Raid also triggers if applicable.

Direct attacks are only legal if the defender has **no back-row cards**.

### 8.4 Blocking

- Defender may assign one ready front-row character as blocker per attacker.
- Blocking is optional.
- A blocker exhausts only if a card says so. By default, blocking does not exhaust.
- Exhausted cards cannot block.

### 8.5 Damage

- Attacker and blocker deal damage simultaneously.
- If unblocked and attacking a card, attacker deals damage to the target card.
- If unblocked and attacking the player, defender loses money equal to attacker ATK.
- A card with `currentDef <= 0` is destroyed.

---

## 9. Keyword Glossary

### Raid X

```text
When this character deals combat damage, steal X money from the opponent.
If the opponent has less than X, steal as much as possible.
Raid cannot steal from a player who has not yet taken their first turn.
```

### Reassemble

```text
When this card is destroyed, you may pay its Reassemble cost.
If you do, return it exhausted in the back row with -1 DEF.
If its DEF would be 0 or less, it cannot Reassemble.
```

Default Reassemble cost: `1 money`.

Reassemble should usually only work once per card instance unless card text says otherwise.

### Optimize

```text
During your Income Phase, you may exhaust this card.
If you do, it generates +1 money.
```

### Optimize (Linda)

```text
This card has Optimize if you control another Linda Bioroids card.
```

### Deploy

```text
When this card enters play, you may immediately move this card between rows.
This does not count as your once-per-turn move.
Vehicles cannot Deploy into the back row.
```

### Guardbreak

```text
When this character attacks, choose one enemy front-row character.
That character cannot block this attack.
```

### Siege

```text
This character may attack Locations directly, ignoring front-row characters.
```

### Vehicle

```text
Vehicles enter the front row and cannot move between rows.
```

---

## 10. Global Rules and Timing Notes

### Actions

```text
Actions may only be played during your own Build Phase unless the card explicitly says otherwise.
```

No instant-speed reactions in v1.1.

### Ongoings

```text
Ongoing cards remain in play and apply continuous effects until destroyed.
Multiple Ongoing effects stack unless stated otherwise.
If an Ongoing leaves play, its effect ends immediately.
```

### Costs

```text
Costs cannot be reduced below 0.
```

### Money

```text
Money cannot go below 0.
```

### No Damage Stacking

```text
Damage from multiple attackers is not combined.
```

Each attacker is its own combat instance.

---

## 11. Current Factions

### Yoko Imperium

Theme: optimization, administration, resource control.  
Mechanical identity:

- Income stability.
- Optimize.
- Extra movement.
- Defensive positioning.

### Spooky Ones

Theme: ghostly technomancer instability.  
Mechanical identity:

- Raid.
- Guardbreak.
- Economic disruption.
- Fragile pressure.

### Linda Bioroids

Theme: self-repairing networked horde / sexy robot zombies.  
Mechanical identity:

- Reassemble.
- Attrition.
- Linda-only Optimize.
- Recursion pressure.

### System X

Theme: alternate-timeline Face industrial system.  
Mechanical identity:

- Vehicles.
- Siege.
- Locations.
- Infrastructure ramp.

---

## 12. Card Database v1.1 Snapshot

### 12.1 Yoko Imperium

| Card | Type | Cost | ATK | DEF | Income | Text |
|---|---:|---:|---:|---:|---:|---|
| Data Yoko | Character | 2 | 1 | 2 | 1 |  |
| Analyst Yoko | Character | 3 | 1 | 3 | 1 | Optimize |
| Logistics Yoko | Character | 3 | 2 | 2 | 1 | Deploy |
| Firewall Yoko | Character | 3 | 2 | 4 | 0 |  |
| Accountant Yoko | Character | 4 | 2 | 3 | 2 | Cannot attack |
| Predictive Shielding | Ongoing | 2 |  |  |  | Front-row characters you control get +1 DEF |
| Resource Reallocation | Ongoing | 3 |  |  |  | Once per turn during Build, move one additional non-Vehicle character you control |
| Governor | Character | 5 | 2 | 4 | 1 | Other back-row characters you control generate +1 money, maximum +1 |

### 12.2 Spooky Ones

| Card | Type | Cost | ATK | DEF | Income | Text |
|---|---:|---:|---:|---:|---:|---|
| Phase Wraith | Character | 3 | 3 | 1 | 0 | Raid 1 |
| Desync Skirmisher | Character | 2 | 2 | 1 | 0 | Raid 1 only if unblocked |
| Afterimage Lurker | Character | 4 | 3 | 3 | 0 | Raid 1; Cannot block |
| Glitch Adept | Character | 4 | 4 | 2 | 0 | Guardbreak |
| Reality Tumbler | Character | 3 | 2 | 2 | 0 | Deploy. When this moves to front row, it has Raid 1 this turn |
| Latency Hex | Ongoing | 2 |  |  |  | Whenever an opponent blocks, they lose 1 money |
| Phantom Pressure | Action | 3 |  |  |  | One attacking character gains Guardbreak this turn |
| Reality Leak | Ongoing | 2 |  |  |  | First time each turn an opponent loses money, they lose 1 additional |

### 12.3 Linda Bioroids

| Card | Type | Cost | ATK | DEF | Income | Text |
|---|---:|---:|---:|---:|---:|---|
| Linda Husk | Character | 2 | 2 | 2 | 0 | Reassemble |
| Signal Bride | Character | 3 | 1 | 2 | 1 | Optimize (Linda); Reassemble |
| Market Eater | Character | 3 | 3 | 2 | 0 | Raid 1 if you attacked with 3+ characters; Reassemble |
| Repair Swarm | Action | 2 |  |  |  | One Linda Bioroid you control gets +2 DEF until end of turn |
| Network Bloom | Ongoing | 3 |  |  |  | Linda Bioroids you control get +1 DEF while in back row |
| Replication Loop | Action | 4 |  |  |  | Return one destroyed Linda Bioroid to your back row with -1 DEF. It cannot Reassemble again |
| Overseer Node | Character | 5 | 2 | 4 | 1 | First other Linda Bioroid destroyed each turn Reassembles for free |
| Endless Linda | Character | 6 | 3 | 5 | 1 | First Linda Bioroid destroyed each turn Reassembles for free |

### 12.4 System X

| Card | Type | Cost | ATK | DEF | Income | Text |
|---|---:|---:|---:|---:|---:|---|
| Assembly Worker X | Character | 2 | 1 | 2 | 1 |  |
| Production Overseer X | Character | 3 | 2 | 2 | 1 | Deploy |
| Armor Platoon X | Character | 4 | 3 | 4 | 0 |  |
| Demolisher X | Vehicle | 5 | 4 | 4 | 0 | Vehicle; Siege |
| Linebreaker Walker X | Vehicle | 6 | 5 | 5 | 0 | Vehicle; Siege; Guardbreak |
| Forward Operating Base X | Location | 3 |  | 3 | 1 | Vehicles you play cost 1 less. This stacks |
| Infrastructure Audit X | Action | 3 |  |  |  | Destroy one Location |
| Director X | Character | 5 | 2 | 5 | 1 | Vehicles you control get +1 ATK |

### 12.5 Neutral Cards

| Card | Type | Cost | ATK | DEF | Income | Text |
|---|---:|---:|---:|---:|---:|---|
| System Shutdown | Action | 2 |  |  |  | Exhaust one enemy Character |
| Forced Liquidation | Action | 2 |  |  |  | Destroy one exhausted Character |
| Protocol Purge | Action | 2 |  |  |  | Destroy one Ongoing card |
| Strategic Reserve | Location | 3 |  | 3 | 1 | When this enters play, gain 2 money |
| Asset Freeze | Action | 2 |  |  |  | Choose one enemy back-row card. It generates no income during its controller's next Income Phase |
| Market Panic | Action | 2 |  |  |  | Each player loses 1 money for each exhausted character they control |
| Market Volatility | Action | 2 |  |  |  | Each player loses 1 money for each Location they control |
| Black Market Exchange | Location | 2 |  | 2 | 0 | Once per turn during Build, destroy one character you control to gain 2 money |
| Data Relay Station | Location | 4 |  | 4 | 2 | Enters exhausted. While exhausted, this card does not generate income |
| Operational Overhead | Ongoing | 2 |  |  |  | The first card each player plays each turn costs 1 more |
| Emergency Protocols | Ongoing | 3 |  |  |  | First time each turn a character you control is destroyed, next character you play costs 1 less |
| Temporary Shutdown | Action | 2 |  |  |  | Exhaust one front-row character. It does not ready during its controller's next Start Phase |
| Emergency Funding | Action | 1 |  |  |  | Gain 2 money. You gain no income during your next Income Phase |
| Emergency Shielding | Action | 2 |  |  |  | Target character you control gets +2 DEF until end of turn |
| Black Budget | Ongoing | 3 |  |  |  | Once per turn, when you would lose money from Raid, lose 1 less |
| System Audit | Action | 2 |  |  |  | Look at opponent's hand. Choose one non-Location card. It costs 1 more until end of their next turn |

---

## 13. Starter Decks v1.1

### 13.1 Yoko Imperium Starter

```json
[
  {"card": "Data Yoko", "count": 4},
  {"card": "Analyst Yoko", "count": 4},
  {"card": "Logistics Yoko", "count": 3},
  {"card": "Accountant Yoko", "count": 3},
  {"card": "Firewall Yoko", "count": 2},
  {"card": "Governor", "count": 2},
  {"card": "Predictive Shielding", "count": 2},
  {"card": "Resource Reallocation", "count": 2},

  {"card": "System Shutdown", "count": 2},
  {"card": "Forced Liquidation", "count": 2},
  {"card": "Protocol Purge", "count": 2},
  {"card": "Strategic Reserve", "count": 2},

  {"card": "Assembly Worker X", "count": 4},
  {"card": "Phase Wraith", "count": 3},
  {"card": "Signal Bride", "count": 3}
]
```

### 13.2 Spooky Ones Starter

```json
[
  {"card": "Phase Wraith", "count": 4},
  {"card": "Desync Skirmisher", "count": 4},
  {"card": "Afterimage Lurker", "count": 3},
  {"card": "Glitch Adept", "count": 3},
  {"card": "Reality Tumbler", "count": 2},
  {"card": "Phantom Pressure", "count": 2},
  {"card": "Latency Hex", "count": 2},
  {"card": "Reality Leak", "count": 2},

  {"card": "System Shutdown", "count": 2},
  {"card": "Forced Liquidation", "count": 2},
  {"card": "Asset Freeze", "count": 2},
  {"card": "Market Panic", "count": 2},

  {"card": "Data Yoko", "count": 4},
  {"card": "Armor Platoon X", "count": 3},
  {"card": "Linda Husk", "count": 3}
]
```

### 13.3 Linda Bioroids Starter

```json
[
  {"card": "Linda Husk", "count": 4},
  {"card": "Signal Bride", "count": 4},
  {"card": "Market Eater", "count": 3},
  {"card": "Overseer Node", "count": 2},
  {"card": "Endless Linda", "count": 2},
  {"card": "Repair Swarm", "count": 3},
  {"card": "Network Bloom", "count": 3},
  {"card": "Replication Loop", "count": 3},

  {"card": "Protocol Purge", "count": 2},
  {"card": "Strategic Reserve", "count": 2},
  {"card": "Asset Freeze", "count": 2},

  {"card": "Analyst Yoko", "count": 4},
  {"card": "Production Overseer X", "count": 3},
  {"card": "Phase Wraith", "count": 3}
]
```

### 13.4 System X Starter

```json
[
  {"card": "Assembly Worker X", "count": 4},
  {"card": "Production Overseer X", "count": 4},
  {"card": "Armor Platoon X", "count": 4},
  {"card": "Demolisher X", "count": 2},
  {"card": "Linebreaker Walker X", "count": 2},
  {"card": "Forward Operating Base X", "count": 3},
  {"card": "Infrastructure Audit X", "count": 3},
  {"card": "Director X", "count": 2},

  {"card": "System Shutdown", "count": 2},
  {"card": "Forced Liquidation", "count": 2},
  {"card": "Strategic Reserve", "count": 2},

  {"card": "Data Yoko", "count": 4},
  {"card": "Signal Bride", "count": 3},
  {"card": "Phase Wraith", "count": 3}
]
```

---

## 14. Recommended UI

### Board UI

Each player should have visible zones:

```text
Opponent Ongoings
Opponent Back Row
Opponent Front Row

Your Front Row
Your Back Row
Your Ongoings
```

### Card UI

Every card should show:

- Name
- Faction
- Cost
- Type
- ATK / DEF / Income when relevant
- Keywords
- Exhausted state
- Current DEF if damaged
- Row location

### Interaction UI

During Combat:

1. Highlight legal attackers.
2. After selecting attacker, highlight legal targets.
3. If Guardbreak, prompt attacker to choose a front-row enemy that cannot block.
4. Defender gets blocker assignment prompt.
5. Show damage preview.

During Income:

- Show income breakdown.
- Prompt optional Optimize usage.

During Build:

- Show buttons:
  - Play selected card.
  - Move selected character.
  - Recycle.
  - Resale.
  - End Build.

---

## 15. Solo AI Heuristics

Basic solo AI:

```text
1. Spend as much money as possible.
2. Prioritize income cards.
3. Then play attackers / Vehicles.
4. Then play Ongoings.
5. Use removal if a high-value target exists.
6. Move strongest non-Vehicle attacker to front row unless income is threatened.
7. Attack with ready front-row cards.
8. Prioritize enemy income cards, then high-ATK cards, then any legal target.
9. Block to protect income or prevent Raid.
```

AI should use:

- System Shutdown on highest-value enemy Character.
- Forced Liquidation on exhausted high-value Character.
- Protocol Purge on the most impactful Ongoing.
- Resale if it cannot afford anything useful.
- Recycle if hand is dead and it has enough money.

---

## 16. Implementation Milestones

### Milestone 1 — Local Hotseat MVP

- Card database loaded from JSON.
- 2 players, local browser.
- Draw / hand / play / money.
- Rows.
- Turn phases.
- Manual combat.
- Manual damage.

### Milestone 2 — Rules Automation

- Legal target validation.
- Exhaustion / readying.
- Income generation.
- Raid.
- Reassemble.
- Optimize.
- Deploy.
- Guardbreak.
- Siege.
- Direct attack legality.
- Loss check.

### Milestone 3 — Decks and UI

- Starter deck selection.
- Card hover zoom.
- Action log.
- Damage preview.
- Keyword tooltips.

### Milestone 4 — Solo AI

- Implement simple AI priority list.
- System X AI first.
- Add difficulty toggles later.

### Milestone 5 — Online Multiplayer

- WebSocket room system.
- Server-authoritative game state.
- Client only sends intents.
- Server validates all moves.

---

## 17. Server Architecture Recommendation

For web digital version:

```text
Frontend: React / Next.js
Backend: FastAPI or Node server
Realtime: WebSocket
Game Engine: Pure TypeScript rules module if using JS stack
Storage: JSON card database + SQLite for accounts/matches if needed
```

Best structure:

```text
/src
  /cards
    cards.json
    starter_decks.json
  /engine
    gameState.ts
    rules.ts
    combat.ts
    economy.ts
    keywords.ts
    ai.ts
  /ui
    Board.tsx
    Card.tsx
    Hand.tsx
    CombatPrompt.tsx
```

For online multiplayer, make the server authoritative:

```text
Client sends: "I want to attack with A targeting B."
Server validates and updates state.
Client renders returned state.
```

---

## 18. Important Ambiguity Flags for Human Review

These are items that should be confirmed before a fully automated production build:

1. Does direct attack damage always remove money equal to ATK, or should only Raid steal money?
   - Current v1.1 snapshot says direct attacks remove money equal to ATK.
   - BALANCE DECISION (post-v1.1, search-AI tested): first-turn protection now also
     covers DIRECT attacks — you cannot attack a player directly until they have
     taken their first turn (previously only Raid was protected). This removed a
     dominant first-player turn-1 face rush (first-player win rate 67% → ~42% in
     AI self-play). Implemented via `COMBAT_CONFIG.directAttackNeedsFirstTurn` in
     packages/engine/src/combat.ts (default true) and enforced in getLegalAttackTargets.
2. Should Reassemble be strictly once per card instance?
   - Current recommendation: yes.
3. Should Infrastructure Audit X destroy any Location, or only damage one?
   - Current implementation snapshot: destroy one Location.
4. Should Emergency Protocols discount apply only during the same turn?
   - Current implementation snapshot: no; it persists until the next character you play.
5. Should Phantom Pressure be Action or Ongoing?
   - Current implementation snapshot: Action.
6. Should Replication Loop be Action or Ongoing?
   - Current implementation snapshot: Action.

Do not let a coding agent silently invent answers to these. Use this snapshot unless the designer overrides it.

---

## 19. Glossary

- **Money / 💰:** Persistent resource and survival measure.
- **Income:** Money generated during Income Phase.
- **Front Row:** Combat row.
- **Back Row:** Income / infrastructure row.
- **Exhausted:** Cannot attack or block. Usually still generates income.
- **Ready:** Not exhausted.
- **Destroyed:** Sent to discard after DEF reaches 0 or less.
- **Direct Attack:** Attack against player money; only legal if defender has no back-row cards.
- **Faction:** Card identity group.
- **Neutral:** Card usable by all decks.
