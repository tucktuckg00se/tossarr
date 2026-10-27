import { errorMessage } from '../util.js';

/** Error raised when a source is unreachable or returns an unexpected response. */
export class SourceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SourceError';
    if (status !== undefined) this.status = status;
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

type Query = Record<string, string | number | boolean>;

/** Minimal authenticated HTTP client for Sonarr/Radarr v3 APIs. */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: HttpClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(opts.baseUrl);
    } catch {
      throw new SourceError(`Invalid source URL: ${opts.baseUrl}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new SourceError(`Source URL must be http(s): ${opts.baseUrl}`);
    }
    this.baseUrl = parsed.toString().replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private buildUrl(path: string, query?: Query): string {
    const u = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private headers(): Record<string, string> {
    return { 'X-Api-Key': this.apiKey, Accept: 'application/json' };
  }

  async getJson<T>(path: string, query?: Query): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.buildUrl(path, query), {
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SourceError(`Cannot reach source at ${this.baseUrl}: ${errorMessage(err)}`);
    }
    if (!res.ok) {
      throw new SourceError(`Source responded HTTP ${res.status} to GET ${path}`, res.status);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new SourceError(`Source returned invalid JSON for GET ${path}`);
    }
  }

  /**
   * DELETE treating both 2xx and 404 as success (already gone upstream).
   * Returns true when the resource was already absent.
   */
  async deleteResource(path: string, query?: Query): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch(this.buildUrl(path, query), {
        method: 'DELETE',
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new SourceError(`Cannot reach source at ${this.baseUrl}: ${errorMessage(err)}`);
    }
    if (res.status === 404) return true;
    if (!res.ok) {
      throw new SourceError(`Source responded HTTP ${res.status} to DELETE ${path}`, res.status);
    }
    return false;
  }
}
