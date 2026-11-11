import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
  connectionStatusEnum,
  gameEvents,
  players,
  roomStatusEnum,
  rooms,
  sessions,
  snapshots,
} from '../src/schema/index.js';

describe('schema shape', () => {
  it('exports the five core tables', () => {
    expect(getTableName(rooms)).toBe('rooms');
    expect(getTableName(players)).toBe('players');
    expect(getTableName(sessions)).toBe('sessions');
    expect(getTableName(gameEvents)).toBe('game_events');
    expect(getTableName(snapshots)).toBe('snapshots');
  });

  it('defines room and connection enums', () => {
    expect(roomStatusEnum.enumValues).toContain('FROZEN');
    expect(roomStatusEnum.enumValues).toContain('CORRUPTED');
    expect(roomStatusEnum.enumValues).toContain('ARCHIVED');
    expect(roomStatusEnum.enumValues).toContain('EXPIRED');
    expect(connectionStatusEnum.enumValues).toEqual([
      'CONNECTED',
      'DISCONNECTED',
      'RECONNECTING',
    ]);
  });

  it('rooms has required column names', () => {
    const cols = Object.keys(rooms);
    expect(cols).toEqual(
      expect.arrayContaining([
        'id',
        'roomCode',
        'hostPlayerId',
        'status',
        'rebalanceEnabled',
        'settings',
        'frozenReason',
        'incidentAt',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('game_events and snapshots expose versioning columns', () => {
    expect(Object.keys(gameEvents)).toEqual(
      expect.arrayContaining([
        'id',
        'roomId',
        'seq',
        'stateVersion',
        'actionUuid',
        'eventType',
        'payload',
        'createdAt',
      ]),
    );
    expect(Object.keys(snapshots)).toEqual(
      expect.arrayContaining(['id', 'roomId', 'version', 'state', 'createdAt']),
    );
  });

  it('EC-82: v1 has no hash-chain / checksum columns on game_events', () => {
    const cols = Object.keys(gameEvents);
    expect(cols).not.toContain('prevHash');
    expect(cols).not.toContain('hash');
    expect(cols).not.toContain('checksum');
    expect(cols).not.toContain('eventHash');
  });
});
