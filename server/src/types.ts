export type SourceKind = 'sonarr' | 'radarr';
export type ItemType = 'show' | 'movie';
export type DecisionKind = 'keep' | 'remove';

/** Item shape after normalizing a Sonarr/Radarr API record. */
export interface NormalizedItem {
  externalId: string;
  type: ItemType;
  title: string;
  year: number | null;
  /** Path relative to the source's root, e.g. `/poster/123.jpg`. */
  posterPath: string | null;
  overview: string;
  meta: Record<string, unknown>;
}

/** Item shape returned by the API to the frontend. */
export interface Item {
  id: string;
  sourceId: number;
  sourceName: string;
  type: ItemType;
  title: string;
  year: number | null;
  /** Always a local `/api/posters/...` path (proxy + fallback). */
  posterUrl: string;
  overview: string;
  meta: Record<string, unknown>;
}

export interface Settings {
  syncIntervalHours: number;
  keepReappearDays: number;
}

/** Client for one Sonarr/Radarr instance (real or mock). */
export interface MediaClient {
  kind: SourceKind;
  listItems(): Promise<NormalizedItem[]>;
  /** Delete upstream. Returns true when the resource was already gone. */
  deleteItem(externalId: string): Promise<boolean>;
}
