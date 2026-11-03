/**
 * Tester at adapterne bygger forespørslene slik vi har tenkt. Dette verifiserer ikke at
 * API-ene godtar parameterne – det krever kjøring mot live API (se docs/PLAN.md).
 */
import { describe, expect, it } from "vitest";
import { buildStudiesUrl } from "../../src/sources/clinicaltrials.js";
import { buildSearchUrl } from "../../src/sources/europepmc.js";
import { buildEfetchUrl, buildEsearchUrl } from "../../src/sources/pubmed.js";

const window = { since: new Date("2026-10-01T05:00:00Z"), until: new Date("2026-10-31T05:00:00Z") };

describe("PubMed", () => {
  it("esearch med edat-vindu og JSON", () => {
    const u = new URL(
      buildEsearchUrl("GUCY2D[tiab]", window, { retmax: 200, apiKey: "k", email: "a@b.c" }),
    );
    expect(u.pathname).toBe("/entrez/eutils/esearch.fcgi");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      db: "pubmed",
      term: "GUCY2D[tiab]",
      datetype: "edat",
      mindate: "2026/10/01",
      maxdate: "2026/10/31",
      retmode: "json",
      retmax: "200",
      retstart: "0",
      api_key: "k",
      email: "a@b.c",
      tool: "retinaradar",
    });
  });

  it("efetch med kommaseparerte PMID-er som XML", () => {
    const u = new URL(buildEfetchUrl(["1", "2"], {}));
    expect(u.searchParams.get("id")).toBe("1,2");
    expect(u.searchParams.get("retmode")).toBe("xml");
    expect(u.searchParams.has("api_key")).toBe(false);
  });
});

describe("Europe PMC", () => {
  it("filtrerer på indekseringsdato i vinduet og publiseringsdato siste 180 dager", () => {
    const u = new URL(
      buildSearchUrl('"cone-rod dystrophy"', window, { cursorMark: "*", pageSize: 100 }),
    );
    expect(u.searchParams.get("query")).toBe(
      '("cone-rod dystrophy") AND FIRST_IDATE:[2026-10-01 TO 2026-10-31]' +
        " AND FIRST_PDATE:[2026-04-04 TO 2027-10-31]",
    );
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      format: "json",
      resultType: "core",
      pageSize: "100",
      cursorMark: "*",
    });
  });
});

describe("ClinicalTrials.gov", () => {
  it("bruker cond/term, statusfilter og LastUpdatePostDate-vindu", () => {
    const u = new URL(
      buildStudiesUrl(
        {
          cond: "cone-rod dystrophy",
          term: "gene therapy",
          overallStatus: ["RECRUITING", "NOT_YET_RECRUITING"],
        },
        window,
        { pageSize: 100, pageToken: "abc" },
      ),
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      format: "json",
      pageSize: "100",
      "query.cond": "cone-rod dystrophy",
      "query.term": "gene therapy",
      "filter.overallStatus": "RECRUITING,NOT_YET_RECRUITING",
      "filter.advanced": "AREA[LastUpdatePostDate]RANGE[2026-10-01,2026-10-31]",
      pageToken: "abc",
    });
  });
});
