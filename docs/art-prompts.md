# Art prompts — "The Reboot" expansion (42 cards)

Two prompts per card:
- **SD** — Stable Diffusion, checkpoint **rfktrsDarkmix_v20** (SD 1.5). Tag-style.
- **GPT** — ChatGPT image gen (natural-language prose).

Save outputs as `images/named/<Card Name>.jpg` (match `data/cards.json` "art" naming),
then set each card's `art` field to `named/<Card Name>.jpg`.

## Stable Diffusion setup (rfktrsDarkmix_v20)

**Build each positive prompt as:** `QUALITY block + FACTION block + card SUBJECT`

- QUALITY: `(masterpiece, best quality, highly detailed:1.2), dark sci-fi trading card art, painterly digital illustration, dramatic cinematic lighting, rich moody color grading, intricate detail`
- Negative (all cards): `(worst quality, low quality:1.4), blurry, jpeg artifacts, watermark, signature, text, logo, frame, border, deformed hands, extra fingers, extra limbs, bad anatomy, lowres, cropped, oversaturated`
- Settings: 512×768 portrait · DPM++ 2M Karras · 26–30 steps · CFG 6.5 · Hires fix ×1.6 (denoise 0.4) · ADetailer on faces for the character cards.

**FACTION blocks**
- `YOKO:` `elegant anime woman, imperial spacetime bureaucracy, navy blue and gold uniform, holographic ledgers and star charts, pristine starship offices, cold fluorescent light with golden rim light`
- `SPOOKY:` `spectral glitch ghost, translucent sheet specter with hollow black eyes, digital corruption, datamoshing artifacts, chromatic aberration, dark server-void background, cyan and teal glow`
- `LINDA:` `biomechanical android zombie, fused flesh and scrap metal, self-repairing techno-zombie horde, sickly green bio-vat glow, cables like sinew, gentle body horror`
- `SYSX:` `crimson industrial war machines, corporate mecha factory, gunmetal and red enamel, smokestacks and assembly lines, harsh red warning lights`
- `NEUTRAL:` `interdimensional financial infrastructure, glowing market tickers and data vaults, brass amber and charcoal palette, grim corporate noir`

**GPT shared style line** (prepend to every GPT prompt):
> Dark, painterly sci-fi trading-card illustration, portrait orientation, dramatic cinematic lighting, moody color grading, no text or frame.

---

## Yoko Imperium (Endless Yoko — spacetime empire bureaucracy)

### Intern Yoko (1c 1/1, income 1, Optimize)
- SD: `YOKO +` `young frazzled anime intern, oversized uniform, carrying a teetering stack of glowing holographic paperwork and a coffee cup, tiny cubicle aboard an imperial starship, papers swirling in zero gravity`
- GPT: A young, frazzled intern version of an elegant anime space-empress assistant, drowning in a teetering stack of glowing holographic paperwork in a cramped cubicle aboard an imperial starship. Oversized navy-and-gold uniform, coffee in one hand, sheets of light drifting around her in low gravity.

### Audit Directive (Action)
- SD: `YOKO +` `giant golden holographic decree stamped AUDIT slamming down onto a vault, coins streaming out of the vault into ledger lines of light, imperial wax seal of light, looming bureaucratic dread`
- GPT: A colossal golden holographic decree descending like a guillotine onto a rival's vault, coins streaming out of it along glowing ledger lines toward an unseen empire. An ornate imperial seal of light burns at the top of the document. Bureaucratic dread rendered as dark majesty.

### Imperial Mandate (Action, modal)
- SD: `YOKO +` `empress on a throne of folded spacetime, three orbiting holographic sigils, one of gold coins, one of fanned cards, one of a shattering enemy vault, choosing with a raised gloved hand`
- GPT: A serene space empress on a throne of folded spacetime, three holographic sigils orbiting her raised gloved hand: a pile of gold coins, a fan of cards, and a rival's vault cracking apart. She is about to choose one. Navy, gold, and starlight.

### Censor Node (2c 1/3, income 1)
- SD: `YOKO +` `floating obsidian surveillance orb with a single golden eye, projecting chains of light that freeze a hulking enemy soldier mid-stride, redacted bars of light across the scene`
- GPT: A floating obsidian surveillance orb with a single golden lens, projecting chains of light that freeze a hulking enemy soldier mid-stride. Redaction bars of golden light hover across the scene like censored text.

### Treasury Yoko (4c 2/4, income 2)
- SD: `YOKO +` `regal anime treasurer standing atop a vault of luminous credit chips, golden protective aura washing over allied soldiers behind her, keys of light at her belt`
- GPT: A regal anime treasurer standing atop an open vault overflowing with luminous credit chips, a golden protective aura radiating from her over the soldiers arrayed behind her. Keys made of light hang at her belt.

### Rollback Protocol (Ongoing)
- SD: `YOKO +` `giant golden clock face turning backwards over a row of battered soldiers, their wounds closing and armor reassembling in reverse, chronal spiral light`
- GPT: A giant golden clock face turning backwards in the sky above a row of battered imperial soldiers; their wounds close and shattered armor flies back into place in reverse motion, wrapped in spiraling chronal light.

### Continuity Yoko (5c 3/5, income 1, Siege)
- SD: `YOKO +` `towering graceful authority of spacetime, braided timelines flowing through her hands like ribbons of galaxies, a siege beam of pure causality lancing down at a distant fortress`
- GPT: The graceful authority of spacetime herself: a towering, calm anime empress with braided timelines flowing through her hands like ribbons of galaxies, casually directing a lance of pure causality down onto a distant enemy fortress.

### Compliance Order (Action, dilemma)
- SD: `YOKO +` `imperial enforcer in dress uniform presenting a sealed ultimatum, two doors of light behind her, one door of draining coins, one door of a smoking generator, forced choice`
- GPT: An imperial enforcer in immaculate dress uniform presenting a sealed ultimatum to the viewer. Behind her, two doorways of light: through one, coins drain endlessly downward; through the other, a vital generator smokes and dies. You must choose.

---

## Spooky Ones (astral ghosts possessing machines, glitch, theft)

### Flicker Wisp (1c 1/1, Raid 1)
- SD: `SPOOKY +` `tiny sheet ghost flickering between visible and derezzed, half its body dissolving into static, clutching a single stolen gold coin, mischievous hollow eyes`
- GPT: A tiny sheet ghost flickering in and out of existence, half its body dissolving into static, clutching a single stolen gold coin to its chest with stubby spectral hands. Mischievous hollow eyes.

### Doubt Specter (2c 2/1, Raid 1)
- SD: `SPOOKY +` `whispering specter coiled behind an armored soldier, long spectral fingers near his ear, the soldier's coin pouch quietly unspooling into ghostly hands, paranoia atmosphere`
- GPT: A whispering specter coiled in the air behind an armored soldier, long translucent fingers cupped near his ear; while he stares ahead in doubt, his coin pouch quietly unspools its contents into the ghost's other hand.

### Fork Phantom (3c 2/2, Fork)
- SD: `SPOOKY +` `ghost mid-split into two identical copies, mirror-symmetric, a seam of bright glitch artifacts where they divide, both copies grinning`
- GPT: A sheet ghost caught mid-split into two identical copies of itself, a bright seam of glitch artifacts running down the middle where they divide. Both halves wear the same hollow grin.

### Timeline Splitter (Action)
- SD: `SPOOKY +` `spectral blade cleaving a glowing ribbon of timeline, an armored warrior being yanked backwards out of the battlefield and dissolving into a hand of cards`
- GPT: A spectral blade cleaving a glowing ribbon of timeline in half; on the severed strand, an armored warrior is yanked backwards out of the battlefield, dissolving into motes that reform as a card in an unseen hand.

### Paradox Engine (Ongoing)
- SD: `SPOOKY +` `impossible ghostly machine of Escher gears that turn through each other, orbiting playing cards feeding it, coins evaporating from a distant vault with every rotation`
- GPT: An impossible ghostly machine built of Escher-like gears that rotate through one another. Playing cards orbit it like moons, and with every rotation, coins evaporate from a distant vault and drift toward the machine as mist.

### Echo Raider (4c 3/3, Raid 1)
- SD: `SPOOKY +` `armored spectral raider sprinting with a sack of stolen coins, trailing five fading after-images of itself, each echo also carrying a ghostly copy of the loot`
- GPT: An armored spectral raider sprinting away with a sack of stolen coins, trailing five fading after-images of itself — and each echo carries its own ghostly copy of the loot.

### Severance Hex (Action, dilemma)
- SD: `SPOOKY +` `glowing hex sigil scissoring through a luminous thread that connects a hand of cards to a pile of coins, both sides fraying, cruel choice`
- GPT: A glowing teal hex sigil shaped like scissors severing a luminous thread that connects a fanned hand of cards to a pile of coins. Both ends of the thread fray — only one can be saved.

### Glitchstorm (Action, board bounce)
- SD: `SPOOKY +` `massive storm of digital corruption sweeping a battlefield, soldiers and war machines lifted into the sky and dissolving into pixels and card shapes, datamosh hurricane`
- GPT: A hurricane of digital corruption sweeping across a battlefield, lifting soldiers and war machines into the sky where they dissolve into pixels and fluttering card shapes. The whole front line is being un-rendered.

### Rewritten Reality (Ongoing)
- SD: `SPOOKY +` `ghostly hand dragging an eraser of static across reality, a glowing power generator being unpainted back into blue wireframe, the world behind it already rewritten`
- GPT: A ghostly hand dragging an eraser made of static across the scene; where it passes, a rival's glowing power generator is un-painted back into blue wireframe and swept away. The background has already been quietly rewritten.

---

## Linda Bioroids (self-repairing techno-zombie horde, vats, replication)

### Spare Husk (1c 1/1, Reassemble)
- SD: `LINDA +` `cheap discarded android shell slumped in a scrap pile, one eye flickering back to life, fingers twitching, cables reattaching themselves`
- GPT: A cheap, discarded android shell slumped in a scrap pile — except one eye has just flickered back to life. Its fingers twitch as loose cables crawl back into its wrists like sinew.

### Iterate (Action, draw)
- SD: `LINDA +` `rows of identical bioroid blueprints scrolling past, the newest one printing out of a flesh-and-metal fabricator, each iteration slightly improved, serial numbers`
- GPT: Rows of identical bioroid blueprints scrolling past on translucent green screens while a flesh-and-metal fabricator prints the newest iteration — each copy slightly improved, each stamped with the next serial number.

### Forked Process (Action, temp copy)
- SD: `LINDA +` `bioroid soldier mid-duplication, a translucent green copy of itself stepping out of its body, forked cable umbilicals connecting them, the copy already fading at the edges`
- GPT: A bioroid soldier mid-duplication: a translucent green copy of itself stepping sideways out of its own body, joined by forking cable umbilicals. The copy is already fading at the edges — it won't last long.

### Mirror Bioroid (3c 2/2, Fork + Reassemble)
- SD: `LINDA +` `two identical bioroids facing each other like a mirror image, one solid, one faintly translucent, both reaching to touch fingertips, vat fluid dripping`
- GPT: Two identical bioroids facing each other as if one were a mirror image — except one is faintly translucent. They reach out to touch fingertips, vat fluid still dripping from both.

### Convergence Vat (Action, recall 2)
- SD: `LINDA +` `huge green bio-vat, shattered bioroid parts swirling inward and reassembling into two figures rising from the fluid, magnetic convergence, rebirth`
- GPT: A huge bubbling bio-vat glowing sickly green; shattered bioroid limbs and torsos swirl inward through the fluid and reassemble into two figures rising from the surface, reborn.

### Husk Tide (Action, 3 tokens)
- SD: `LINDA +` `cresting wave of dozens of identical lurching android husks pouring over a barricade, green eyes in the dark, endless horde perspective`
- GPT: A cresting tide of dozens of identical lurching android husks pouring over a barricade, their green eyes the only light in the dark — and behind them, more, without end.

### Self-Repair Loop (Ongoing)
- SD: `LINDA +` `bioroid calmly stitching its own torn chest closed with cable-sinew, a looping circular diagram glowing above it, infinite repair cycle`
- GPT: A bioroid calmly stitching its own torn chest closed with a needle of cable-sinew, a circular looping diagram glowing softly above its head — the repair cycle that never ends.

### Replicant Chorus (4c 2/3, income 1, aura)
- SD: `LINDA +` `choir of identical bioroids singing in perfect unison, mouths open in harmony, sound visualized as a green protective lattice settling over the horde around them`
- GPT: A choir of identical bioroids singing in perfect unison, their harmony visualized as a lattice of green light settling like armor over the horde shambling around them.

### Assembly Matron (5c 3/5, income 1, ETB draw 2)
- SD: `LINDA +` `towering matriarch bioroid presiding over an assembly line, newborn husks rolling off the belt, blueprints fanned in her many hands like playing cards`
- GPT: A towering matriarch bioroid presiding over a flesh-and-steel assembly line, newborn husks rolling off the belt behind her, blueprints fanned in her many hands like a winning hand of cards.

---

## System X (red-glasses tycoon, industrial mecha, vehicles)

### Scout Drone X (1c 1/1, income 1, ETB draw)
- SD: `SYSX +` `small crimson reconnaissance drone with a single camera eye, hovering over a battlefield, beaming a glowing data feed back to a distant factory tower`
- GPT: A small crimson reconnaissance drone with a single glowing camera eye hovering above a battlefield at dusk, beaming a thin data feed of light back to a distant corporate factory tower.

### Overclock X (Action, +2 ATK + Guardbreak)
- SD: `SYSX +` `war mech glowing red-hot from within, pistons redlining, pressure gauges shattering, steam screaming from vents as it winds up an unstoppable punch`
- GPT: A war mech glowing red-hot from the inside out — pistons redlining, pressure gauges shattering, steam screaming from its vents — as it winds up a punch nothing can block.

### Supply Run X (Action, draw 2 / skip income)
- SD: `SYSX +` `convoy of crimson supply trucks racing out of a depot at night loaded with glowing crates, behind them the factory lights shutting down section by section`
- GPT: A convoy of crimson supply trucks racing out of a depot at night, beds stacked with glowing crates of parts — while behind them, the factory's lights shut down section by section to pay for the run.

### Recon Mech X (Vehicle 3c 2/3, ETB draw)
- SD: `SYSX +` `light scout mecha crouched on a ridge, oversized sensor array unfolding like wings, scanning beams sweeping the valley, pilot silhouette in red glass cockpit`
- GPT: A light scout mecha crouched on a ridge, its oversized sensor array unfolding like wings as scanning beams sweep the valley below. The pilot is a silhouette behind red cockpit glass.

### Salvage Rig X (3c 2/3, income 1, ETB +2 money)
- SD: `SYSX +` `industrial salvage rig with a magnet crane hoisting wrecked war machines, scrap dissolving into streams of glowing credits, worker exoskeleton operator`
- GPT: An industrial salvage rig hoisting wrecked war machines with a magnet crane; the scrap dissolves mid-air into streams of glowing credits that pour into the rig's hopper.

### Factory Reset X (Action, mass bounce)
- SD: `SYSX +` `vast factory floor where every machine is disassembling itself back into labeled crates, a giant red reset lever just pulled, conveyor belts running in reverse`
- GPT: A vast factory floor where every machine is calmly disassembling itself back into labeled shipping crates, conveyor belts running in reverse, a giant red RESET lever still warm from being pulled.

### Heavy Hauler X (Vehicle 4c 3/5, Siege)
- SD: `SYSX +` `colossal armored hauler truck smashing through a fortress wall, headlights blazing, cargo bed full of siege ordnance, rubble flying, unstoppable mass`
- GPT: A colossal armored hauler smashing straight through a fortress wall with its headlights blazing, cargo bed stacked with siege ordnance, rubble cascading off its plow blade. It is not slowing down.

### Command Uplink X (5c 2/4, income 1, ETB draw 2)
- SD: `SYSX +` `ruthless executive with red glasses at a command uplink throne, dozens of holographic intel screens streaming battlefield data into his gloved hands, char aznable homage`
- GPT: A ruthless corporate commander in sharp red glasses seated at a command-uplink throne, dozens of holographic intel screens streaming battlefield reports down into his gloved hands like dealt cards.

---

## Neutral (interdimensional markets, the multiverse)

### Spare Cog (1c 1/1, ETB +1 money)
- SD: `NEUTRAL +` `tiny endearing robot cobbled from spare parts and one big cog, proudly holding up a single gold coin, workshop shelf background`
- GPT: A tiny, endearing robot cobbled together from spare parts around one big brass cog, proudly holding up a single gold coin like a trophy, on a cluttered workshop shelf.

### Insider Trading (Action)
- SD: `NEUTRAL +` `two shadowy figures in an alley beneath a glowing market ticker, exchanging a briefcase that leaks light from fanned cards inside, one coin rolling away to a third silhouette`
- GPT: Two shadowy figures beneath a glowing market ticker exchanging a briefcase that leaks light from the fanned cards inside — while a single coin rolls away across the pavement toward a waiting third silhouette.

### Fork Bomb (Action, temp copy any)
- SD: `NEUTRAL +` `process explosion of recursive silhouettes, one soldier multiplying outward into a fractal crowd of identical translucent copies, terminal-green burst pattern`
- GPT: A detonation of recursion: one soldier multiplying outward into a fractal crowd of identical translucent copies of himself, arranged like an explosion frozen mid-burst in terminal green light.

### Convergence Point (Location 3c, def 3, income 1)
- SD: `NEUTRAL +` `interdimensional crossroads station, multiple shimmering portals converging on a central platform, lost objects and cards drifting back through the gates to their owners`
- GPT: A grand interdimensional crossroads station where several shimmering portals converge on one central platform; lost objects and stray cards drift back in through the gates, finding their way home.

### Rolling Blackout (Action, symmetric bounce)
- SD: `NEUTRAL +` `night city grid going dark district by district, dominoes of darkness sweeping across a glowing map table, two rival executives both reaching for their dying generators`
- GPT: A night city seen from a war-room map table, its glowing districts going dark one by one like falling dominoes — while two rival executives on opposite sides both lunge to save their own dying generators.

### Parallel Ledger (Action, draw 3 discard 1)
- SD: `NEUTRAL +` `ancient brass ledger whose turning pages exist in several overlapping ghost-universes at once, parallel copies of each page peeling into the air, one page burning away`
- GPT: An ancient brass-bound ledger whose turning pages exist in several overlapping ghost-universes at once — parallel translucent copies of each page peeling up into the air, while one page quietly burns away.

### The 52 Protocol (Action, modal)
- SD: `NEUTRAL +` `massive vault door stenciled with the number 52 swinging open onto branching corridors of parallel universes, three corridors glowing brighter than the rest`
- GPT: A massive vault door stenciled with the number 52 swinging open to reveal endlessly branching corridors of parallel universes — three of the corridors glow brighter than all the others, inviting a choice.

### Hard Reboot (Action, full reset)
- SD: `NEUTRAL +` `entire battlefield dissolving upward into white light, soldiers vehicles and buildings lifting off the ground and de-rezzing, giant power symbol flaring in the sky, the world rebooting`
- GPT: An entire battlefield dissolving upward into white light — soldiers, vehicles, and buildings lifting off the ground and de-rezzing into motes — beneath a giant power symbol flaring in the sky. The world is rebooting.
