/**
 * App shell.
 *
 * Owns the chrome (header, close affordance, responsive frame) and routes
 * between the four screens by `?mode=` query param (see router.ts). The actual
 * Deck Editor (WS4) and Game Board (WS5) are rendered here but live in their
 * own folders as placeholder stubs the other workstreams fill in.
 */

import { useEffect, useState } from "react";
import { useApp } from "./store";
import { useRoute, navigate, type Mode } from "./router";
import { useResizeReporter } from "./useResizeReporter";
import { Home } from "./screens/Home";
import { SoloScreen } from "./screens/SoloScreen";
import { OnlineScreen } from "./screens/OnlineScreen";
import { DeckScreen } from "./screens/DeckScreen";

const NAV: { mode: Mode; label: string }[] = [
  { mode: "home", label: "Menu" },
  { mode: "deck", label: "Deck Editor" },
  { mode: "solo", label: "Play Solo" },
  { mode: "online", label: "Play Online" },
];

export function App() {
  const { bridge, config, embedded } = useApp();
  const route = useRoute();
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null);
  useResizeReporter(bridge, rootEl);

  // If the host supplied a launch mode via init() and the URL is still default,
  // honor it. The query param always wins when present.
  useEffect(() => {
    if (route.mode === "home" && config.mode && config.mode !== "home") {
      navigate({ mode: config.mode, deckId: config.deckId ?? null });
    }
  }, [config.mode, config.deckId, route.mode]);

  const deckId = route.deckId ?? config.deckId ?? null;

  return (
    <div className="ew-shell" ref={setRootEl}>
      <header className="ew-shell__header">
        <button
          className="ew-shell__brand"
          onClick={() => navigate({ mode: "home" })}
          aria-label="Economy Warfare — main menu"
        >
          <span className="ew-shell__logo">EW</span>
          <span className="ew-shell__title">Economy Warfare</span>
        </button>

        <nav className="ew-shell__nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.mode}
              className={
                "ew-shell__navbtn" +
                (route.mode === item.mode ? " is-active" : "")
              }
              aria-current={route.mode === item.mode ? "page" : undefined}
              onClick={() => navigate({ mode: item.mode })}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {embedded && (
          <button
            className="ew-shell__close"
            onClick={() => bridge.requestClose()}
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        )}
      </header>

      <main className="ew-shell__main">
        {route.mode === "home" && <Home />}
        {route.mode === "deck" && <DeckScreen deckId={deckId} />}
        {route.mode === "solo" && <SoloScreen deckId={deckId} />}
        {route.mode === "online" && <OnlineScreen deckId={deckId} />}
      </main>
    </div>
  );
}
