# Economy Warfare — Game Guide (Current State)

*A source document for generating guide / tutorial videos. Written to be read aloud
or summarized. Everything below reflects what is actually playable today, not
future plans.*

---

## 1. What this game is, in one breath

**Economy Warfare** is a browser-based 1v1 tactical card game where you don't have
a life total — you have **money**. Money is both your resource (you spend it to play
cards) and your survival meter (you lose when your economy collapses). You build a
40-card deck, deploy characters and infrastructure across two battlefield rows, and
try to choke off your opponent's income until they go broke.

It runs in the browser and can be embedded as a pop-up modal on a website. You can
play it three ways:

1. **Deck Editor** — build and save 40-card decks from a pool of 48 cards.
2. **Solo vs AI** — play against a "semi-competent" computer opponent locally.
3. **Online 1v1** — play another human over the internet, with the server acting as
   the authoritative referee.

The theme is a grim, interdimensional war fought inside the "mainframe" of a world
run by AI waifus. (More on the story in Section 8.)

---

## 2. The core idea: money instead of life

This is the single most important thing to understand, and the hook for any video.

- You start with **5 money**. There is no health bar.
- Every card costs money to play.
- Certain cards generate **income** each turn — they are your economic engine.
- Combat doesn't reduce a life total; instead, attacks **destroy cards** or **drain
  and steal money**.
- **You lose** at the end of a turn if you have **zero money** AND you control **no
  card that generates income** anywhere on your board.

So the whole game is a fight over economy. You protect your own income sources while
attacking, stealing, and dismantling your opponent's. A player can be flush with
cards on the table and still lose the instant their last income source dies and
their money hits zero.

---

## 3. The board: two rows that do different jobs

Each player controls three zones:

- **Front Row** — the combat line. Characters here can attack and block.
- **Back Row** — the economy line. Characters and Locations here generate income.
- **Ongoing Zone** — persistent effect cards that sit off to the side and apply
  continuous rules changes until destroyed.

The central tension of the board: a character in the **back row earns money but
can't fight**, and a character in the **front row fights but earns nothing**. You can
move **one** (non-Vehicle) character between rows per turn, so deciding who attacks
and who earns is a constant balancing act.

The layout, top to bottom on screen, is: opponent's Ongoings, Back Row, Front Row —
then your Front Row, Back Row, and Ongoings.

---

## 4. Card types

- **Character** — the workhorse. Has ATK, DEF, and sometimes Income. Enters the front
  row by default; can be moved to the back to earn money.
- **Vehicle** — a heavy front-line unit. Enters the front row and **can never move**
  to the back. Tends to have Siege.
- **Location** — infrastructure. Enters the **back row**, often generates income or
  provides a passive bonus. Can't move.
- **Action** — a one-shot spell. Resolves immediately, then goes to the discard pile.
  Can only be played on your own Build Phase unless it says otherwise.
- **Ongoing** — a persistent enchantment. Stays in the Ongoing zone and applies its
  effect continuously until destroyed.

Every card shows its name, faction, cost, type, ATK/DEF/Income (when relevant),
keywords, exhausted state, current vs. base DEF if damaged, and which row it's in.

---

## 5. The turn, phase by phase

A turn runs through six phases. The UI shows a step-indicator bar so you always know
where you are.

1. **Start Phase** — all your exhausted (tapped) cards ready up. Start-of-turn
   effects resolve.
2. **Draw Phase** — draw 1 card.
3. **Income Phase** — collect money from your income sources. You may also use
   **Optimize** here (see keywords) to exhaust a card for +1 extra money.
4. **Build Phase** — the main phase. In any order you may: play cards you can afford,
   move one character between rows, and use **Recycle or Resale** once.
5. **Combat Phase** — declare attackers, pick targets, resolve Guardbreak, assign
   blockers, deal damage, destroy dead cards, resolve Reassemble.
6. **End Phase** — clear temporary buffs, check the loss condition, and mark that
   you've taken your first turn.

### Setup at the start of a match
- 40-card deck, 5-card opening hand, optional mulligan (redraw to 4).
- Start with 5 money. Starting player is chosen at random.

### Recycle vs. Resale (once per turn, pick one or neither)
- **Recycle:** discard a card and pay 1 money to draw a card. (Fix a bad hand.)
- **Resale:** discard a card to gain 1 money. (Convert a dead card into cash.)

---

## 6. Combat, step by step

Only **ready front-row Characters and Vehicles** can attack. Attacking exhausts the
attacker, and each attacker picks exactly **one** target. Damage from multiple
attackers is never combined — each fight is its own duel.

**Targeting rules (this is the heart of the strategy):**
- If the defender has a front row, you must attack the **front row first**.
- A **Siege** attacker can ignore the front row and hit Locations in the back.
- If the defender has **no front row**, their back row is exposed and can be attacked
  directly.
- You can only attack the **player's money directly** if they have **no back-row
  cards at all** — and even then, not until they've taken their first turn
  (first-turn protection).

**Blocking:** the defender may assign one ready front-row character to block each
attacker. Blocking is optional and, by default, does **not** exhaust the blocker.
Exhausted cards can't block.

**Damage:** attacker and blocker deal damage simultaneously. A card whose DEF drops
to 0 or below is destroyed and sent to the discard. 

**Direct hits to the player** subtract money equal to the attacker's ATK. Combined
with Raid (stealing money), this is how you actually win — by bleeding the opponent's
treasury dry.

---

## 7. Keywords (the mechanical vocabulary)

These are the recurring abilities that define how factions play. A guide video
should teach these one at a time with examples.

- **Raid X** — when this character deals combat damage, **steal X money** from the
  opponent (can't steal from a player who hasn't taken their first turn).
- **Reassemble** — when this card is destroyed, you may pay a cost (default 1 money)
  to **return it to your back row**, exhausted, with −1 DEF. Usually once per card.
- **Optimize** — during your Income Phase, exhaust this card to generate **+1 money**.
- **Optimize (Linda)** — same, but only works if you control another Linda Bioroids
  card.
- **Deploy** — when this enters play, you may immediately move it between rows for
  free (doesn't use your once-per-turn move).
- **Guardbreak** — when this attacks, choose one enemy front-row character; it
  **cannot block** this attack.
- **Siege** — this attacker may hit Locations directly, ignoring front-row blockers.
- **Vehicle** — enters the front row and can never move to the back.

---

## 8. The story / setting (for flavor and narration)

The game is set inside the mainframe of a world run by "gate boxes" — AI waifus. The
focus is the timeline of **"New Face,"** a rare multiversal anomaly: a world where
"Face" survives as a free, lone operator instead of being assimilated. Because that
anomaly is so rare, powerful factions from across time and space converge on this
"war world" to capture him, destroy him, or seize his system. The governing mood is:
*"In the far future, there is only war."*

The factions are drawn from across the multiverse, each with a distinct play style.

---

## 9. The four factions (and how they actually play)

### Yoko Imperium — *optimization & control*
The "graceful authority of spacetime." Mechanically: stable income, **Optimize**,
extra movement, and defensive positioning. A grindy, economic faction that out-values
opponents over time. Key cards: **Governor** (pumps other back-row earners),
**Predictive Shielding** (+1 DEF to your front row), **Resource Reallocation** (move
a second character each turn).

### Spooky Ones — *theft & disruption*
Astral-projecting ghosts who possess machines. They generate **zero passive income**
— their whole game is **Raid** (stealing money), **Guardbreak**, and economic
disruption with fragile, hard-hitting bodies. They survive by draining you faster
than you can recover. Key cards: **Phase Wraith**, **Glitch Adept** (Guardbreak),
**Reality Leak** (extra money loss on the opponent).

### Linda Bioroids — *attrition & recursion*
Self-repairing techno-zombies that sacrifice their own units to come back. Built
around **Reassemble**, attrition, Linda-only Optimize, and recursion pressure — you
can't kill them permanently, they just keep reassembling. Key cards: **Linda Husk**,
**Overseer Node** and **Endless Linda** (free Reassembles each turn), **Replication
Loop** (revive a dead unit).

### System X — *infrastructure & siege*
A ruthless industrialist tycoon (a Char-from-Gundam parody in red glasses).
Mechanically: **Vehicles**, **Siege**, **Locations**, and infrastructure ramp. Builds
a heavy economic base, then rolls over the opponent with siege vehicles that ignore
blockers. Key cards: **Demolisher X** and **Linebreaker Walker X** (siege vehicles),
**Forward Operating Base X** (cheaper vehicles), **Director X** (+1 ATK to vehicles).

There are also **Neutral cards** usable in any deck — removal (System Shutdown, Forced
Liquidation, Protocol Purge), economy tricks (Strategic Reserve, Emergency Funding,
Black Market Exchange), and disruption (Market Panic, Asset Freeze, System Audit).

*(A fifth faction, Space Communist Carl, is planned for a future expansion and is not
in the game yet.)*

---

## 10. The four starter decks

Out of the box there are four 40-card starter decks, one per faction, each splashing a
few cards from other factions plus neutrals:

- **Yoko Imperium Starter** — income engine + control removal.
- **Spooky Ones Starter** — aggressive Raid and money denial.
- **Linda Bioroids Starter** — recursive attrition that refuses to die.
- **System X Starter** — vehicles, siege, and infrastructure ramp.

In the Deck Editor you can load any starter, edit it, or build your own from scratch.
Deck rules: exactly **40 cards**, maximum **4 copies** of any single card. Mixed
factions are fully legal — there is no faction lock.

---

## 11. What's actually built and playable right now

This is the current state — useful for setting accurate expectations in a video.

**Fully working:**
- **Deck Editor** — browse all 48 cards with art, filter by faction, search, sort,
  add/remove with live deck validation, load starters, save your own decks to the
  browser, and a card-detail view. Launch straight into a solo game from here.
- **Solo vs AI** — a complete local game against an AI that follows a real priority
  list: spend money down, prioritize income, then attackers, then ongoings, use
  removal on high-value targets, push its strongest attacker forward, attack your
  income first, and block to protect its economy.
- **Online 1v1** — a working WebSocket server with room-code matchmaking. The server
  is authoritative: clients only send "intents," the server validates every move with
  the rules engine and sends back each player their own (redacted) view of the board.
  Reconnect-by-rejoin works.
- **The rules engine** — all the keywords, combat, income, loss conditions, and
  card-specific effects are implemented and covered by an extensive automated test
  suite (94 passing tests). The same engine runs both the solo game and the online
  server, so the rules are identical in both.
- **Embedding** — the game can be dropped into a website as a pop-up modal via iframe,
  with a working handshake for opening, sizing, and closing the modal. This has been
  tested end-to-end.

**Visual presentation (in progress / polishing):**
- The in-game board has a phase HUD, both players' hands (yours face-up, opponent's
  face-down), combat-role highlights (attacker / target / blocker glows), a grouped
  action panel, an animated event log, hover damage previews, a money-tick animation,
  and a winner overlay with "play again." All 48 cards have mapped artwork.
- Remaining polish is mostly deeper card animations (play "lunge," exhaust rotate,
  destroy fade) and mobile touch refinements.

**Not built yet (intentionally future):**
- The "bonding-curve collectibles" economy (a future system where owning more copies
  of a card raises its value). The architecture is designed to accommodate it later,
  but right now **everything is unlocked** — you own every card.
- The Space Communist Carl faction expansion.
- Persistent accounts / match history.

---

## 12. A suggested narration arc for a guide video

1. **The hook:** "In this game, you don't have health. You have money — and you lose
   when you go broke." Show the money counter.
2. **The board:** front row fights, back row earns, and you can only move one
   character per turn. Show the tension.
3. **A turn:** walk through draw → income → build → combat → end with a real example.
4. **Combat:** demonstrate attacking the front row, then exposing and looting the back
   row, then a direct money-draining hit.
5. **Keywords:** teach Raid, Reassemble, Optimize, and Siege with one card each.
6. **The factions:** one sentence of personality + one signature play per faction.
7. **Win condition recap:** strangle their income, drain their money, watch the
   economy collapse.
8. **Call to action:** open the Deck Editor, load a starter, and play the AI.
