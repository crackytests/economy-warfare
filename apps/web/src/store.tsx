/**
 * App-shell state.
 *
 * State management choice: plain React Context + useReducer. The shell's shared
 * state is tiny (embed config, player name, the embed bridge handle), so a
 * dedicated store library (Zustand) would be overkill here. ARCHITECTURE.md
 * says "keep it light (Zustand or context)" — we picked context for the shell.
 *
 * Heavier, screen-local state (a live game, an in-progress deck) is owned by
 * WS5 (game) and WS4 (deck editor) respectively and can use whatever they like
 * inside their folders; it does not belong in this global shell store.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createEmbedBridge, type EmbedBridge, type EmbedConfig } from "./embed";

interface AppState {
  /** Bridge handle (no-op when not embedded). */
  bridge: EmbedBridge;
  /** Config the host passed via postMessage `init`, merged with query params. */
  config: EmbedConfig;
  /** True when running inside an iframe. */
  embedded: boolean;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<EmbedConfig>({});
  // The bridge is created once and lives for the app's lifetime.
  const bridgeRef = useRef<EmbedBridge | null>(null);

  if (bridgeRef.current === null) {
    bridgeRef.current = createEmbedBridge({
      onInit: (cfg) => {
        if (cfg) setConfig((prev) => ({ ...prev, ...cfg }));
      },
      onClose: () => {
        // Host is closing the modal; nothing to persist for now.
      },
    });
  }
  const bridge = bridgeRef.current;

  useEffect(() => {
    // Announce readiness once mounted so the host can reveal the modal.
    bridge.ready();
    return () => bridge.dispose();
  }, [bridge]);

  const value = useMemo<AppState>(
    () => ({ bridge, config, embedded: bridge.embedded }),
    [bridge, config],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within <AppProvider>");
  return ctx;
}
