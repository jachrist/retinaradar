import type { FetchFn } from "./types.js";

export const USER_AGENT = "retinaradar/0.1 (personlig overvåkingsverktøy)";

export class HttpError extends Error {
  override name = "HttpError";
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} fra ${redact(url)}: ${body.slice(0, 200)}`);
  }
}

/** Fjerner api_key fra URL-er før de havner i logger og feilmeldinger. */
export function redact(url: string): string {
  return url.replace(/([?&]api_key=)[^&]+/, "$1***");
}

export interface HttpClient {
  getText(url: string, init?: { accept?: string }): Promise<string>;
  getJson<T = unknown>(url: string): Promise<T>;
}

export function createHttpClient(fetchFn: FetchFn = fetch, timeoutMs = 30_000): HttpClient {
  async function getText(url: string, init?: { accept?: string }): Promise<string> {
    let res: Response;
    try {
      res = await fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, Accept: init?.accept ?? "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Node sin fetch sier bare «fetch failed»; den egentlige årsaken ligger i cause.
      const cause = (err as { cause?: { message?: string; code?: string } }).cause;
      const detail = cause?.code ?? cause?.message ?? (err as Error).message;
      throw new Error(`Nettverksfeil mot ${new URL(url).host}: ${detail}`, { cause: err });
    }
    const body = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, body);
    return body;
  }
  return {
    getText,
    async getJson<T>(url: string): Promise<T> {
      return JSON.parse(await getText(url, { accept: "application/json" })) as T;
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** YYYY-MM-DD i UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
