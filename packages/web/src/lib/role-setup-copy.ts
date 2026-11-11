/**
 * Public board footer — role counts / knowledge from `00-MASTER-SPEC.md` §3.
 * Display-only; never invents counts.
 */

export function roleSetupFooter(startPlayerCount: number): string {
  if (startPlayerCount <= 5) {
    return '5 players: 3 Pandavas · 1 Kaurava · Duryodhana. Duryodhana knows the Kaurava.';
  }
  if (startPlayerCount === 6) {
    return '6 players: 4 Pandavas · 1 Kaurava · Duryodhana. Duryodhana knows the Kaurava.';
  }
  if (startPlayerCount === 7) {
    return '7 players: 4 Pandavas · 2 Kauravas · Duryodhana. Duryodhana does not know the Kauravas; Kauravas know Duryodhana.';
  }
  if (startPlayerCount === 8) {
    return '8 players: 5 Pandavas · 2 Kauravas · Duryodhana. Duryodhana does not know the Kauravas; Kauravas know Duryodhana.';
  }
  if (startPlayerCount === 9) {
    return '9 players: 5 Pandavas · 3 Kauravas · Duryodhana. Duryodhana does not know the Kauravas; Kauravas know Duryodhana.';
  }
  return '10 players: 6 Pandavas · 3 Kauravas · Duryodhana. Duryodhana does not know the Kauravas; Kauravas know Duryodhana.';
}
