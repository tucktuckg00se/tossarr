import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as api from '../api';
import type { Item, LibraryFilter } from '../api';
import CaughtUp from './CaughtUp';

interface DeckProps {
  pendingCount: number;
  showToast: (message: string, kind?: 'ok' | 'error') => void;
  /** App re-fetches the Trash badge after any decision or undo. */
  onPendingChange: () => void;
}

const BATCH_SIZE = 20;
const PREFETCH_THRESHOLD = 5;
const COMMIT_DISTANCE_PX = 120;
const COMMIT_VELOCITY = 0.5; // px/ms
const TAP_MAX_PX = 12; // pointer travel below this on release counts as a tap (open details)
const FLY_MS = 300;
const RESYNC_POLL_MS = 3000;
const RESYNC_TIMEOUT_MS = 60_000;

type DecisionKind = 'keep' | 'remove';

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'show', label: 'Shows' },
  { id: 'movie', label: 'Movies' },
];

interface PointerInfo {
  id: number;
  startX: number;
  samples: Array<{ t: number; x: number }>;
}

/** One line of light meta for the subtitle: network/genres/runtime, whatever the source has. */
function metaLine(item: Item): string {
  const parts: string[] = [];
  const m = item.meta;
  if (typeof m.network === 'string' && m.network !== '') parts.push(m.network);
  const genres = Array.isArray(m.genres) ? (m.genres as unknown[]).filter((g): g is string => typeof g === 'string') : [];
  if (genres.length > 0) parts.push(genres.slice(0, 2).join(', '));
  if (typeof m.runtime === 'number' && m.runtime > 0) parts.push(`${Math.round(m.runtime)} min`);
  return parts.join(' · ');
}

export default function Deck({ pendingCount, showToast, onPendingChange }: DeckProps) {
  const [queue, setQueue] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState<DecisionKind | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [showDetails, setShowDetails] = useState(false); // tap the poster → info overlay

  const pointer = useRef<PointerInfo | null>(null);
  const busyRef = useRef(false); // one decision in flight at a time (drag + button + keys)
  const prefetchingRef = useRef(false);
  const resyncTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = queue[0] ?? null;

  const load = useCallback(async (f: LibraryFilter) => {
    setLoading(true);
    setLoadError(null);
    try {
      const batch = await api.getLibrary(f, BATCH_SIZE);
      setQueue(batch.items);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount and filter changes both go through here.
  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  // Prefetch: when the queue runs low, append a fresh batch (deduped by id).
  useEffect(() => {
    if (loading || loadError !== null || current === null) return;
    if (queue.length > PREFETCH_THRESHOLD || prefetchingRef.current) return;
    prefetchingRef.current = true;
    void api
      .getLibrary(filter, BATCH_SIZE)
      .then((batch) => {
        setQueue((q) => {
          const known = new Set(q.map((i) => i.id));
          const fresh = batch.items.filter((i) => !known.has(i.id));
          return fresh.length === 0 ? q : [...q, ...fresh];
        });
      })
      .catch(() => undefined) // non-fatal; the next low-queue render retries
      .finally(() => {
        prefetchingRef.current = false;
      });
  }, [loading, loadError, current, queue.length, filter]);

  const commit = useCallback(
    async (decision: DecisionKind) => {
      if (busyRef.current || current === null) return;
      busyRef.current = true;
      setFlying(decision);
      setDragging(false);
      setDragDx(0);
      await new Promise((resolve) => setTimeout(resolve, FLY_MS));
      const item = current;
      try {
        await api.decide(item.id, decision);
        setQueue((q) => q.filter((i) => i.id !== item.id)); // head pops; next card promotes
      } catch (err) {
        // The card never left the queue, so clearing `flying` springs it back.
        showToast(`Couldn't save — "${item.title}" is back on top. ${err instanceof Error ? err.message : ''}`, 'error');
      } finally {
        setFlying(null);
        busyRef.current = false;
        onPendingChange();
      }
    },
    [current, showToast, onPendingChange],
  );

  const undo = useCallback(async () => {
    if (busyRef.current) return;
    try {
      const { item } = await api.undoDecision();
      setQueue((q) => (q.some((i) => i.id === item.id) ? q : [item, ...q]));
      showToast(`Undid: ${item.title}`, 'ok');
      onPendingChange();
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 404) showToast('Nothing to undo.', 'ok');
      else showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [showToast, onPendingChange]);

  // Keyboard: ←/j remove, →/l keep, u/Backspace undo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore OS key auto-repeat — holding an arrow key must not mass-swipe.
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape') {
        setShowDetails(false);
        return;
      }
      if (showDetails) return; // the details overlay owns the keyboard until closed
      switch (e.key) {
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          void commit('remove');
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          void commit('keep');
          break;
        case 'u':
        case 'Backspace':
          e.preventDefault();
          void undo();
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, undo, showDetails]);

  useEffect(
    () => () => {
      if (resyncTimer.current !== null) clearInterval(resyncTimer.current);
    },
    [],
  );

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (flying !== null || current === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = { id: e.pointerId, startX: e.clientX, samples: [{ t: performance.now(), x: e.clientX }] };
    setDragging(true);
    setDragDx(0);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = pointer.current;
    if (p === null || e.pointerId !== p.id) return;
    p.samples.push({ t: performance.now(), x: e.clientX });
    if (p.samples.length > 8) p.samples.shift();
    setDragDx(e.clientX - p.startX);
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const p = pointer.current;
    if (p === null || e.pointerId !== p.id) return;
    pointer.current = null;
    setDragging(false);

    if (cancelled) {
      setDragDx(0); // spring back
      return;
    }

    const dx = e.clientX - p.startX;
    // Flick velocity: displacement over the last ~100ms of movement samples.
    let velocity = 0;
    const samples = p.samples;
    if (samples.length >= 2) {
      const last = samples[samples.length - 1]!;
      let first = samples[0]!;
      for (const s of samples) {
        if (last.t - s.t <= 100) {
          first = s;
          break;
        }
      }
      const dt = last.t - first.t;
      if (dt > 0) velocity = (last.x - first.x) / dt;
    }

    const committed =
      Math.abs(dx) > COMMIT_DISTANCE_PX || (Math.abs(velocity) > COMMIT_VELOCITY && Math.sign(velocity) === Math.sign(dx));
    setDragDx(0); // spring back — or the flying class takes over, batched into the same render
    if (committed) {
      void commit(velocity !== 0 ? (velocity > 0 ? 'keep' : 'remove') : dx > 0 ? 'keep' : 'remove');
    } else if (Math.abs(dx) < TAP_MAX_PX) {
      // A still finger released on the poster: open the details overlay.
      setShowDetails(true);
    }
  }

  async function resync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.syncNow();
      showToast('Sync started — the deck refills when it finishes.', 'ok');
      const startedAt = Date.now();
      resyncTimer.current = setInterval(() => {
        void api
          .getLibrary(filter, BATCH_SIZE)
          .then((batch) => {
            if (batch.items.length > 0) {
              if (resyncTimer.current !== null) clearInterval(resyncTimer.current);
              resyncTimer.current = null;
              setQueue(batch.items);
              setSyncing(false);
            } else if (Date.now() - startedAt > RESYNC_TIMEOUT_MS) {
              if (resyncTimer.current !== null) clearInterval(resyncTimer.current);
              resyncTimer.current = null;
              setSyncing(false);
              showToast('Sync finished but the deck is still empty — check your sources.', 'error');
            }
          })
          .catch(() => undefined);
      }, RESYNC_POLL_MS);
    } catch (err) {
      setSyncing(false);
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  async function resetDecisions() {
    try {
      const result = await api.resetDecisions();
      showToast(`Cleared ${result.cleared} decision${result.cleared === 1 ? '' : 's'} — back in the deck.`, 'ok');
      onPendingChange();
      void load(filter);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  const filterSeg = (
    <div className="seg" aria-label="Deck filter">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filter === f.id}
          className={`seg-btn ${filter === f.id ? 'seg-btn-active' : ''}`}
          onClick={() => setFilter((cur) => (cur === f.id ? cur : f.id))}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="deck-layout">
        <div className="deck-card-zone">
          <div className="deck-card skeleton" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="caught-up">
        <h2>Couldn't load the deck</h2>
        <p>{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load(filter)}>
          Try again
        </button>
      </div>
    );
  }

  if (current === null) {
    return (
      <>
        <div className="deck-filter deck-filter-float">{filterSeg}</div>
        <CaughtUp pendingCount={pendingCount} syncing={syncing} onResync={() => void resync()} onResetDecisions={() => void resetDecisions()} />
      </>
    );
  }

  const cardClass = [
    'deck-card',
    dragging ? 'dragging' : '',
    flying === 'keep' ? 'flying-keep' : '',
    flying === 'remove' ? 'flying-remove' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const keepOpacity = flying === 'keep' ? 1 : Math.max(0, Math.min(1, dragDx / COMMIT_DISTANCE_PX));
  const removeOpacity = flying === 'remove' ? 1 : Math.max(0, Math.min(1, -dragDx / COMMIT_DISTANCE_PX));
  const meta = metaLine(current);

  return (
    <>
      <div className="cover-bg" style={{ backgroundImage: `url("${current.posterUrl}")` }} aria-hidden="true" />
      <div className="scrim scrim-top" aria-hidden="true" />
      <div className="scrim scrim-bottom" aria-hidden="true" />
      <div className="deck-layout">
        <div className="deck-filter">{filterSeg}</div>

        {/* Announce card changes to screen readers (dragging is not keyboard-accessible on its own). */}
        <div className="sr-only" role="status">
          {current.title}
          {current.year !== null ? `, ${current.year}` : ''}, {current.type === 'show' ? 'show' : 'movie'}
        </div>

        <div className="deck-card-zone">
          <div
            className={cardClass}
            style={
              dragging && flying === null ? { transform: `translateX(${dragDx}px) rotate(${dragDx * 0.04}deg)` } : undefined
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerEnd(e, false)}
            onPointerCancel={(e) => onPointerEnd(e, true)}
          >
            <img src={current.posterUrl} alt={`${current.title} poster`} draggable={false} />
            <span className="deck-badge deck-badge-keep" style={{ opacity: keepOpacity }} aria-hidden="true">
              KEEP
            </span>
            <span className="deck-badge deck-badge-remove" style={{ opacity: removeOpacity }} aria-hidden="true">
              NOPE
            </span>
          </div>
        </div>

        <div className="decision-bar">
        <button
          type="button"
          className="dec-btn dec-btn-remove"
          aria-label="Remove (swipe left)"
          disabled={flying !== null}
          onClick={() => void commit('remove')}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button type="button" className="dec-btn dec-btn-undo" aria-label="Undo last decision" onClick={() => void undo()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
          </svg>
        </button>
        <button
          type="button"
          className="dec-btn dec-btn-keep"
          aria-label="Keep (swipe right)"
          disabled={flying !== null}
          onClick={() => void commit('keep')}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M4 12.5l5 5L20 7" />
          </svg>
        </button>
        </div>
      </div>

      {showDetails && (
        <div
          className="deck-details"
          role="dialog"
          aria-modal="true"
          aria-label={`Details for ${current.title}`}
          onClick={() => setShowDetails(false)}
        >
          <div className="deck-details-panel" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="deck-details-close" aria-label="Close details" onClick={() => setShowDetails(false)}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <h2 className="deck-details-title">{current.title}</h2>
            <p className="deck-details-meta">
              {current.year !== null && <span>{current.year}</span>}
              <span className="badge badge-type">{current.type === 'show' ? 'Show' : 'Movie'}</span>
              <span>{current.sourceName}</span>
              {meta !== '' && <span>{meta}</span>}
            </p>
            {current.overview !== '' && <p className="deck-details-overview">{current.overview}</p>}
          </div>
        </div>
      )}
    </>
  );
}
