/**
 * ClinicalTrials.gov API v2, GET /studies.
 *
 * MERK: Parametere (query.cond, query.term, filter.overallStatus, filter.advanced med
 * AREA[LastUpdatePostDate]RANGE[...], pageToken/nextPageToken) og svarstrukturen
 * (protocolSection.*) er skrevet etter kjennskap til dokumentasjonen
 * (https://clinicaltrials.gov/data-api/api), men ikke verifisert mot live API i dette
 * miljøet. Se docs/PLAN.md, «Åpne punkter».
 */
import type { Query } from "../config/schema.js";
import type { Item } from "../model.js";
import { cleanText } from "../pipeline/text.js";
import { createHttpClient, isoDate, sleep, type HttpClient } from "./http.js";
import type { FetchWindow, SourceAdapter } from "./types.js";

export const CTGOV_BASE = "https://clinicaltrials.gov/api/v2/studies";

type TrialsQuery = Extract<Query, { source: "clinicaltrials" }>;

export interface ClinicalTrialsOptions {
  http?: HttpClient;
  maxResults?: number;
  pageSize?: number;
  delayMs?: number;
}

export function buildStudiesUrl(
  q: TrialsQuery["query"],
  window: FetchWindow,
  opts: { pageSize: number; pageToken?: string },
): string {
  const p = new URLSearchParams({ format: "json", pageSize: String(opts.pageSize) });
  if (q.cond) p.set("query.cond", q.cond);
  if (q.term) p.set("query.term", q.term);
  if (q.overallStatus?.length) p.set("filter.overallStatus", q.overallStatus.join(","));
  p.set(
    "filter.advanced",
    `AREA[LastUpdatePostDate]RANGE[${isoDate(window.since)},${isoDate(window.until)}]`,
  );
  if (opts.pageToken) p.set("pageToken", opts.pageToken);
  return `${CTGOV_BASE}?${p}`;
}

export interface CtgovStudy {
  protocolSection?: {
    identificationModule?: { nctId?: string; briefTitle?: string; officialTitle?: string };
    statusModule?: {
      overallStatus?: string;
      lastUpdatePostDateStruct?: { date?: string };
    };
    sponsorCollaboratorsModule?: { leadSponsor?: { name?: string } };
    descriptionModule?: { briefSummary?: string };
    conditionsModule?: { conditions?: string[] };
    designModule?: { phases?: string[] };
    contactsLocationsModule?: { locations?: { country?: string }[] };
  };
}

export interface CtgovResponse {
  studies?: CtgovStudy[];
  nextPageToken?: string;
}

export function toItem(study: CtgovStudy): Item | undefined {
  const ps = study.protocolSection;
  const nctId = ps?.identificationModule?.nctId;
  if (!nctId) return undefined;

  const countries = [
    ...new Set(
      (ps?.contactsLocationsModule?.locations ?? [])
        .map((l) => l.country)
        .filter((c): c is string => !!c),
    ),
  ];
  const phases = ps?.designModule?.phases?.filter((p) => p !== "NA") ?? [];
  const sponsor = ps?.sponsorCollaboratorsModule?.leadSponsor?.name;
  const status = ps?.statusModule?.overallStatus;
  const abstract = cleanText(ps?.descriptionModule?.briefSummary);
  const tags = ps?.conditionsModule?.conditions ?? [];

  return {
    id: `nct:${nctId}`,
    source: "clinicaltrials",
    type: "trial",
    title:
      cleanText(ps?.identificationModule?.briefTitle ?? ps?.identificationModule?.officialTitle) ||
      nctId,
    ...(abstract ? { abstract } : {}),
    url: `https://clinicaltrials.gov/study/${nctId}`,
    date: ps?.statusModule?.lastUpdatePostDateStruct?.date ?? "",
    ...(tags.length ? { tags } : {}),
    trial: {
      ...(phases.length ? { phase: phases.join("/") } : {}),
      ...(status ? { status } : {}),
      ...(countries.length ? { countries } : {}),
      ...(sponsor ? { sponsor } : {}),
    },
  };
}

export function createClinicalTrialsAdapter(
  opts: ClinicalTrialsOptions = {},
): SourceAdapter<TrialsQuery> {
  const http = opts.http ?? createHttpClient();
  const maxResults = opts.maxResults ?? 500;
  const pageSize = opts.pageSize ?? 100;
  const delayMs = opts.delayMs ?? 200;

  return {
    source: "clinicaltrials",
    async fetchNew(query, window) {
      const items: Item[] = [];
      let pageToken: string | undefined;
      do {
        const url = buildStudiesUrl(query.query, window, { pageSize, pageToken });
        const res = await http.getJson<CtgovResponse>(url);
        for (const s of res.studies ?? []) {
          const item = toItem(s);
          if (item) items.push(item);
        }
        pageToken = res.nextPageToken;
        if (pageToken) await sleep(delayMs);
      } while (pageToken && items.length < maxResults);
      return items.slice(0, maxResults);
    },
  };
}
