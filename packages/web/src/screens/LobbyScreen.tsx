import { Navigate } from 'react-router-dom';
import { useGameSocket } from '../socket/SocketProvider';
import {
  selectCanStart,
  selectCanToggleRebalance,
  selectIsHost,
  useGameStore,
} from '../store/gameStore';

export function LobbyScreen() {
  const socket = useGameSocket();
  const roomId = useGameStore((s) => s.roomId);
  const roomCode = useGameStore((s) => s.roomCode);
  const view = useGameStore((s) => s.view);
  const playerId = useGameStore((s) => s.playerId);
  const lastError = useGameStore((s) => s.lastError);
  const isHost = useGameStore(selectIsHost);
  const canStart = useGameStore(selectCanStart);
  const canToggleRebalance = useGameStore(selectCanToggleRebalance);

  if (!roomId) {
    return <Navigate to="/" replace />;
  }

  if (view && view.phase.kind !== 'LOBBY') {
    return <Navigate to="/game" replace />;
  }

  const players = [...(view?.players ?? [])].sort((a, b) => a.seatOrder - b.seatOrder);
  const rebalanceEnabled = view?.rebalanceEnabled ?? false;
  const count = players.length;

  return (
    <main className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] sm:px-6 sm:py-14">
      <header className="mb-10 text-center">
        <p className="font-body text-xs font-semibold uppercase tracking-[0.35em] text-brass-400">
          Court chamber
        </p>
        <h1
          className="mt-3 font-display text-4xl font-bold tracking-[0.28em] text-brass-300 sm:text-5xl"
          data-testid="lobby-room-code"
        >
          {roomCode ?? '————'}
        </h1>
        <p className="mt-3 font-body text-sm text-mist-300">
          Share this code. Gather five to ten seats.
        </p>
      </header>

      <section
        aria-labelledby="roster-heading"
        className="court-table relative mx-auto mb-8 flex min-h-[12rem] w-full max-w-xl flex-col items-center justify-center rounded-[2rem] p-4 shadow-table sm:min-h-[18rem] sm:p-8"
      >
        <h2 id="roster-heading" className="sr-only">
          Players
        </h2>
        <div className="mb-4 text-center md:absolute md:left-1/2 md:top-1/2 md:z-10 md:mb-0 md:-translate-x-1/2 md:-translate-y-1/2">
          <p className="font-display text-3xl text-mist-100">{count}</p>
          <p className="font-body text-xs uppercase tracking-[0.2em] text-mist-400">of 10</p>
        </div>
        <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:hidden">
          {players.map((p) => {
            const host = view?.hostPlayerId === p.id;
            const self = p.id === playerId;
            return (
              <li
                key={`grid-${p.id}`}
                className={`min-w-0 rounded-xl border px-2 py-2 text-center shadow-seat ${
                  self
                    ? 'border-brass-400 bg-ink-900/95 animate-seatPulse'
                    : 'border-brass-500/25 bg-ink-950/90'
                }`}
              >
                <p className="truncate font-body text-xs font-semibold text-mist-100">
                  {p.displayName}
                </p>
                <p className="mt-0.5 font-body text-xs uppercase tracking-wider text-mist-400">
                  {host ? 'Host' : self ? 'You' : `Seat ${p.seatOrder + 1}`}
                </p>
              </li>
            );
          })}
          {players.length === 0 ? (
            <li className="col-span-2 py-8 text-center font-body text-sm text-mist-300 sm:col-span-3">
              Waiting for the roster…
            </li>
          ) : null}
        </ul>
        <ul className="relative hidden h-56 w-56 md:block md:h-64 md:w-64">
          {players.map((p, i) => {
            const angle = (i / Math.max(players.length, 1)) * Math.PI * 2 - Math.PI / 2;
            const radius = 108;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            const host = view?.hostPlayerId === p.id;
            const self = p.id === playerId;
            return (
              <li
                key={p.id}
                className={`absolute left-1/2 top-1/2 w-24 -translate-x-1/2 -translate-y-1/2 rounded-xl border px-2 py-2 text-center shadow-seat ${
                  self
                    ? 'border-brass-400 bg-ink-900/95 animate-seatPulse'
                    : 'border-brass-500/25 bg-ink-950/90'
                }`}
                style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
              >
                <p className="truncate font-body text-xs font-semibold text-mist-100">
                  {p.displayName}
                </p>
                <p className="mt-0.5 font-body text-xs uppercase tracking-wider text-mist-400">
                  {host ? 'Host' : self ? 'You' : `Seat ${p.seatOrder + 1}`}
                </p>
              </li>
            );
          })}
          {players.length === 0 ? (
            <li className="absolute inset-0 flex items-center justify-center font-body text-sm text-mist-300">
              Waiting for the roster…
            </li>
          ) : null}
        </ul>
      </section>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        {canToggleRebalance ? (
          <label className="flex items-center gap-3 rounded-lg border border-brass-500/15 bg-ink-900/40 px-4 py-3 font-body text-sm text-mist-200">
            <input
              type="checkbox"
              checked={rebalanceEnabled}
              onChange={(e) => socket.setRebalance(e.target.checked)}
              className="h-4 w-4 rounded border-mist-300/30"
            />
            Role rebalance
          </label>
        ) : (
          <p className="text-center font-body text-sm text-mist-300">
            Rebalance: {rebalanceEnabled ? 'on' : 'off'}
            {!isHost ? ' (host controls this)' : null}
          </p>
        )}

        {isHost ? (
          <button
            type="button"
            data-testid="start-game"
            disabled={!canStart}
            onClick={() => socket.startGame()}
            className="min-h-11 rounded-lg bg-brass-500 px-4 py-3.5 font-body text-sm font-bold text-ink-950 transition hover:bg-brass-400 disabled:hover:bg-brass-500"
          >
            Start game
          </button>
        ) : (
          <p className="text-center font-body text-sm text-mist-300">
            Waiting for the host to start…
          </p>
        )}
        <button
          type="button"
          onClick={() => socket.leaveRoom()}
          className="min-h-11 rounded-lg border border-mist-300/20 px-4 py-3 font-body text-sm font-semibold text-mist-200 transition hover:border-mist-300/45 hover:text-mist-100"
        >
          Leave room
        </button>
        {lastError ? (
          <p className="text-center font-body text-sm text-clay-400" role="alert">
            {lastError}
          </p>
        ) : null}
      </div>
    </main>
  );
}
