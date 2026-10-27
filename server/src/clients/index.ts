import type { MediaClient, SourceKind } from '../types.js';
import { HttpClient } from './http.js';
import { createRadarrClient } from './radarr.js';
import { createSonarrClient } from './sonarr.js';

export { SourceError } from './http.js';

/** Build a client for the given source kind/credentials. */
export function createClient(opts: { kind: SourceKind; url: string; apiKey: string }): MediaClient {
  const http = new HttpClient({ baseUrl: opts.url, apiKey: opts.apiKey });
  return opts.kind === 'sonarr' ? createSonarrClient(http) : createRadarrClient(http);
}
