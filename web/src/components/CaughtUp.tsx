import { useEffect, useState } from 'react';
import * as api from '../api';

interface CaughtUpProps {
  pendingCount: number;
  syncing: boolean;
  onResync: () => void;
  onResetDecisions: () => void;
}

export default function CaughtUp({ pendingCount, syncing, onResync, onResetDecisions }: CaughtUpProps) {
  const [kept, setKept] = useState<number | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);

  // Cheap totals for the stat chips; limit=1 since we only want `total`.
  useEffect(() => {
    let cancelled = false;
    void api.getBrowse('kept', 1).then((p) => {
      if (!cancelled) setKept(p.total);
    }).catch(() => undefined);
    void api.getBrowse('removed', 1).then((p) => {
      if (!cancelled) setRemoved(p.total);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function reset() {
    const ok = window.confirm('Put every kept and pending item back in the deck? Confirmed removals are preserved.');
    if (ok) onResetDecisions();
  }

  return (
    <div className="caught-up">
      <div className="caught-up-icon" aria-hidden="true">
        ✓
      </div>
      <h2>All caught up</h2>
      <p>You swiped through everything Tossarr knows about.</p>

      <div className="stats">
        <div className="stat">
          <span className="stat-num">{kept ?? '…'}</span>
          <span className="stat-label">Kept</span>
        </div>
        <div className="stat">
          <span className="stat-num">{pendingCount}</span>
          <span className="stat-label">Pending</span>
        </div>
        <div className="stat">
          <span className="stat-num">{removed ?? '…'}</span>
          <span className="stat-label">Removed</span>
        </div>
      </div>

      {pendingCount > 0 && (
        <p>
          {pendingCount} item{pendingCount === 1 ? '' : 's'} waiting in Trash.
        </p>
      )}

      <div className="btn-row" style={{ justifyContent: 'center', marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={onResync} disabled={syncing}>
          {syncing ? (
            <>
              <span className="spinner" />
              Syncing…
            </>
          ) : (
            'Sync now'
          )}
        </button>
        <button type="button" className="btn btn-danger" onClick={reset}>
          Reset decisions
        </button>
      </div>
    </div>
  );
}
