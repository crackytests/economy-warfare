# Embedding Economy Warfare (iframe modal)

Economy Warfare is a standalone SPA (built from `apps/web`). The owner's website
embeds it as a **modal `<iframe>`**. This doc is the host-side contract: the
launch URL, the `postMessage` schema, and a copy-paste snippet.

The game-side implementation lives in `apps/web/src/embed.ts`.

> **Try it now:** a working reference host page lives at `apps/web/public/host-demo.html`.
> Run `npm run dev:web` and open <http://localhost:5173/host-demo.html> — it embeds the
> game in a modal and shows a live log of the `postMessage` handshake (ready / init /
> resize / requestClose / close). The snippet in §3 is the production-shaped version.

---

## 1. Launch URL

Build the web app (`npm run build --workspace apps/web`) and serve `dist/` at a
path of your choice, e.g. `https://your-site.example/play/`. The bundle uses
relative asset paths (`base: "./"`), so any sub-path works.

Open it in an iframe with a `?mode=` query param:

| URL | Screen |
|---|---|
| `/play/` | Home / menu |
| `/play/?mode=deck` | Deck editor |
| `/play/?mode=solo` | Play vs Solo AI |
| `/play/?mode=online` | Play online (1v1) |
| `/play/?mode=solo&deck=<id>` | Launch straight into a game with a deck |

`mode` and `deck` can also be sent after load via the `init` postMessage (below).
**If both are present, the query param wins.**

---

## 2. postMessage schema

Every message is a plain object with a `type` discriminant and a `source` tag so
each side can ignore unrelated traffic. Unknown `type`s are ignored (forward
compatible — add fields as optional, never repurpose a type).

### Host → Game  (`source: "ew-host"`)

```ts
{ source: "ew-host", type: "init", config?: {
    mode?: "home" | "deck" | "solo" | "online";
    deckId?: string;
    playerName?: string;
    hostOrigin?: string;
}}
{ source: "ew-host", type: "close" }   // you are tearing down the modal
```

- **`init`** — optional bootstrap. Send it after you receive `ready` (or any
  time). Query-param `mode`/`deck` take precedence over `config`.
- **`close`** — tell the game the modal is going away (lets it wind down). You
  still remove the iframe yourself.

### Game → Host  (`source: "ew-game"`)

```ts
{ source: "ew-game", type: "ready" }                       // sent once on mount
{ source: "ew-game", type: "requestClose" }                // player hit in-app ✕
{ source: "ew-game", type: "resize", width: number, height: number } // preferred size
```

- **`ready`** — emitted after first paint. Reveal the modal / send `init` now.
- **`requestClose`** — the player clicked the in-game close button; the host
  should close the modal.
- **`resize`** — the game's preferred content size (px). Use it to size the
  iframe, or ignore it and use a fixed responsive frame. The game is fully
  responsive and works in a constrained viewport regardless.

---

## 3. Copy-paste host snippet

```html
<!-- Modal container on the owner's page -->
<div id="ew-overlay" hidden
     style="position:fixed;inset:0;background:rgba(0,0,0,.6);
            display:grid;place-items:center;z-index:9999">
  <iframe id="ew-frame"
          title="Economy Warfare"
          style="width:min(1000px,96vw);height:min(700px,92vh);
                 border:0;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.5)"
          allow="fullscreen"
          sandbox="allow-scripts allow-same-origin allow-popups"></iframe>
</div>

<button onclick="openEconomyWarfare('solo')">Play Economy Warfare</button>

<script>
  // Set this to the origin you serve the game from (recommended for security).
  const GAME_ORIGIN = "https://your-site.example";
  const GAME_URL = GAME_ORIGIN + "/play/";

  const overlay = document.getElementById("ew-overlay");
  const frame = document.getElementById("ew-frame");

  function openEconomyWarfare(mode, deckId) {
    const url = new URL(GAME_URL);
    if (mode) url.searchParams.set("mode", mode);
    if (deckId) url.searchParams.set("deck", deckId);
    frame.src = url.toString();
    overlay.hidden = false;
  }

  function closeEconomyWarfare() {
    // Politely tell the game first, then tear down.
    frame.contentWindow?.postMessage({ source: "ew-host", type: "close" }, GAME_ORIGIN);
    overlay.hidden = true;
    frame.src = "about:blank";
  }

  window.addEventListener("message", (ev) => {
    // SECURITY: only trust messages from the game's origin.
    if (ev.origin !== GAME_ORIGIN) return;
    const msg = ev.data;
    if (!msg || msg.source !== "ew-game") return;

    switch (msg.type) {
      case "ready":
        // Optionally push config the game didn't get from the URL:
        frame.contentWindow.postMessage(
          { source: "ew-host", type: "init",
            config: { playerName: "Guest" } },
          GAME_ORIGIN
        );
        break;
      case "requestClose":
        closeEconomyWarfare();
        break;
      case "resize":
        // Optional: fit the iframe to the game's preferred size, clamped.
        frame.style.height = Math.min(msg.height, window.innerHeight * 0.92) + "px";
        break;
    }
  });

  // Close on backdrop click / Escape.
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeEconomyWarfare(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeEconomyWarfare(); });
</script>
```

### Sandbox notes

The `sandbox` attribute above is a safe baseline:

- `allow-scripts` — required (it's a JS app).
- `allow-same-origin` — required so the game can use `localStorage` (saved
  decks) and so `postMessage` origin checks work. If you serve the game from a
  **different** origin than the host page, this still scopes storage to the
  game's origin, not yours.
- `allow-popups` — optional; only needed if the game ever opens external links.

If you serve the game **cross-origin**, leave `GAME_ORIGIN` set to the game's
origin (not `*`) in both the `postMessage` target and the inbound `ev.origin`
check. The game side locks onto the first valid host origin it hears from, or
you can pass `hostOrigin` in `init` for strict targeting.

---

## 4. Behavior summary

1. Host inserts the iframe with `?mode=...`.
2. Game mounts, sends `{type:"ready"}`.
3. Host (optionally) replies with `{type:"init", config}`.
4. Game runs; it emits `resize` as its content box changes.
5. Player clicks the in-game ✕ → game sends `requestClose` → host closes modal.
6. Host closing on its own first sends `{type:"close"}`, then removes the iframe.
