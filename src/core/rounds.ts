export type RoundPhase = 'waiting' | 'spawning' | 'active' | 'intermission' | 'gameOver';

export interface RoundConfig {
  initialWaitTicks: number;
  intermissionTicks: number;
}

export interface RoundState {
  round: number;
  phase: RoundPhase;
  phaseTicks: number;
}

export interface RoundContext {
  livingPlayers: number;
  zombiesAlive: number;
  spawnsRemaining: number;
}

export interface RoundEvent {
  type: 'roundPhaseChanged';
  round: number;
  from: RoundPhase;
  to: RoundPhase;
}

export const DEFAULT_ROUND_CONFIG: RoundConfig = {
  initialWaitTicks: 60,
  intermissionTicks: 180,
};
export function createRoundState(): RoundState {
  return { round: 0, phase: 'waiting', phaseTicks: 0 };
}

function transition(state: RoundState, to: RoundPhase, round = state.round): RoundEvent {
  const event: RoundEvent = { type: 'roundPhaseChanged', round, from: state.phase, to };
  state.phase = to;
  state.round = round;
  state.phaseTicks = 0;
  return event;
}

export function updateRoundState(
  state: RoundState,
  context: RoundContext,
  config: RoundConfig = DEFAULT_ROUND_CONFIG,
): RoundEvent[] {
  if (state.phase === 'gameOver') return [];
  if (context.livingPlayers <= 0) return [transition(state, 'gameOver')];

  state.phaseTicks += 1;
  if (state.phase === 'waiting' && state.phaseTicks >= config.initialWaitTicks) {
    return [transition(state, 'spawning', 1)];
  }
  if (state.phase === 'spawning' && context.spawnsRemaining === 0) {
    return [transition(state, 'active')];
  }
  if (state.phase === 'active' && context.spawnsRemaining === 0 && context.zombiesAlive === 0) {
    return [transition(state, 'intermission')];
  }
  if (state.phase === 'intermission' && state.phaseTicks >= config.intermissionTicks) {
    return [transition(state, 'spawning', state.round + 1)];
  }
  return [];
}
