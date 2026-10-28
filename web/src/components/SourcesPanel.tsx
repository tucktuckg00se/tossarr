import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { Source } from '../api';
import SourceForm from './SourceForm';

interface SourcesPanelProps {
  sources: Source[];
  /** Re-fetch the source list after any change. */
  onChanged: () => void;
}

const SYNC_POLL_MS = 2000;
const SYNC_TIMEOUT_MS = 90_000;

function formatLastSync(iso: string | null): string {
  if (iso === null) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleDateString();
}

export default function SourcesPanel({ sources, onChanged }: SourcesPanelProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stop any in-flight sync polling if the panel unmounts mid-sync.
  useEffect(() => {
    return () => {
      if (pollTimer.current !== null) clearTimeout(pollTimer.current);
    };
  }, []);

  async function toggleEnabled(source: Source) {
    setBusyId(source.id);
    try {
      await api.updateSource(source.id, { enabled: !source.enabled });
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function removeSource(source: Source) {
    const ok = window.confirm(
      `Remove "${source.name}"? Its items and all decisions about them will be deleted from Tossarr. ` +
        'Nothing is changed in Sonarr/Radarr itself.',
    );
    if (!ok) return;
    setBusyId(source.id);
    try {
      await api.deleteSource(source.id);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  // The sync endpoint returns immediately (work runs in the background), so we
  // poll until every enabled source has a lastSync newer than the trigger.
  async function runSync() {
    if (syncing) return;
    const enabled = sources.filter((s) => s.enabled);
    if (enabled.length === 0) {
      setSyncNote('No enabled sources to sync.');
      return;
    }
    const startedAt = Date.now();
    setSyncing(true);
    setSyncNote(null);
    try {
      await api.syncNow();
      const deadline = startedAt + SYNC_TIMEOUT_MS;
      const poll = async () => {
        const fresh = await api.getSources().catch(() => null);
        if (fresh) onChanged();
        const done = (fresh ?? sources).every((s) => !s.enabled || (s.lastSync !== null && Date.parse(s.lastSync) > startedAt));
        if (done) {
          setSyncNote('Sync complete.');
        } else if (Date.now() >= deadline) {
          setSyncNote('Still syncing… sources that do not respond will show their error on the next check.');
        } else {
          pollTimer.current = setTimeout(() => void poll(), SYNC_POLL_MS);
        }
      };
      await poll();
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section>
      <div className="card">
        <h2>Sources</h2>
        <p className="card-sub">Sonarr and Radarr instances Tossarr swipes through.</p>

        {sources.length === 0 ? (
          <p className="empty">No sources yet — add one below.</p>
        ) : (
          <div className="source-list">
            {sources.map((s) => (
              <div key={s.id} className="source-row">
                <span className="source-name">
                  {s.name}
                  <span className={`badge badge-${s.kind}`}>{s.kind}</span>
                </span>
                <span className="source-url" title={s.url}>
                  {s.url}
                </span>
                <span className="source-meta">
                  {s.itemCount} item{s.itemCount === 1 ? '' : 's'}
                </span>
                <span className="source-meta">synced {formatLastSync(s.lastSync)}</span>
                <label className="source-meta" title={s.enabled ? 'Disable this source' : 'Enable this source'}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled={busyId === s.id}
                    onChange={() => void toggleEnabled(s)}
                  />{' '}
                  {s.enabled ? 'enabled' : 'disabled'}
                </label>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busyId === s.id}
                  onClick={() => void removeSource(s)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn" onClick={() => void runSync()} disabled={syncing}>
            {syncing ? (
              <>
                <span className="spinner" />
                Syncing…
              </>
            ) : (
              'Sync now'
            )}
          </button>
          {syncNote && <span className="status-line status-muted">{syncNote}</span>}
        </div>
      </div>

      <div className="card">
        <h2>Add a source</h2>
        <p className="card-sub">Test the connection first — Tossarr only reads your library while you swipe.</p>
        <SourceForm onAdded={onChanged} />
      </div>
    </section>
  );
}
