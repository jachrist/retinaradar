/**
 * PubMed via NCBI E-utilities: esearch (finn PMID-er i datovindu) + efetch (XML med abstract).
 *
 * MERK: Parametere er skrevet etter kjennskap til E-utilities-dokumentasjonen
 * (https://www.ncbi.nlm.nih.gov/books/NBK25499/), men ikke verifisert mot live API i
 * dette miljøet. Se docs/PLAN.md, «Åpne punkter».
 */
import { XMLParser } from "fast-xml-parser";
import type { Query } from "../config/schema.js";
import type { Item } from "../model.js";
import { cleanText, normalizeDoi } from "../pipeline/text.js";
import { createHttpClient, sleep, type HttpClient } from "./http.js";
import type { FetchWindow, SourceAdapter } from "./types.js";

export const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

type PubmedQuery = Extract<Query, { source: "pubmed" }>;

export interface PubmedOptions {
  http?: HttpClient;
  apiKey?: string;
  email?: string;
  /** Maks antall PMID-er per spørring og kjøring. */
  maxResults?: number;
  /** Antall PMID-er per efetch-kall. */
  batchSize?: number;
  /** Pause mellom kall. NCBI tillater 3/s uten nøkkel og 10/s med nøkkel. */
  delayMs?: number;
}

/** PubMed bruker datoformat YYYY/MM/DD. */
function eutilsDate(d: Date): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "/");
}

export function buildEsearchUrl(
  term: string,
  window: FetchWindow,
  opts: { apiKey?: string; email?: string; retstart?: number; retmax: number },
): string {
  const p = new URLSearchParams({
    db: "pubmed",
    term,
    datetype: "edat",
    mindate: eutilsDate(window.since),
    maxdate: eutilsDate(window.until),
    retmode: "json",
    retmax: String(opts.retmax),
    retstart: String(opts.retstart ?? 0),
    sort: "pub_date",
    tool: "retinaradar",
  });
  if (opts.email) p.set("email", opts.email);
  if (opts.apiKey) p.set("api_key", opts.apiKey);
  return `${EUTILS_BASE}/esearch.fcgi?${p}`;
}

export function buildEfetchUrl(pmids: string[], opts: { apiKey?: string; email?: string }): string {
  const p = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
    tool: "retinaradar",
  });
  if (opts.email) p.set("email", opts.email);
  if (opts.apiKey) p.set("api_key", opts.apiKey);
  return `${EUTILS_BASE}/efetch.fcgi?${p}`;
}

interface EsearchResponse {
  esearchresult?: { count?: string; idlist?: string[]; ERROR?: string };
}

export function parseEsearch(json: EsearchResponse): { count: number; ids: string[] } {
  const r = json.esearchresult;
  if (!r) throw new Error("Uventet esearch-svar: mangler esearchresult");
  if (r.ERROR) throw new Error(`esearch-feil: ${r.ERROR}`);
  return { count: Number(r.count ?? 0), ids: r.idlist ?? [] };
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  // Behold rå innhold (med <i>, <sup> osv.) i disse; vaskes med cleanText.
  stopNodes: ["*.ArticleTitle", "*.AbstractText"],
  isArray: (name) =>
    ["PubmedArticle", "AbstractText", "ArticleId", "PubMedPubDate", "ArticleDate"].includes(name),
});

/* eslint-disable @typescript-eslint/no-explicit-any -- XML-strukturen er dynamisk */
function textOf(node: any): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function pad(n: string | undefined, fallback = "01"): string {
  if (!n) return fallback;
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const m = months[n.slice(0, 3).toLowerCase()];
  return m ?? n.padStart(2, "0");
}

function dateFrom(node: any): string | undefined {
  const year = textOf(node?.Year);
  if (!/^\d{4}$/.test(year)) return undefined;
  return `${year}-${pad(textOf(node?.Month))}-${pad(textOf(node?.Day))}`;
}

export function parseEfetchXml(xml: string): Item[] {
  const doc = xmlParser.parse(xml);
  const articles: any[] = doc?.PubmedArticleSet?.PubmedArticle ?? [];
  const items: Item[] = [];

  for (const a of articles) {
    const citation = a.MedlineCitation;
    const pmid = textOf(citation?.PMID);
    if (!pmid) continue;
    const article = citation?.Article ?? {};

    const abstractParts: any[] = article.Abstract?.AbstractText ?? [];
    const abstract = abstractParts
      .map((part) => {
        const label = typeof part === "object" ? part["@_Label"] : undefined;
        const text = cleanText(textOf(part));
        return label && text ? `${label}: ${text}` : text;
      })
      .filter(Boolean)
      .join(" ");

    const ids: any[] = a.PubmedData?.ArticleIdList?.ArticleId ?? [];
    const doi = normalizeDoi(textOf(ids.find((i) => i?.["@_IdType"] === "doi")));

    const history: any[] = a.PubmedData?.History?.PubMedPubDate ?? [];
    const entrez = history.find((h) => h?.["@_PubStatus"] === "entrez");
    const date =
      dateFrom(entrez) ??
      dateFrom(article.ArticleDate?.[0]) ??
      dateFrom(article.Journal?.JournalIssue?.PubDate) ??
      "";

    const pubTypes: any[] = [article.PublicationTypeList?.PublicationType ?? []].flat();
    const tags = pubTypes.map((t) => cleanText(textOf(t))).filter(Boolean);

    items.push({
      id: `pmid:${pmid}`,
      source: "pubmed",
      type: "article",
      title: cleanText(textOf(article.ArticleTitle)) || "(uten tittel)",
      ...(abstract ? { abstract } : {}),
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      date,
      ...(tags.length ? { tags } : {}),
      ...(doi ? { doi } : {}),
    });
  }
  return items;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function createPubmedAdapter(opts: PubmedOptions = {}): SourceAdapter<PubmedQuery> {
  const http = opts.http ?? createHttpClient();
  const maxResults = opts.maxResults ?? 500;
  const batchSize = opts.batchSize ?? 200;
  const delayMs = opts.delayMs ?? (opts.apiKey ? 120 : 400);
  const auth = { apiKey: opts.apiKey, email: opts.email };

  return {
    source: "pubmed",
    async fetchNew(query, window) {
      const ids: string[] = [];
      let total = Infinity;
      while (ids.length < Math.min(total, maxResults)) {
        const retmax = Math.min(batchSize, maxResults - ids.length);
        const url = buildEsearchUrl(query.query, window, { ...auth, retstart: ids.length, retmax });
        const page = parseEsearch(await http.getJson<EsearchResponse>(url));
        total = page.count;
        if (page.ids.length === 0) break;
        ids.push(...page.ids);
        await sleep(delayMs);
      }

      const items: Item[] = [];
      for (let i = 0; i < ids.length; i += batchSize) {
        const xml = await http.getText(buildEfetchUrl(ids.slice(i, i + batchSize), auth), {
          accept: "application/xml",
        });
        items.push(...parseEfetchXml(xml));
        await sleep(delayMs);
      }
      return items;
    },
  };
}
