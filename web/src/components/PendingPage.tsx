import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { BrowseItem } from '../api';

interface PendingPageProps {
  showToast: (message: string, kind?: 'ok' | 'error') => void;
  onCountChange: (total: number) => void;
}

const PAGE_SIZE = 200; // server max; plenty for v1
const ARM_TIMEOUT_MS = 5000;

function timeAgo(iso: string): string {
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

export default function PendingPage({ showToast, onCountChange }: PendingPageProps) {
  const [rows, setRows] = useState<BrowseItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null); // item id or 'all'
  const [armed, setArmed] = useState(false); // first click of the confirm-all double-confirm
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api.getBrowse('pending', PAGE_SIZE);
      setRows(page.items);
      setTotal(page.total);
      onCountChange(page.total);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [onCountChange, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current);
    },
    [],
  );

  async function runConfirmAll() {
    setBusyId('all');
    try {
      const result = await api.confirmAllRemovals();
      if (result.failed.length > 0) {
        showToast(`Confirmed ${result.confirmed}; ${result.failed.length} failed and stay pending.`, 'error');
      } else {
        showToast(`Permanently deleted ${result.confirmed} item${result.confirmed === 1 ? '' : 's'}.`, 'ok');
      }
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  // Two-step arm/disarm: first click arms, second click (within 5s) executes.
  function onConfirmAllClick() {
    if (total === 0 || busyId !== null) return;
    if (!armed) {
      setArmed(true);
      if (armTimer.current !== null) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
      return;
    }
    if (armTimer.current !== null) clearTimeout(armTimer.current);
    setArmed(false);
    void runConfirmAll();
  }

  async function confirmOne(item: BrowseItem) {
    const ok = window.confirm(
      `Permanently delete "${item.title}" from ${item.sourceName}? This removes its metadata and media files — it cannot be undone.`,
    );
    if (!ok) return;
    setBusyId(item.id);
    try {
      const result = await api.confirmRemoval(item.id);
      showToast(
        result.alreadyGone
          ? `"${item.title}" was already gone upstream — removed from the list.`
          : `Deleted "${item.title}".`,
        'ok',
      );
      await load();
    } catch (err) {
      // e.g. 502: the upstream delete failed and the item stays pending.
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function restore(item: BrowseItem) {
    setBusyId(item.id);
    try {
      await api.clearDecision(item.id);
      showToast(`Restored "${item.title}" to the deck.`, 'ok');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Trash</h2>
        <p className="card-sub">
          Items you swiped left. Confirming deletes them from Sonarr/Radarr for good — metadata and media files. Restoring
          puts them back in the deck.
        </p>

        {rows === null ? (
          <p className="status-line status-muted">
            <span className="spinner" />
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="empty">Nothing waiting. Swipe left on the deck to toss something.</p>
        ) : (
          <>
            <div className="source-list">
              {rows.map((item) => (
                <div key={item.id} className="trash-row">
                  <img className="trash-thumb" src={item.posterUrl} alt="" />
                  <div>
                    <div className="trash-title">
                      {item.title}
                      {item.year !== null ? ` (${item.year})` : ''}
                    </div>
                    <div className="trash-meta">
                      {item.sourceName} · {item.type === 'show' ? 'Show' : 'Movie'} · decided {timeAgo(item.decidedAt)}
                    </div>
                  </div>
                  <div className="trash-actions">
                    <button type="button" className="btn" disabled={busyId !== null} onClick={() => void restore(item)}>
                      Restore
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busyId !== null}
                      onClick={() => void confirmOne(item)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {total > rows.length && <p className="hint">Showing the first {rows.length} of {total}.</p>}
          </>
        )}
      </div>

      {total > 0 && (
        <div className="card">
          <h2>Make it final</h2>
          <p className="card-sub">
            This permanently deletes {total === 1 ? 'the item' : `${total} items`} from your Sonarr/Radarr instance
            {total === 1 ? '' : 's'}, including media files. There is no undo.
          </p>
          <button
            type="button"
            className={armed ? 'btn btn-armed' : 'btn btn-danger'}
            disabled={busyId !== null}
            onClick={onConfirmAllClick}
          >
            {busyId === 'all' ? (
              <>
                <span className="spinner" />
                Deleting…
              </>
            ) : armed ? (
              `Click again — permanently delete ${total} item${total === 1 ? '' : 's'}`
            ) : (
              `Confirm all ${total}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}
