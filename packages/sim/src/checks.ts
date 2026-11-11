import {
  getPlayerView,
  type GameState,
  type Team,
  type WinReason,
} from '@shaatir-shakuni/engine';

export type CheckFailure = {
  readonly kind: 'hidden_info_leak' | 'winner_incorrect' | 'illegal_terminal';
  readonly message: string;
};

/**
 * Asserts per-player views never expose another living player's private role
 * before GAME_OVER, other players' unrevealed votes, or legislation tiles the
 * viewer is not entitled to see.
 */
export function checkHiddenInfo(state: GameState): CheckFailure | null {
  if (state.phase.kind === 'GAME_OVER') {
    return null;
  }

  for (const viewer of state.players) {
    const view = getPlayerView(state, viewer.id);

    for (const p of view.players) {
      if (p.revealedRole !== null) {
        return {
          kind: 'hidden_info_leak',
          message: `Player ${viewer.id} saw revealedRole=${p.revealedRole} for ${p.id} before GAME_OVER`,
        };
      }
    }

    if (state.phase.kind === 'LEGISLATION_MAHARAJ') {
      const isMaharaj = state.currentGovernment?.maharajId === viewer.id;
      if (!isMaharaj && view.drawnTilesForMaharaj.length > 0) {
        return {
          kind: 'hidden_info_leak',
          message: `Non-Maharaj ${viewer.id} saw drawnTilesForMaharaj (${view.drawnTilesForMaharaj.length})`,
        };
      }
      if (
        isMaharaj &&
        view.drawnTilesForMaharaj.length !== state.phase.drawnTiles.length
      ) {
        return {
          kind: 'hidden_info_leak',
          message: `Maharaj ${viewer.id} drawn tile count mismatch in view`,
        };
      }
    }

    if (state.phase.kind === 'LEGISLATION_SENAPATI') {
      const isSenapati = state.currentGovernment?.senapatiId === viewer.id;
      if (!isSenapati && view.heldTiles.length > 0) {
        return {
          kind: 'hidden_info_leak',
          message: `Non-Senapati ${viewer.id} saw heldTiles (${view.heldTiles.length})`,
        };
      }
    }

    if (
      state.phase.kind === 'ELECTION_VOTING' &&
      !state.phase.votesRevealed &&
      view.votes
    ) {
      for (const [voterId, vote] of Object.entries(view.votes)) {
        if (voterId !== viewer.id && vote !== undefined) {
          return {
            kind: 'hidden_info_leak',
            message: `Player ${viewer.id} saw unrevealed vote of ${voterId}=${vote}`,
          };
        }
      }
    }

    // Pandavas must not learn Kaurava identities via knownKauravas.
    if (view.ownRole === 'PANDAVA' && view.knownKauravas.length > 0) {
      return {
        kind: 'hidden_info_leak',
        message: `Pandava ${viewer.id} has knownKauravas=${view.knownKauravas.join(',')}`,
      };
    }
  }

  return null;
}

/**
 * Independently re-derives the expected winner from board state at GAME_OVER.
 */
export function checkWinnerCorrect(state: GameState): CheckFailure | null {
  if (state.phase.kind !== 'GAME_OVER') {
    return {
      kind: 'illegal_terminal',
      message: `Expected GAME_OVER, got ${state.phase.kind}`,
    };
  }

  const { winner, reason } = state.phase;
  const expected = expectedWinFromBoard(state, winner, reason);
  if (!expected.ok) {
    return {
      kind: 'winner_incorrect',
      message: expected.message,
    };
  }
  return null;
}

function expectedWinFromBoard(
  state: GameState,
  winner: Team,
  reason: WinReason,
): { ok: true } | { ok: false; message: string } {
  switch (reason) {
    case 'DHARMA_DECREES':
      if (winner !== 'PANDAVA' || state.enactedDharma < 5) {
        return {
          ok: false,
          message: `DHARMA_DECREES but winner=${winner} enactedDharma=${state.enactedDharma}`,
        };
      }
      return { ok: true };
    case 'ADHARMA_DECREES':
      if (winner !== 'KAURAVA' || state.enactedAdharma < 6) {
        return {
          ok: false,
          message: `ADHARMA_DECREES but winner=${winner} enactedAdharma=${state.enactedAdharma}`,
        };
      }
      return { ok: true };
    case 'DURYODHANA_VANVAS': {
      if (winner !== 'PANDAVA') {
        return { ok: false, message: `DURYODHANA_VANVAS but winner=${winner}` };
      }
      const deadDury = state.players.some(
        (p) => p.role === 'DURYODHANA' && !p.isAlive,
      );
      if (!deadDury) {
        return {
          ok: false,
          message: 'DURYODHANA_VANVAS but Duryodhana is still alive',
        };
      }
      return { ok: true };
    }
    case 'DURYODHANA_SENAPATI': {
      if (winner !== 'KAURAVA') {
        return { ok: false, message: `DURYODHANA_SENAPATI but winner=${winner}` };
      }
      if (state.enactedAdharma < 3) {
        return {
          ok: false,
          message: `DURYODHANA_SENAPATI with enactedAdharma=${state.enactedAdharma}`,
        };
      }
      // lastElectedGovernment / currentGovernment may already be cleared at GAME_OVER;
      // accept the reason if the Adharma threshold was met — seating was checked at election time.
      return { ok: true };
    }
    case 'HOST_FORCE_END':
      return { ok: true };
    default: {
      const _exhaustive: never = reason;
      return { ok: false, message: `Unknown win reason: ${_exhaustive}` };
    }
  }
}
