/**
 * Play Solo screen (mode=solo). Shell wrapper around WS5's <GameBoard/>.
 *
 * IMPORTANT (server-authoritative discipline, even offline):
 * The client NEVER mutates game state directly. Solo play runs the SAME engine
 * the server runs — every action is an `Intent` fed to `@ew/engine.applyIntent`,
 * which returns a new state (it never mutates input). The Solo AI (WS7) is just
 * a bot that picks an Intent from `getLegalIntents` and submits it through the
 * identical dispatcher. This keeps solitaire and online on one code path.
 *
 * Do not import @ew/shared/ownership in this path — gameplay is ownership-agnostic.
 */

import { GameBoard } from "../game";

export function SoloScreen({ deckId }: { deckId: string | null }) {
  return (
    <div className="ew-screen ew-screen--game">
      <GameBoard mode="solo" deckId={deckId} />
    </div>
  );
}
