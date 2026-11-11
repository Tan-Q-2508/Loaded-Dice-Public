import type { PowerTable, RajaagnaPower } from './types.js';

/**
 * Official Secret Hitler Fascist-track powers (slots 1–5), themed per
 * `00-MASTER-SPEC.md` Section 2. Owned by `fragments/04-power-table.md`.
 *
 * | Start count | 1 | 2 | 3 | 4 | 5 |
 * | 5–6 | — | — | Policy Peek | Execution | Execution |
 * | 7–8 | — | Investigate | Special Election | Execution | Execution |
 * | 9–10 | Investigate | Investigate | Special Election | Execution | Execution |
 */
export type PowerTrack = readonly [
  RajaagnaPower | null,
  RajaagnaPower | null,
  RajaagnaPower | null,
  RajaagnaPower | null,
  RajaagnaPower | null,
];

export const POWER_TRACK_5_6: PowerTrack = [
  null,
  null,
  'AKASHVANI',
  'VANVAS',
  'VANVAS',
];

export const POWER_TRACK_7_8: PowerTrack = [
  null,
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];

export const POWER_TRACK_9_10: PowerTrack = [
  'DIVYA_DRISHTI',
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];

/** Band by game-start player count (not living count). */
export function trackForStartPlayerCount(startPlayerCount: number): PowerTrack {
  if (startPlayerCount <= 6) return POWER_TRACK_5_6;
  if (startPlayerCount <= 8) return POWER_TRACK_7_8;
  return POWER_TRACK_9_10;
}

export const defaultPowerTable: PowerTable = {
  getPower(startPlayerCount: number, adharmaSlot: number): RajaagnaPower | null {
    if (adharmaSlot < 1 || adharmaSlot > 5) return null;
    const track = trackForStartPlayerCount(startPlayerCount);
    return track[adharmaSlot - 1] ?? null;
  },
};
