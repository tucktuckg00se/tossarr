// Typed client for the Tossarr REST API.
//
// All paths are relative so the same bundle works behind Vite's dev proxy
// (which forwards /api to :8901) and when Fastify serves the built app.

export type SourceKind = 'sonarr' | 'radarr';
export type ItemType = 'show' | 'movie';
export type DecisionKind = 'keep' | 'remove';
export type BrowseListName = 'kept' | 'pending' | 'removed';
export type LibraryFilter = 'all' | ItemType;

export interface Settings {
  syncIntervalHours: number;
  keepReappearDays: number;
}

export interface Source {
  id: number;
  name: string;
  kind: SourceKind;
  url: string;
  /** Masked on the wire — echoing it back in a PUT means "unchanged". */
  apiKey: string;
  enabled: boolean;
  itemCount: number;
  lastSync: string | null;
}

export interface Item {
  id: string;
  sourceId: number;
  sourceName: string;
  type: ItemType;
  title: string;
  year: number | null;
  posterUrl: string;
  overview: string;
  meta: Record<string, unknown>;
}

export interface BrowseItem extends Item {
  decidedAt: string;
}

export interface SourceDraft {
  name: string;
  kind: SourceKind;
  url: string;
  apiKey: string;
}

export type SourcePatch = Partial<Pick<Source, 'name' | 'url' | 'apiKey' | 'enabled'>>;

export interface DecisionResult {
  itemId: string;
  decision: DecisionKind;
  decidedAt: string;
  nextDue?: string;
}

/** Error thrown for any non-2xx response; `message` is the server's error text. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (res.status === 204) return undefined as T;

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body !== null && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const suffix = qs.toString();
  return suffix === '' ? path : `${path}?${suffix}`;
}

function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(data) };
}

// --- Health -----------------------------------------------------------------

export function getHealth(): Promise<{ ok: true }> {
  return request('/api/health');
}

// --- Sources ----------------------------------------------------------------

export function getSources(): Promise<Source[]> {
  return request('/api/sources');
}

export function createSource(draft: SourceDraft): Promise<Source> {
  return request('/api/sources', jsonBody(draft));
}

export function updateSource(id: number, patch: SourcePatch): Promise<Source> {
  return request(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export function deleteSource(id: number): Promise<void> {
  return request(`/api/sources/${id}`, { method: 'DELETE' });
}

export interface TestResult {
  ok: true;
  itemCount: number;
}

/** Connects to the instance and counts its items. Throws ApiError on failure. */
export function testSource(kind: SourceKind, url: string, apiKey: string): Promise<TestResult> {
  return request('/api/sources/test', jsonBody({ kind, url, apiKey }));
}

// --- Settings -----------------------------------------------------------------

export function getSettings(): Promise<Settings> {
  return request('/api/settings');
}

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return request('/api/settings', { method: 'PUT', body: JSON.stringify(patch) });
}

// --- Library (deck) ------------------------------------------------------------

export interface DeckBatch {
  items: Item[];
  totalPending: number;
}

export function getLibrary(filter: LibraryFilter = 'all', limit = 20): Promise<DeckBatch> {
  return request(withQuery('/api/library', { filter, limit }));
}

// --- Browse -------------------------------------------------------------------

export interface BrowsePage {
  list: BrowseListName;
  items: BrowseItem[];
  total: number;
}

export function getBrowse(list: BrowseListName, limit = 50, offset = 0): Promise<BrowsePage> {
  return request(withQuery('/api/browse', { list, limit, offset }));
}

// --- Decisions ------------------------------------------------------------------

export function decide(itemId: string, decision: DecisionKind): Promise<DecisionResult> {
  return request(`/api/decisions/${itemId}`, jsonBody({ decision }));
}

/** Removes the most recent pending decision; returns the item so it can reappear. */
export function undoDecision(): Promise<{ item: Item }> {
  return request('/api/decisions/undo', jsonBody(null));
}

export interface ConfirmResult {
  ok: true;
  alreadyGone?: boolean;
}

export function confirmRemoval(itemId: string): Promise<ConfirmResult> {
  return request(`/api/decisions/${itemId}/confirm`, jsonBody(null));
}

export interface ConfirmAllResult {
  confirmed: number;
  failed: Array<{ itemId: string; error: string }>;
}

export function confirmAllRemovals(): Promise<ConfirmAllResult> {
  return request('/api/decisions/confirm-all', jsonBody(null));
}

/** Clears all unconfirmed decisions. Confirmed removals are preserved. */
export function resetDecisions(): Promise<{ ok: true; cleared: number }> {
  return request('/api/decisions/reset', jsonBody(null));
}

/** Clears a single decision without touching upstream. */
export function clearDecision(itemId: string): Promise<void> {
  return request(`/api/decisions/${itemId}`, { method: 'DELETE' });
}

// --- Sync -----------------------------------------------------------------------

/** Kicks off a background resync of all enabled sources. Returns immediately; poll getSources for results. */
export function syncNow(): Promise<{ ok: true }> {
  return request('/api/sync', jsonBody(null));
}
