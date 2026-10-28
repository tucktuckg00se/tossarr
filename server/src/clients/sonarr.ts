import type { MediaClient, NormalizedItem } from '../types.js';
import type { HttpClient } from './http.js';

interface SonarrSeriesRaw {
  id: number;
  title: string;
  overview?: string | null;
  year?: number | null;
  /** Older Sonarr builds return a top-level poster path; current ones leave it null. */
  poster?: string | null;
  /** Current Sonarr returns image descriptors, not plain paths — and the first entry is often a banner. */
  images?: Array<{ coverType?: string; url?: string }>;
  network?: string | null;
  runtime?: number | null;
  genres?: string[];
}

export function createSonarrClient(http: HttpClient): MediaClient {
  return {
    kind: 'sonarr',
    async listItems(): Promise<NormalizedItem[]> {
      const series = await http.getJson<SonarrSeriesRaw[]>('/api/v3/series');
      return series.map((s) => ({
        externalId: String(s.id),
        type: 'show' as const,
        title: s.title,
        year: s.year ?? null,
        // Sonarr v4+ gates /MediaCover static files behind a browser session,
        // but the API-key-authenticated mediacover endpoint serves the same
        // local cover — so point posters there instead of at images[].url.
        posterPath: s.images?.some((i) => i.coverType === 'poster') || s.poster
          ? `/api/v3/mediacover/${s.id}/poster-500.jpg`
          : null,
        overview: s.overview ?? '',
        meta: { network: s.network ?? null, runtime: s.runtime ?? null, genres: s.genres ?? [] },
      }));
    },
    async deleteItem(externalId: string): Promise<boolean> {
      return http.deleteResource(`/api/v3/series/${externalId}`, {
        removeFromDb: 'true',
        deleteFiles: 'true',
        addImportExclusion: 'false',
      });
    },
  };
}
