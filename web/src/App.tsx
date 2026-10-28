import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { Settings, Source } from './api';
import BottomNav from './components/BottomNav';
import type { Page } from './components/BottomNav';
import Deck from './components/Deck';
import PendingPage from './components/PendingPage';
import Setup from './components/Setup';
import SourcesPanel from './components/SourcesPanel';
import SettingsPanel from './components/SettingsPanel';

interface Toast {
  message: string;
  kind: 'ok' | 'error';
}

const TOAST_MS = 4000;

export default function App() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [page, setPage] = useState<Page>('deck');
  const [pendingCount, setPendingCount] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ message, kind });
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    },
    [],
  );

  const refreshSources = useCallback(async () => {
    try {
      setSources(await api.getSources());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Cheap live count for the Trash badge: limit=1, we only want `total`.
  const refreshPending = useCallback(() => {
    api
      .getBrowse('pending', 1)
      .then((p) => setPendingCount(p.total))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refreshSources();
    api.getSettings().then(setSettings).catch(() => undefined);
    refreshPending();
  }, [refreshSources, refreshPending]);

  if (loadError !== null) {
    return (
      <main className="shell">
        <div className="brand-card">
          <h1 className="brand brand-large">Tossarr</h1>
          <p className={`status-line status-error`}>Could not reach the server: {loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => void refreshSources()}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (sources === null) {
    return (
      <main className="shell">
        <div className="brand-card">
          <h1 className="brand brand-large">Tossarr</h1>
          <p className="status-line status-muted">Loading…</p>
        </div>
      </main>
    );
  }

  // First run: no sources yet → setup screen. Adding one routes back here automatically.
  if (sources.length === 0) {
    return <Setup onAdded={() => void refreshSources()} />;
  }

  return (
    <div className="app">
      <div className="stage">
        {page === 'deck' && <Deck pendingCount={pendingCount} showToast={showToast} onPendingChange={refreshPending} />}
        {page === 'browse' && (
          <div className="page">
            <div className="card">
              <h2>Browse</h2>
              <p className="empty">Kept and removed lists arrive in the next milestone.</p>
            </div>
          </div>
        )}
        {page === 'trash' && (
          <div className="page">
            <PendingPage showToast={showToast} onCountChange={setPendingCount} />
          </div>
        )}
        {page === 'settings' && (
          <div className="page">
            <SourcesPanel sources={sources} onChanged={() => void refreshSources()} />
            {settings !== null && <SettingsPanel settings={settings} onSaved={setSettings} />}
          </div>
        )}
      </div>
      <BottomNav page={page} pendingCount={pendingCount} onNavigate={setPage} />
      {toast !== null && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
