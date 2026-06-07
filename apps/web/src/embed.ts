/**
 * Economy Warfare — iframe / postMessage bridge (GAME SIDE).
 *
 * The game ships as a standalone SPA. The owner's website opens it inside a
 * modal `<iframe>`. This module is the game-side half of a tiny, typed
 * message protocol that lets the host page size and close the modal, and lets
 * the game tell the host when it is ready, how big it wants to be, and when the
 * player asked to close.
 *
 * See `docs/EMBED.md` for the host-side snippet and the full schema.
 *
 * ── Message schema ─────────────────────────────────────────────────────────
 *
 * Every message is an object with a discriminant `type` and a `source` tag so
 * each side can ignore traffic it did not originate (postMessage on `window`
 * sees a lot of unrelated noise from analytics/extensions).
 *
 *   HOST → GAME   source: "ew-host"
 *     { type: "init",  config?: EmbedConfig }   // optional bootstrap config
 *     { type: "close" }                          // host is tearing down the modal
 *
 *   GAME → HOST   source: "ew-game"
 *     { type: "ready" }                          // sent once on mount
 *     { type: "requestClose" }                   // player hit the in-game close/X
 *     { type: "resize", width, height }          // preferred content dimensions
 *
 * The protocol is intentionally minimal and forward-compatible: unknown message
 * types are ignored. Add fields as optional; never repurpose an existing type.
 */

/** Bootstrap config the host may pass on `init`. All fields optional. */
export interface EmbedConfig {
  /** Launch mode; mirrors the `?mode=` query param. Query param wins if both set. */
  mode?: "home" | "deck" | "solo" | "online";
  /** Deck id to preselect; mirrors `&deck=`. */
  deckId?: string;
  /** Opaque player display name the host knows about. */
  playerName?: string;
  /** Host origin, for stricter targeting of outbound messages. */
  hostOrigin?: string;
}

const GAME_SOURCE = "ew-game" as const;
const HOST_SOURCE = "ew-host" as const;

// ---- Outbound (GAME → HOST) -----------------------------------------------

export type GameToHostMessage =
  | { source: typeof GAME_SOURCE; type: "ready" }
  | { source: typeof GAME_SOURCE; type: "requestClose" }
  | { source: typeof GAME_SOURCE; type: "resize"; width: number; height: number };

// ---- Inbound (HOST → GAME) -------------------------------------------------

export type HostToGameMessage =
  | { source: typeof HOST_SOURCE; type: "init"; config?: EmbedConfig }
  | { source: typeof HOST_SOURCE; type: "close" };

export interface EmbedHandlers {
  /** Host sent bootstrap config. */
  onInit?: (config: EmbedConfig | undefined) => void;
  /** Host wants the game to wind down (modal is closing). */
  onClose?: () => void;
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access throws — that itself means we are framed.
    return true;
  }
}

function post(message: GameToHostMessage, targetOrigin = "*"): void {
  if (!inIframe()) return;
  try {
    window.parent.postMessage(message, targetOrigin);
  } catch {
    /* host may have gone away; ignore */
  }
}

function isHostMessage(data: unknown): data is HostToGameMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === HOST_SOURCE &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/**
 * The game-side bridge handle. Construct once (see `createEmbedBridge`),
 * call `ready()` after first paint, `resize()` whenever the content box
 * changes, and `requestClose()` when the player hits an in-app close control.
 */
export interface EmbedBridge {
  /** True when running inside an iframe (vs. opened directly in a tab). */
  readonly embedded: boolean;
  /** Notify the host the app has mounted and is interactive. */
  ready(): void;
  /** Ask the host to resize the modal to fit our content. */
  resize(width: number, height: number): void;
  /** Ask the host to close the modal (player pressed the in-app X). */
  requestClose(): void;
  /** Tear down listeners. */
  dispose(): void;
}

/**
 * Wire up the game side of the bridge.
 *
 * @param handlers   callbacks for host→game messages.
 * @param hostOrigin optional expected host origin; when provided, inbound
 *                   messages from other origins are dropped and outbound
 *                   messages are targeted to it (recommended in production).
 */
export function createEmbedBridge(
  handlers: EmbedHandlers = {},
  hostOrigin?: string,
): EmbedBridge {
  const embedded = inIframe();
  let resolvedHostOrigin = hostOrigin;

  const onMessage = (ev: MessageEvent): void => {
    if (resolvedHostOrigin && ev.origin !== resolvedHostOrigin) return;
    if (!isHostMessage(ev.data)) return;

    // Lock onto the first valid host origin we hear from, if not pre-set.
    if (!resolvedHostOrigin && ev.origin && ev.origin !== "null") {
      resolvedHostOrigin = ev.origin;
    }

    switch (ev.data.type) {
      case "init":
        handlers.onInit?.(ev.data.config);
        break;
      case "close":
        handlers.onClose?.();
        break;
    }
  };

  if (embedded) window.addEventListener("message", onMessage);

  return {
    embedded,
    ready() {
      post({ source: GAME_SOURCE, type: "ready" }, resolvedHostOrigin ?? "*");
    },
    resize(width, height) {
      post(
        {
          source: GAME_SOURCE,
          type: "resize",
          width: Math.ceil(width),
          height: Math.ceil(height),
        },
        resolvedHostOrigin ?? "*",
      );
    },
    requestClose() {
      post(
        { source: GAME_SOURCE, type: "requestClose" },
        resolvedHostOrigin ?? "*",
      );
    },
    dispose() {
      if (embedded) window.removeEventListener("message", onMessage);
    },
  };
}
