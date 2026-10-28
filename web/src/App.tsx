import { useCallback, useEffect, useState } from 'react';
import * as api from './api';
import type { Settings, Source } from './api';
import Setup from './components/Setup';
import SourcesPanel from './components/SourcesPanel';
import SettingsPanel from './components/SettingsPanel';

type Tab = 'deck' | 'browse' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'deck', label: 'Deck' },
  { id: 'browse', label: 'Browse' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>('deck');

  const refreshSources = useCallback(async () => {
    try {
      setSources(await api.getSources());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshSources();
    api.getSettings().then(setSettings).catch(() => undefined);
  }, [refreshSources]);

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
      <header className="app-header">
        <h1 className="brand">Tossarr</h1>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-main">
        {tab === 'deck' && (
          <div className="card">
            <h2>Deck</h2>
            <p className="empty">The swipe deck arrives in the next milestone — right keeps, left tosses.</p>
          </div>
        )}
        {tab === 'browse' && (
          <div className="card">
            <h2>Browse</h2>
            <p className="empty">Kept, pending and removed lists arrive in the next milestone.</p>
          </div>
        )}
        {tab === 'settings' && (
          <>
            <SourcesPanel sources={sources} onChanged={() => void refreshSources()} />
            {settings !== null && <SettingsPanel settings={settings} onSaved={setSettings} />}
          </>
        )}
      </main>
    </div>
  );
}
