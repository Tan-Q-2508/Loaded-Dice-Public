import type { WirePlayerView } from '@shaatir-shakuni/socket-api';

/**
 * Persistent private team knowledge after role reveal.
 * Mirrors wire `knownDuryodhanaId` / `knownKauravas` only — never invents.
 */
export function PrivateKnowledgeStrip({ view }: { readonly view: WirePlayerView }) {
  if (view.phase.kind === 'ROLE_REVEAL' || view.phase.kind === 'GAME_OVER') {
    return null;
  }
  if (view.isSpectator || view.ownTeam !== 'KAURAVA') {
    return null;
  }

  const duryodhanaName = view.knownDuryodhanaId
    ? view.players.find((p) => p.id === view.knownDuryodhanaId)?.displayName ??
      view.knownDuryodhanaId.slice(0, 6)
    : null;
  const teammates = view.knownKauravas
    .map((id) => view.players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6))
    .filter(Boolean);

  if (!duryodhanaName && teammates.length === 0 && view.ownRole !== 'DURYODHANA') {
    return null;
  }

  return (
    <aside
      className="mt-1 rounded-lg border border-adharma-500/30 bg-adharma-600/15 px-2 py-1 text-center sm:px-3 sm:py-2"
      data-testid="private-knowledge-strip"
      aria-label="Private Kaurava knowledge"
    >
      <p className="font-body text-[10px] font-semibold uppercase tracking-[0.22em] text-adharma-400">
        Private knowledge
      </p>
      {view.ownRole === 'KAURAVA' && duryodhanaName ? (
        <p className="mt-1 font-body text-sm text-mist-100" data-testid="known-duryodhana">
          Duryodhana is <span className="font-semibold text-brass-300">{duryodhanaName}</span>
        </p>
      ) : null}
      {view.ownRole === 'DURYODHANA' ? (
        <p className="mt-1 font-body text-sm text-mist-200">
          You are Duryodhana — the other Kauravas know you.
        </p>
      ) : null}
      {teammates.length > 0 ? (
        <p className="mt-1 font-body text-xs text-mist-300" data-testid="known-kauravas">
          {view.ownRole === 'DURYODHANA' ? 'Known Kauravas: ' : 'Other Kauravas: '}
          {teammates.join(' · ')}
        </p>
      ) : null}
    </aside>
  );
}
