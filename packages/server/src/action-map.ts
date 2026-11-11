import type { GameAction } from '@shaatir-shakuni/engine';
import type { GameActionPayload } from '@shaatir-shakuni/socket-api';

/**
 * Map wire game:action payload → engine GameAction by injecting authenticated actor ids.
 * Wire payloads intentionally omit actor fields (server-authoritative).
 */
export function wirePayloadToGameAction(
  payload: GameActionPayload,
  actorPlayerId: string,
): GameAction {
  switch (payload.type) {
    case 'ACK_ROLE_REVEAL':
      return { type: 'ACK_ROLE_REVEAL', playerId: actorPlayerId };
    case 'NOMINATE_SENAPATI':
      return {
        type: 'NOMINATE_SENAPATI',
        maharajId: actorPlayerId,
        nomineeId: payload.nomineeId,
      };
    case 'DONE_DISCUSSING':
      return { type: 'DONE_DISCUSSING', playerId: actorPlayerId };
    case 'CAST_VOTE':
      return { type: 'CAST_VOTE', playerId: actorPlayerId, vote: payload.vote };
    case 'DISCARD_MAHARAJ_TILE':
      return {
        type: 'DISCARD_MAHARAJ_TILE',
        maharajId: actorPlayerId,
        tileId: payload.tileId,
      };
    case 'PROPOSE_VETO':
      return { type: 'PROPOSE_VETO', senapatiId: actorPlayerId };
    case 'CAST_VETO_VOTE':
      return { type: 'CAST_VETO_VOTE', playerId: actorPlayerId, vote: payload.vote };
    case 'DISCARD_SENAPATI_TILE':
      return {
        type: 'DISCARD_SENAPATI_TILE',
        senapatiId: actorPlayerId,
        tileId: payload.tileId,
      };
    case 'EXEC_DIVYA_DRISHTI':
      return {
        type: 'EXEC_DIVYA_DRISHTI',
        maharajId: actorPlayerId,
        targetId: payload.targetId,
      };
    case 'EXEC_RAJYA_SABHA_SUMMONS':
      return {
        type: 'EXEC_RAJYA_SABHA_SUMMONS',
        maharajId: actorPlayerId,
        targetId: payload.targetId,
      };
    case 'EXEC_AKASHVANI_ACK':
      return { type: 'EXEC_AKASHVANI_ACK', maharajId: actorPlayerId };
    case 'EXEC_VANVAS':
      return {
        type: 'EXEC_VANVAS',
        maharajId: actorPlayerId,
        targetId: payload.targetId,
      };
    case 'FORCE_END_GAME':
      return {
        type: 'FORCE_END_GAME',
        hostPlayerId: actorPlayerId,
        winner: payload.winner,
      };
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
