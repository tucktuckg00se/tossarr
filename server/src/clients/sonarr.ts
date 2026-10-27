import type { MediaClient, NormalizedItem } from '../types.js';
import type { HttpClient } from './http.js';

interface SonarrSeriesRaw {
  id: number;
  title: string;
  overview?: string | null;
  year?: number | null;
  poster?: string | null;
  images?: string[];
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
        posterPath: s.poster ?? (Array.isArray(s.images) ? s.images[0] : undefined) ?? null,
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
