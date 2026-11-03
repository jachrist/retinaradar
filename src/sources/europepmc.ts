/**
 * Europe PMC REST /search: artikler og preprints (bioRxiv/medRxiv m.fl., source "PPR").
 *
 * Datofilter (verifisert mot live API 2.11.2026):
 * - FIRST_IDATE (første indekseringsdato) i vinduet fanger artikler som blir tilgjengelige
 *   nå, også de som indekseres uker etter publisering. FIRST_PDATE alene mistet disse.
 * - FIRST_IDATE alene ga mye støy: Gamle artikler (helt tilbake til 1990-tallet) blir
 *   re-indeksert, typisk PMC-fulltekst. Derfor kreves i tillegg FIRST_PDATE innenfor
 *   `publishedWithinDays` før vinduet (og inntil ett år frem, for utgavedatoer i fremtiden).
 *   For oktober 2026 og et bredt IRD-søk: PDATE 88, IDATE 308, kombinert 154 treff.
 */
import type { Query } from "../config/schema.js";
import type { Item } from "../model.js";
import { cleanText, normalizeDoi } from "../pipeline/text.js";
import { createHttpClient, isoDate, sleep, type HttpClient } from "./http.js";
import type { FetchWindow, SourceAdapter } from "./types.js";

export const EUROPEPMC_BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

type EuropePmcQuery = Extract<Query, { source: "europepmc" }>;

export interface EuropePmcOptions {
  http?: HttpClient;
  /** Hvor gammel en artikkel kan være (publiseringsdato) og fortsatt regnes som ny. */
  publishedWithinDays?: number;
  maxResults?: number;
  pageSize?: number;
  delayMs?: number;
}

const DAY_MS = 86_400_000;

export function buildSearchUrl(
  query: string,
  window: FetchWindow,
  opts: { cursorMark: string; pageSize: number; publishedWithinDays?: number },
): string {
  const pubFrom = new Date(window.since.getTime() - (opts.publishedWithinDays ?? 180) * DAY_MS);
  const pubTo = new Date(window.until.getTime() + 365 * DAY_MS);
  const dated =
    `(${query})` +
    ` AND FIRST_IDATE:[${isoDate(window.since)} TO ${isoDate(window.until)}]` +
    ` AND FIRST_PDATE:[${isoDate(pubFrom)} TO ${isoDate(pubTo)}]`;
  const p = new URLSearchParams({
    query: dated,
    format: "json",
    resultType: "core",
    pageSize: String(opts.pageSize),
    cursorMark: opts.cursorMark,
  });
  return `${EUROPEPMC_BASE}?${p}`;
}

export interface EuropePmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  firstPublicationDate?: string;
  pubYear?: string;
  pubTypeList?: { pubType?: string[] };
}

export interface EuropePmcResponse {
  hitCount?: number;
  nextCursorMark?: string;
  resultList?: { result?: EuropePmcResult[] };
}

export function toItem(r: EuropePmcResult): Item | undefined {
  if (!r.id || !r.source) return undefined;
  const isPreprint = r.source === "PPR";
  const doi = normalizeDoi(r.doi);
  // PMID først, slik at samme artikkel fra PubMed og Europe PMC får samme id.
  const id = r.pmid ? `pmid:${r.pmid}` : doi ? `doi:${doi}` : `epmc:${r.source}:${r.id}`;
  const tags = r.pubTypeList?.pubType?.map((t) => cleanText(t)).filter(Boolean) ?? [];
  const abstract = cleanText(r.abstractText);
  return {
    id,
    source: "europepmc",
    type: isPreprint ? "preprint" : "article",
    title: cleanText(r.title) || "(uten tittel)",
    ...(abstract ? { abstract } : {}),
    url: `https://europepmc.org/article/${r.source}/${r.id}`,
    date: r.firstPublicationDate ?? (r.pubYear ? `${r.pubYear}-01-01` : ""),
    ...(tags.length ? { tags } : {}),
    ...(doi ? { doi } : {}),
  };
}

export function createEuropePmcAdapter(opts: EuropePmcOptions = {}): SourceAdapter<EuropePmcQuery> {
  const http = opts.http ?? createHttpClient();
  const maxResults = opts.maxResults ?? 500;
  const pageSize = opts.pageSize ?? 100;
  const delayMs = opts.delayMs ?? 200;
  const publishedWithinDays = opts.publishedWithinDays ?? 180;

  return {
    source: "europepmc",
    async fetchNew(query, window) {
      const items: Item[] = [];
      let cursorMark = "*";
      while (items.length < maxResults) {
        const url = buildSearchUrl(query.query, window, {
          cursorMark,
          pageSize,
          publishedWithinDays,
        });
        const res = await http.getJson<EuropePmcResponse>(url);
        const results = res.resultList?.result ?? [];
        for (const r of results) {
          const item = toItem(r);
          if (item) items.push(item);
        }
        if (results.length < pageSize || !res.nextCursorMark || res.nextCursorMark === cursorMark) {
          break;
        }
        cursorMark = res.nextCursorMark;
        await sleep(delayMs);
      }
      return items.slice(0, maxResults);
    },
  };
}
