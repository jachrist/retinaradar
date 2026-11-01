import type { Item } from "../../src/model.js";

export function article(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    source: "pubmed",
    type: "article",
    title: `Artikkel ${id}`,
    url: `https://example.org/${id}`,
    date: "2026-10-20",
    ...overrides,
  };
}

export function trial(nct: string, status: string, overrides: Partial<Item> = {}): Item {
  return {
    id: `nct:${nct}`,
    source: "clinicaltrials",
    type: "trial",
    title: `Studie ${nct}`,
    url: `https://clinicaltrials.gov/study/${nct}`,
    date: "2026-10-21",
    trial: { status, phase: "PHASE1/PHASE2", countries: ["United States", "Norway"] },
    ...overrides,
  };
}
