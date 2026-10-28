import SourceForm from './SourceForm';

interface SetupProps {
  /** Called after a source is added; the parent re-fetches and routes to the main app. */
  onAdded: () => void;
}

/** First-run screen, shown until at least one source exists. */
export default function Setup({ onAdded }: SetupProps) {
  return (
    <main className="shell">
      <div className="brand-card">
        <h1 className="brand brand-large">Tossarr</h1>
        <p className="tagline">Swipe through your Sonarr &amp; Radarr libraries. Keep what you love, toss the rest.</p>
        <div className="card" style={{ textAlign: 'left' }}>
          <h2>Connect a source</h2>
          <p className="card-sub">
            Add at least one instance to get started. Find your API key under Settings → General in Sonarr or Radarr.
          </p>
          <SourceForm onAdded={onAdded} />
        </div>
      </div>
    </main>
  );
}
