/**
 * Player-facing themed labels for wire short codes.
 * Display-only — never invents win/role truth beyond mapping known enums.
 */

export type WireRole = 'PANDAVA' | 'KAURAVA' | 'DURYODHANA';
export type WireTeam = 'PANDAVA' | 'KAURAVA';
export type WireRajaagnaPower =
  | 'DIVYA_DRISHTI'
  | 'RAJYA_SABHA_SUMMONS'
  | 'AKASHVANI'
  | 'VANVAS';
export type WireWinReason =
  | 'DHARMA_DECREES'
  | 'ADHARMA_DECREES'
  | 'DURYODHANA_VANVAS'
  | 'DURYODHANA_SENAPATI'
  | 'HOST_FORCE_END';

const ROLE_LABELS: Record<WireRole, string> = {
  PANDAVA: 'Pandava',
  KAURAVA: 'Kaurava',
  DURYODHANA: 'Duryodhana',
};

/** Spec §5.7 Rajaagna names — display-only. */
const POWER_LABELS: Record<WireRajaagnaPower, string> = {
  DIVYA_DRISHTI: 'Divya Drishti',
  RAJYA_SABHA_SUMMONS: 'Rajya Sabha Summons',
  AKASHVANI: 'Akashvani',
  VANVAS: 'Vanvas',
};

const TEAM_LABELS: Record<WireTeam, string> = {
  PANDAVA: 'Pandavas',
  KAURAVA: 'Kauravas',
};

const WIN_REASON_LABELS: Record<WireWinReason, string> = {
  DHARMA_DECREES: 'Five Dharma Decrees enacted',
  ADHARMA_DECREES: 'Six Adharma Decrees enacted',
  DURYODHANA_VANVAS: 'Duryodhana was exiled (Vanvas)',
  DURYODHANA_SENAPATI: 'Duryodhana was elected Senapati after the third Adharma Decree',
  HOST_FORCE_END: 'Host ended the game',
};

export function roleLabel(role: WireRole | null | undefined): string {
  if (!role) return '—';
  return ROLE_LABELS[role] ?? role;
}

export function teamLabel(team: WireTeam | null | undefined): string {
  if (!team) return '—';
  return TEAM_LABELS[team] ?? team;
}

export function teamForRole(role: WireRole): WireTeam {
  return role === 'PANDAVA' ? 'PANDAVA' : 'KAURAVA';
}

export function powerLabel(power: WireRajaagnaPower | null | undefined): string {
  if (!power) return '';
  return POWER_LABELS[power] ?? power;
}

export function winReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—';
  if (reason in WIN_REASON_LABELS) {
    return WIN_REASON_LABELS[reason as WireWinReason];
  }
  return reason;
}

export function isHostForceEnd(reason: string | null | undefined): boolean {
  return reason === 'HOST_FORCE_END';
}

export type RevealRow = {
  readonly id: string;
  readonly displayName: string;
  readonly seatOrder: number;
  readonly isAlive: boolean;
  readonly revealedRole: WireRole | null;
};

/** Seat-ordered public reveal rows from a GAME_OVER wire view. */
export function revealRowsFromPlayers(
  players: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly seatOrder: number;
    readonly isAlive: boolean;
    readonly revealedRole: WireRole | null;
  }[],
): readonly RevealRow[] {
  return [...players]
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      seatOrder: p.seatOrder,
      isAlive: p.isAlive,
      revealedRole: p.revealedRole,
    }))
    .sort((a, b) => a.seatOrder - b.seatOrder || a.id.localeCompare(b.id));
}
