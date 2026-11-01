/**
 * Europe PMC REST /search: artikler og preprints (bioRxiv/medRxiv m.fl., source "PPR").
 *
 * MERK: Parametere og feltnavn (resultType=core, cursorMark, FIRST_PDATE-filteret og
 * resultatfeltene) er skrevet etter kjennskap til dokumentasjonen
 * (https://europepmc.org/RestfulWebService), men ikke verifisert mot live API i dette
 * miljøet. Se docs/PLAN.md, «Åpne punkter».
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
  maxResults?: number;
  pageSize?: number;
  delayMs?: number;
}

export function buildSearchUrl(
  query: string,
  window: FetchWindow,
  opts: { cursorMark: string; pageSize: number },
): string {
  const dated = `(${query}) AND FIRST_PDATE:[${isoDate(window.since)} TO ${isoDate(window.until)}]`;
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

  return {
    source: "europepmc",
    async fetchNew(query, window) {
      const items: Item[] = [];
      let cursorMark = "*";
      while (items.length < maxResults) {
        const url = buildSearchUrl(query.query, window, { cursorMark, pageSize });
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
