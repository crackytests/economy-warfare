/**
 * Deck Editor screen (mode=deck). Shell wrapper around WS4's <DeckEditor/>.
 * WS2 owns this wrapper; the editor itself lives in src/deck/** (WS4).
 */

import { DeckEditor } from "../deck";
import { navigate } from "../router";

export function DeckScreen({ deckId }: { deckId: string | null }) {
  return (
    <div className="ew-screen">
      <DeckEditor
        deckId={deckId}
        onPlay={(id, mode) => navigate({ mode, deckId: id })}
      />
    </div>
  );
}
