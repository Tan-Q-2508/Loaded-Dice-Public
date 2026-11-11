import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { boardArt } from '../../lib/board-art';

/**
 * Public face-down card theater during legislation — never reveals tile types.
 */
export function LegislationTheater({ view }: { readonly view: WirePlayerView }) {
  if (
    view.phase.kind !== 'LEGISLATION_MAHARAJ' &&
    view.phase.kind !== 'LEGISLATION_SENAPATI'
  ) {
    return null;
  }

  const count = view.phase.kind === 'LEGISLATION_MAHARAJ' ? 3 : 2;
  const label =
    view.phase.kind === 'LEGISLATION_MAHARAJ'
      ? 'Decrees in Maharaj’s hand (private)'
      : view.phase.vetoProposed
        ? 'Veto proposed — held decrees stay private'
        : 'Decrees in Senapati’s hand (private)';

  return (
    <section
      className="mt-1 flex shrink-0 flex-col items-center gap-1 sm:mt-2 sm:gap-2"
      aria-label={label}
      data-testid="legislation-theater"
    >
      <p className="font-body text-xs uppercase tracking-[0.2em] text-mist-300">
        {label}
      </p>
      <ul className="flex gap-3">
        {Array.from({ length: count }, (_, i) => (
          <li
            key={i}
            className="aspect-[512/682] w-9 overflow-hidden rounded-md border border-brass-400/35 shadow-glow sm:w-14"
            aria-hidden
          >
            <img
              src={boardArt.decreeBack}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
