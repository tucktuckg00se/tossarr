import type { ReactNode } from 'react';

export type Page = 'deck' | 'browse' | 'trash' | 'settings';

interface BottomNavProps {
  page: Page;
  pendingCount: number;
  onNavigate: (page: Page) => void;
}

const ICONS: Record<Page, ReactNode> = {
  deck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="3" width="12" height="16" rx="2" />
      <path d="M5 7v10a3 3 0 0 0 3 3h9" />
    </svg>
  ),
  browse: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l1 13h9l1-13" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 7h3M11 7h9" />
      <circle cx="9" cy="7" r="2" />
      <path d="M4 12h9M17 12h3" />
      <circle cx="15" cy="12" r="2" />
      <path d="M4 17h1M9 17h11" />
      <circle cx="7" cy="17" r="2" />
    </svg>
  ),
};

const ITEMS: Array<{ id: Page; label: string }> = [
  { id: 'deck', label: 'Deck' },
  { id: 'browse', label: 'Browse' },
  { id: 'trash', label: 'Trash' },
  { id: 'settings', label: 'Settings' },
];

export default function BottomNav({ page, pendingCount, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`nav-item ${page === item.id ? 'nav-active' : ''}`}
          aria-current={page === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          {ICONS[item.id]}
          <span className="nav-label">{item.label}</span>
          {item.id === 'trash' && pendingCount > 0 && (
            <span className="nav-badge" aria-hidden="true">
              {pendingCount}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
