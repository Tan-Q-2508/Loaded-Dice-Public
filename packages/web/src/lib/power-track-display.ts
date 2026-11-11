/**
 * Display-only Adharma power-track labels — mirrors engine POWER_TRACK_*
 * (`packages/engine/src/power-table.ts`). Never used for legality.
 */
import { powerLabel, type WireRajaagnaPower } from './theme-labels';

export type DisplayPower = WireRajaagnaPower;

export type PowerTrackSlot = DisplayPower | null;

const TRACK_5_6: readonly PowerTrackSlot[] = [
  null,
  null,
  'AKASHVANI',
  'VANVAS',
  'VANVAS',
];

const TRACK_7_8: readonly PowerTrackSlot[] = [
  null,
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];

const TRACK_9_10: readonly PowerTrackSlot[] = [
  'DIVYA_DRISHTI',
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];

/** Band by game-start player count (not living count). */
export function adharmaPowerTrack(startPlayerCount: number): readonly PowerTrackSlot[] {
  if (startPlayerCount <= 0) return TRACK_5_6;
  if (startPlayerCount <= 6) return TRACK_5_6;
  if (startPlayerCount <= 8) return TRACK_7_8;
  return TRACK_9_10;
}

/** Themed Rajaagna name for an Adharma track slot (empty string when no power). */
export function powerSlotLabel(power: PowerTrackSlot): string {
  return powerLabel(power);
}
