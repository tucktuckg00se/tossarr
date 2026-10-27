import type { MediaClient, NormalizedItem } from '../types.js';
import type { HttpClient } from './http.js';

interface RadarrMovieRaw {
  id: number;
  title: string;
  overview?: string | null;
  year?: number | null;
  poster?: string | null;
  images?: Array<{ coverType?: string; url?: string }>;
  hasFile?: boolean;
  imdbId?: number | null;
  runtime?: number | null;
  genres?: string[];
}

export function createRadarrClient(http: HttpClient): MediaClient {
  return {
    kind: 'radarr',
    async listItems(): Promise<NormalizedItem[]> {
      const movies = await http.getJson<RadarrMovieRaw[]>('/api/v3/movie', { hasFile: 'true' });
      return movies.map((m) => ({
        externalId: String(m.id),
        type: 'movie' as const,
        title: m.title,
        year: m.year ?? null,
        posterPath: m.images?.find((i) => i.coverType === 'poster')?.url ?? m.poster ?? null,
        overview: m.overview ?? '',
        meta: { imdbId: m.imdbId ?? null, runtime: m.runtime ?? null, genres: m.genres ?? [] },
      }));
    },
    async deleteItem(externalId: string): Promise<boolean> {
      return http.deleteResource(`/api/v3/movie/${externalId}`, {
        removeFromDb: 'true',
        deleteFiles: 'true',
        addImportExclusion: 'false',
      });
    },
  };
}
