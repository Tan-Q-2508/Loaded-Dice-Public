import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearAuthToken } from '../lib/storage';

type Props = {
  readonly children: ReactNode;
};

type State = {
  readonly error: Error | null;
};

/**
 * Last-resort UI when a render/effect crash would otherwise leave #root empty
 * (e.g. historical nav-trap DataCloneError on /game).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private reset = () => {
    clearAuthToken();
    this.setState({ error: null });
    window.location.replace('/');
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="font-display text-2xl text-mist-100">Something went wrong</h1>
        <p className="mt-3 font-body text-sm text-mist-300">
          The game view crashed. Return home to create or join a new room.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-8 rounded-md bg-brass-500 px-4 py-3 font-body text-sm font-bold text-ink-950 transition hover:bg-brass-400"
        >
          Clear session and go home
        </button>
      </main>
    );
  }
}
