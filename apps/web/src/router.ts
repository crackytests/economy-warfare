/**
 * Tiny query-param router.
 *
 * The iframe launch contract is a URL like `/play?mode=solo&deck=<id>`, so the
 * whole app navigation model is just the `?mode=` (and optional `&deck=`) query
 * params plus History API updates. No react-router dependency: the surface is
 * four screens and we never use path segments (paths would break sub-path
 * embedding). State lives in the URL so a host can deep-link the modal.
 */

import { useSyncExternalStore } from "react";

export type Mode = "home" | "deck" | "solo" | "online";

export interface Route {
  mode: Mode;
  deckId: string | null;
}

const MODES: readonly Mode[] = ["home", "deck", "solo", "online"];

function parse(search: string): Route {
  const params = new URLSearchParams(search);
  const raw = params.get("mode");
  const mode = (MODES as readonly string[]).includes(raw ?? "")
    ? (raw as Mode)
    : "home";
  return { mode, deckId: params.get("deck") };
}

// useSyncExternalStore requires a referentially-stable snapshot: getRoute must
// return the SAME object reference until the URL actually changes, otherwise
// React detects a "new" value every render and loops forever. Cache by search.
let cachedSearch: string | null = null;
let cachedRoute: Route = parse(
  typeof window !== "undefined" ? window.location.search : "",
);

export function getRoute(): Route {
  const search = typeof window !== "undefined" ? window.location.search : "";
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedRoute = parse(search);
  }
  return cachedRoute;
}

/** Build a `?mode=...&deck=...` search string from a route. */
export function toSearch(route: Partial<Route>): string {
  const current = getRoute();
  const next = { ...current, ...route };
  const params = new URLSearchParams();
  if (next.mode && next.mode !== "home") params.set("mode", next.mode);
  if (next.deckId) params.set("deck", next.deckId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", notify);
}

/** Navigate to a new route, pushing History so Back works inside the SPA. */
export function navigate(route: Partial<Route>): void {
  const search = toSearch(route);
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.pushState(null, "", url);
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** React hook: re-renders on navigation. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}
