import { useCallback, useEffect, useState } from 'react';
import * as api from '../api';
import type { BrowseItem } from '../api';
import { displayTitle } from '../title';
import { timeAgo } from '../time';

interface BrowsePageProps {
  showToast: (message: string, kind?: 'ok' | 'error') => void;
}

const PAGE_SIZE = 50;

type ListTab = 'kept' | 'removed';

const TABS: Array<{ id: ListTab; label: string }> = [
  { id: 'kept', label: 'Kept' },
  { id: 'removed', label: 'Removed' },
];

export default function BrowsePage({ showToast }: BrowsePageProps) {
  const [tab, setTab] = useState<ListTab>('kept');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<BrowseItem[] | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(
    async (list: ListTab, off: number) => {
      try {
        const page = await api.getBrowse(list, PAGE_SIZE, off);
        setRows(page.items);
        setTotal(page.total);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), 'error');
      }
    },
    [showToast],
  );

  useEffect(() => {
    void load(tab, offset);
  }, [load, tab, offset]);

  function switchTab(next: ListTab) {
    setTab(next);
    setOffset(0);
  }

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="card">
      <div className="browse-head">
        <h2>Browse</h2>
        <div className="seg" aria-label="Browse list">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              className={`seg-btn ${tab === t.id ? 'seg-btn-active' : ''}`}
              onClick={() => switchTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="card-sub">
        {tab === 'kept'
          ? 'Items you swiped right. They stay in your library and return to the deck after the reappear interval.'
          : 'A log of items permanently deleted from Sonarr/Radarr. These cannot be restored.'}
      </p>

      {rows === null ? (
        <div className="source-list" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="trash-row">
              <div className="skeleton" style={{ width: 48, height: 72 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <div className="skeleton" style={{ height: 14, width: '60%' }} />
                <div className="skeleton" style={{ height: 12, width: '85%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="empty">
          {tab === 'kept'
            ? 'Nothing kept yet — swipe right on the deck.'
            : 'Nothing deleted yet. Items you confirm in Trash land here.'}
        </p>
      ) : (
        <>
          <div className="source-list">
            {rows.map((item) => (
              <div key={item.id} className="trash-row">
                <img className="trash-thumb" src={item.posterUrl} alt="" />
                <div>
                  <div className="trash-title">{displayTitle(item.title, item.year)}</div>
                  <div className="trash-meta">
                    {item.sourceName} · {item.type === 'show' ? 'Show' : 'Movie'} ·{' '}
                    {tab === 'kept' ? 'kept' : 'deleted'} {timeAgo(item.decidedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="pager">
            <span className="hint" style={{ margin: 0 }}>
              Showing {start}–{end} of {total}
            </span>
            <div className="btn-row">
              <button type="button" className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Newer
              </button>
              <button type="button" className="btn" disabled={end >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Older
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
