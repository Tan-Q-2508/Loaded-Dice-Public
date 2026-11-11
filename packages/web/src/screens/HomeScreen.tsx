import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { HowToPlayGuide } from '../components/HowToPlayGuide';
import { useGameSocket } from '../socket/SocketProvider';
import { useGameStore } from '../store/gameStore';

export function HomeScreen() {
  const socket = useGameSocket();
  const connectionPhase = useGameStore((s) => s.connectionPhase);
  const connectionMessage = useGameStore((s) => s.connectionMessage);
  const lastError = useGameStore((s) => s.lastError);
  const roomId = useGameStore((s) => s.roomId);
  const view = useGameStore((s) => s.view);

  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [rebalance, setRebalance] = useState(false);
  const [mode, setMode] = useState<'create' | 'join'>('create');

  if (roomId && view?.phase.kind === 'LOBBY') {
    return <Navigate to="/lobby" replace />;
  }
  if (roomId && view && view.phase.kind !== 'LOBBY') {
    return <Navigate to="/game" replace />;
  }

  const ready = connectionPhase === 'ready';
  const nameOk = displayName.trim().length >= 1 && displayName.trim().length <= 32;

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!nameOk || !ready) return;
    socket.createRoom(displayName.trim(), rebalance);
  };

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    if (!nameOk || !ready || roomCode.trim().length < 1) return;
    const normalized = roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (normalized.length < 1) return;
    socket.joinRoom(normalized, displayName.trim());
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(brass-500/12),transparent_55%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-clay-600/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-brass-600/15 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16 pt-[max(4rem,env(safe-area-inset-top))]">
        <header className="mb-12 animate-[bannerIn_500ms_ease-out] text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-mist-100 sm:text-5xl lg:text-7xl">
            Loaded Dice
          </h1>
          <p className="mx-auto mt-5 max-w-md font-body text-base leading-relaxed text-mist-300 sm:text-lg">
            A court of decrees. Elect a Maharaj. Trust carefully.
          </p>
          <div className="mt-6">
            <HowToPlayGuide />
          </div>
        </header>

        <div className="court-table relative rounded-[1.75rem] px-6 py-8 shadow-table sm:px-8">
          <div className="mb-6 flex gap-1 rounded-lg bg-ink-950/50 p-1">
            <button
              type="button"
              className={`min-h-11 flex-1 rounded-md py-2.5 font-body text-sm font-semibold transition ${
                mode === 'create'
                  ? 'bg-brass-500/20 text-brass-300'
                  : 'text-mist-300 hover:text-mist-100'
              }`}
              onClick={() => setMode('create')}
            >
              Create room
            </button>
            <button
              type="button"
              className={`min-h-11 flex-1 rounded-md py-2.5 font-body text-sm font-semibold transition ${
                mode === 'join'
                  ? 'bg-brass-500/20 text-brass-300'
                  : 'text-mist-300 hover:text-mist-100'
              }`}
              data-testid="mode-join"
              onClick={() => setMode('join')}
            >
              Join room
            </button>
          </div>

          {mode === 'create' ? (
            <form onSubmit={onCreate} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-mist-300">
                  Display name
                </span>
                <input
                  type="text"
                  data-testid="display-name-input"
                  value={displayName}
                  maxLength={32}
                  autoComplete="nickname"
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="min-h-11 rounded-lg border border-brass-500/20 bg-ink-950/70 px-3 py-3 font-body text-mist-100 caret-brass-300 outline-none ring-brass-500/30 focus:ring-2"
                  placeholder="Your name at the table"
                  inputMode="text"
                  enterKeyHint="done"
                />
              </label>
              <label className="flex items-center gap-3 font-body text-sm text-mist-200">
                <input
                  type="checkbox"
                  data-testid="rebalance-checkbox"
                  checked={rebalance}
                  onChange={(e) => setRebalance(e.target.checked)}
                  className="h-4 w-4 rounded border-mist-300/30"
                />
                Enable role rebalance
              </label>
              <button
                type="submit"
                data-testid="create-room"
                disabled={!ready || !nameOk}
                className="mt-2 min-h-11 rounded-lg bg-brass-500 px-4 py-3.5 font-body text-sm font-bold text-ink-950 transition hover:bg-brass-400 disabled:hover:bg-brass-500"
              >
                Open the court
              </button>
            </form>
          ) : (
            <form onSubmit={onJoin} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-mist-300">
                  Room code
                </span>
                <input
                  type="text"
                  data-testid="room-code-input"
                  value={roomCode}
                  maxLength={16}
                  autoCapitalize="characters"
                  onChange={(e) =>
                    setRoomCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
                  }
                  className="min-h-11 rounded-lg border border-brass-500/20 bg-ink-950/70 px-3 py-3 font-body tracking-[0.28em] text-mist-100 caret-brass-300 outline-none ring-brass-500/30 focus:ring-2"
                  placeholder="ABC123"
                  inputMode="text"
                  enterKeyHint="next"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-xs font-semibold uppercase tracking-[0.18em] text-mist-300">
                  Display name
                </span>
                <input
                  type="text"
                  data-testid="display-name-input"
                  value={displayName}
                  maxLength={32}
                  autoComplete="nickname"
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="min-h-11 rounded-lg border border-brass-500/20 bg-ink-950/70 px-3 py-3 font-body text-mist-100 caret-brass-300 outline-none ring-brass-500/30 focus:ring-2"
                  placeholder="Your name at the table"
                  inputMode="text"
                  enterKeyHint="done"
                />
              </label>
              <button
                type="submit"
                data-testid="join-room"
                disabled={!ready || !nameOk || roomCode.trim().length < 1}
                className="mt-2 min-h-11 rounded-lg bg-brass-500 px-4 py-3.5 font-body text-sm font-bold text-ink-950 transition hover:bg-brass-400 disabled:hover:bg-brass-500"
              >
                Take a seat
              </button>
            </form>
          )}

          <p className="mt-6 text-center font-body text-xs text-mist-400" role="status">
            {connectionPhase === 'connecting' && 'Connecting…'}
            {connectionPhase === 'reconnecting' && 'Reconnecting…'}
            {connectionPhase === 'ready' && 'Connected to the court'}
            {connectionPhase === 'protocol_mismatch' && (connectionMessage ?? 'Protocol mismatch')}
            {connectionPhase === 'error' && (connectionMessage ?? 'Connection error')}
            {connectionPhase === 'idle' && 'Starting…'}
          </p>
          {lastError ? (
            <p className="mt-2 text-center font-body text-sm text-clay-400" role="alert">
              {lastError}
              {/already in progress|unable to join/i.test(lastError) ? (
                <span className="mt-1 block text-mist-300">
                  That room can&apos;t take new players. Create a new room and share the fresh code.
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
