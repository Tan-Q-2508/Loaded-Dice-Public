/**
 * Public board art under `/art/*` — display-only paths.
 * Slot plates map from power + position; never invents powers.
 */
import type { PowerTrackSlot } from './power-track-display';

const ART = '/art';

export const boardArt = {
  dharmaBoard: `${ART}/board-dharma.png`,
  adharmaBoard: `${ART}/board-adharma.png`,
  tableFelt: `${ART}/table-felt.png`,
  bannerDuryodhanaSenapati: `${ART}/banner-duryodhana-senapati.png`,
  decreeDharma: `${ART}/decree-dharma.png`,
  decreeAdharma: `${ART}/decree-adharma.png`,
  decreeBack: `${ART}/decree-back.png`,
  pileDraw: `${ART}/pile-draw.png`,
  pileDiscard: `${ART}/pile-discard.png`,
  badgeMaharaj: `${ART}/badge-maharaj.png`,
  badgeSenapati: `${ART}/badge-senapati.png`,
  seatFrame: `${ART}/seat-frame.png`,
  seatFrameYou: `${ART}/seat-frame-you.png`,
  seatFrameExiled: `${ART}/seat-frame-exiled.png`,
  rolePandava: `${ART}/role-card-pandava.png`,
  roleKaurava: `${ART}/role-card-kaurava.png`,
  roleDuryodhana: `${ART}/role-card-duryodhana.png`,
  slotEmpty: `${ART}/slot-empty.png`,
  slotDivyaDrishti: `${ART}/slot-divya-drishti.png`,
  slotRajyaSabhaSummons: `${ART}/slot-rajya-sabha-summons.png`,
  slotAkashvani: `${ART}/slot-akashvani.png`,
  slotVanvas: `${ART}/slot-vanvas.png`,
  slotVanvasDice: `${ART}/slot-vanvas-dice.png`,
  slotAdharmaWin: `${ART}/slot-adharma-win.png`,
  slotDharmaWin: `${ART}/slot-dharma-win.png`,
  powerShakuniDice: `${ART}/power-shakuni-dice.png`,
  voteHa: `${ART}/vote-ha.png`,
  voteNahi: `${ART}/vote-nahi.png`,
} as const;

/**
 * Empty Adharma slot plate for track index `slotIndex` (0-based).
 * Slot 5 (index 4) Vanvas uses the dice-unlock plate; slot 6 is the win plate.
 */
export function adharmaEmptySlotArt(
  slotIndex: number,
  power: PowerTrackSlot,
): string {
  if (slotIndex === 5) return boardArt.slotAdharmaWin;
  if (power === 'DIVYA_DRISHTI') return boardArt.slotDivyaDrishti;
  if (power === 'RAJYA_SABHA_SUMMONS') return boardArt.slotRajyaSabhaSummons;
  if (power === 'AKASHVANI') return boardArt.slotAkashvani;
  if (power === 'VANVAS') {
    return slotIndex === 4 ? boardArt.slotVanvasDice : boardArt.slotVanvas;
  }
  return boardArt.slotEmpty;
}

export function dharmaEmptySlotArt(slotIndex: number): string {
  if (slotIndex === 4) return boardArt.slotDharmaWin;
  return boardArt.slotEmpty;
}

export function decreeTileArt(type: 'DHARMA' | 'ADHARMA'): string {
  return type === 'DHARMA' ? boardArt.decreeDharma : boardArt.decreeAdharma;
}

export function voteBallotArt(vote: 'HA' | 'NAHI'): string {
  return vote === 'HA' ? boardArt.voteHa : boardArt.voteNahi;
}

export function roleCardArt(
  role: 'PANDAVA' | 'KAURAVA' | 'DURYODHANA' | null | undefined,
): string | null {
  if (role === 'PANDAVA') return boardArt.rolePandava;
  if (role === 'KAURAVA') return boardArt.roleKaurava;
  if (role === 'DURYODHANA') return boardArt.roleDuryodhana;
  return null;
}
