import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppChrome } from './components/AppChrome';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { NoStoreMeta } from './components/NoStoreMeta';
import { GameScreen } from './screens/GameScreen';
import { HomeScreen } from './screens/HomeScreen';
import { LobbyScreen } from './screens/LobbyScreen';
import { SocketProvider } from './socket/SocketProvider';

export function App() {
  return (
    <BrowserRouter>
      <AppErrorBoundary>
        <SocketProvider>
          <NoStoreMeta />
          <AppChrome />
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/lobby" element={<LobbyScreen />} />
            <Route path="/game" element={<GameScreen />} />
            <Route path="/role" element={<Navigate to="/game" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SocketProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  );
}
