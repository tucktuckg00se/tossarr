import { useEffect, useState } from 'react';

type Health = 'checking' | 'ok' | 'error';

export default function App() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(() => {
        if (!cancelled) setHealth('ok');
      })
      .catch(() => {
        if (!cancelled) setHealth('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <h1>Tossarr</h1>
      <p className="tagline">Swipe through your Sonarr &amp; Radarr libraries.</p>
      <p className={`status status-${health}`}>
        {health === 'checking' && 'Checking server…'}
        {health === 'ok' && 'Server connected.'}
        {health === 'error' && 'Server unreachable — is it running on :8901?'}
      </p>
    </main>
  );
}
