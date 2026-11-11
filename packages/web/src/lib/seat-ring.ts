/**
 * Split seats clockwise around a rectangular table (top → right → bottom → left).
 * Extra seats prefer the taller left/right edges so the board keeps more
 * horizontal room and chips stay a uniform size.
 */

export type RingSideCounts = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type RingSides<T> = {
  readonly top: readonly T[];
  readonly right: readonly T[];
  readonly bottom: readonly T[];
  readonly left: readonly T[];
};

export function ringSideCounts(n: number): RingSideCounts {
  if (n <= 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const base = Math.floor(n / 4);
  let rem = n % 4;
  const right = base + (rem > 0 ? 1 : 0);
  rem = Math.max(0, rem - 1);
  const left = base + (rem > 0 ? 1 : 0);
  rem = Math.max(0, rem - 1);
  const top = base + (rem > 0 ? 1 : 0);
  const bottom = n - top - right - left;
  return { top, right, bottom, left };
}

/**
 * Clockwise from the start of the top edge. Bottom/left are reversed so
 * on-screen order is left→right and top→bottom.
 */
export function splitSeatsAroundBoard<T>(seats: readonly T[]): RingSides<T> {
  const { top: t, right: r, bottom: b, left: l } = ringSideCounts(seats.length);
  let i = 0;
  const top = seats.slice(i, i + t);
  i += t;
  const right = seats.slice(i, i + r);
  i += r;
  const bottomClockwise = seats.slice(i, i + b);
  i += b;
  const leftClockwise = seats.slice(i, i + l);
  return {
    top,
    right,
    bottom: [...bottomClockwise].reverse(),
    left: [...leftClockwise].reverse(),
  };
}
