import type { CardInstance, GameState, PlayerId } from "@ew/shared";

export interface ReassemblePrompt {
  card: CardInstance;
  controllerId: PlayerId;
  cost: number;
}

export interface EnginePriv {
  combat?: {
    attacksThisCombat: number;
    pendingAttack?: {
      attackerId: string;
      target: import("@ew/shared").TargetRef;
      cannotBlockId?: string;
    };
  };
  reassembleQueue?: ReassemblePrompt[];
  moneyLossThisTurn?: Partial<Record<PlayerId, boolean>>;
  blackBudgetUsedThisTurn?: Partial<Record<PlayerId, boolean>>;
  usedAbilitiesThisTurn?: Partial<Record<string, boolean>>;
  playedThisTurn?: Partial<Record<PlayerId, number>>;
  moveCountThisTurn?: Partial<Record<PlayerId, number>>;
  emergencyDiscount?: Partial<Record<PlayerId, number>>;
  emergencyProtocolTriggeredThisTurn?: Partial<Record<PlayerId, boolean>>;
  firstDestroyedLindaThisTurn?: Partial<Record<PlayerId, boolean>>;
  firstActionPlayedThisTurn?: Partial<Record<PlayerId, boolean>>;
  skipIncomeOnce?: Partial<Record<PlayerId, boolean>>;
  frozenIncome?: Partial<Record<string, boolean>>;
  systemAuditTaxes?: Partial<Record<string, { expiresFor: PlayerId }>>;
}

type InternalState = GameState & { __ew?: EnginePriv };

export function priv(state: GameState): EnginePriv {
  const s = state as InternalState;
  s.__ew ??= {};
  return s.__ew;
}

export function peekPriv(state: GameState): EnginePriv {
  return (state as InternalState).__ew ?? {};
}

export function resetTurnFlags(state: GameState, playerId: PlayerId): void {
  const p = priv(state);
  p.playedThisTurn ??= {};
  p.playedThisTurn[playerId] = 0;
  p.moveCountThisTurn ??= {};
  p.moveCountThisTurn[playerId] = 0;
  p.emergencyProtocolTriggeredThisTurn ??= {};
  p.emergencyProtocolTriggeredThisTurn[playerId] = false;
  p.firstDestroyedLindaThisTurn ??= {};
  p.firstDestroyedLindaThisTurn[playerId] = false;
  p.firstActionPlayedThisTurn ??= {};
  p.firstActionPlayedThisTurn[playerId] = false;
  p.moneyLossThisTurn ??= {};
  p.moneyLossThisTurn[playerId] = false;
  p.blackBudgetUsedThisTurn ??= {};
  p.blackBudgetUsedThisTurn[playerId] = false;
}
