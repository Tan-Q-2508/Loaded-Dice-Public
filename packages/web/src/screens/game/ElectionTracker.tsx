import type { WirePlayerView } from '@shaatir-shakuni/socket-api';

const MARKERS = 3;

export function ElectionTracker({ view }: { readonly view: WirePlayerView }) {
  const n = Math.min(MARKERS, Math.max(0, view.electionTracker));
  return (
    <section
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
      aria-label={`Election tracker ${n} of ${MARKERS}`}
      data-testid="election-tracker"
    >
      <p className="font-body text-[10px] uppercase tracking-[0.18em] text-mist-300">
        Election tracker
      </p>
      <ol className="flex gap-2">
        {Array.from({ length: MARKERS }, (_, i) => {
          const active = i < n;
          return (
            <li
              key={i}
              data-testid={`tracker-mark-${i + 1}`}
              data-active={active ? 'true' : 'false'}
              className={[
                'h-3 w-3 rounded-full border transition',
                active
                  ? 'border-clay-500 bg-clay-500'
                  : 'border-mist-300/35 bg-ink-900',
              ].join(' ')}
            />
          );
        })}
      </ol>
      {n >= MARKERS ? (
        <p className="w-full text-center font-body text-[10px] text-clay-500">
          Kurukshetra Anarchy
        </p>
      ) : null}
    </section>
  );
}
