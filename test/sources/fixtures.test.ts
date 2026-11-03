/**
 * Parsertester mot ekte API-svar lagret med `npm run fixtures`.
 * Fixtures inneholder kun offentlige data (generelle sykdomssøk, ingen profil).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  toItem as ctToItem,
  unescapeMarkdown,
  type CtgovResponse,
} from "../../src/sources/clinicaltrials.js";
import { toItem as epToItem, type EuropePmcResponse } from "../../src/sources/europepmc.js";
import { parseEfetchXml, parseEsearch } from "../../src/sources/pubmed.js";

const fixture = (name: string) => readFileSync(`test/fixtures/${name}`, "utf8");

describe("PubMed (ekte svar)", () => {
  it("esearch gir antall og PMID-liste", () => {
    const r = parseEsearch(JSON.parse(fixture("pubmed-esearch.json")));
    expect(r.count).toBeGreaterThan(0);
    expect(r.ids.length).toBeGreaterThan(0);
    r.ids.forEach((id) => expect(id).toMatch(/^\d+$/));
  });

  it("efetch-XML gir én komplett Item per PMID", () => {
    const { ids } = parseEsearch(JSON.parse(fixture("pubmed-esearch.json")));
    const items = parseEfetchXml(fixture("pubmed-efetch.xml"));
    expect(items.map((i) => i.id)).toEqual(ids.map((id) => `pmid:${id}`));
    for (const i of items) {
      expect(i).toMatchObject({ source: "pubmed", type: "article" });
      expect(i.url).toBe(`https://pubmed.ncbi.nlm.nih.gov/${i.id.slice(5)}/`);
      expect(i.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.title.length).toBeGreaterThan(10);
      expect(i.title).not.toMatch(/[<>]/);
      expect(i.doi).toMatch(/^10\./);
    }
  });

  it("strukturerte abstracts beholder seksjonsnavn", () => {
    const items = parseEfetchXml(fixture("pubmed-efetch.xml"));
    expect(items.some((i) => /^(BACKGROUND|PURPOSE): /.test(i.abstract ?? ""))).toBe(true);
    items.forEach((i) => expect(i.abstract ?? "").not.toMatch(/<\/?[a-z]+>/i));
  });

  it("henter inline-markup ut av tittel og abstract", () => {
    const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation>
      <PMID Version="1">1</PMID><Article><ArticleTitle>Dual <i>AAV</i> for <i>GUCY2D</i>-Stargardt</ArticleTitle>
      <Abstract><AbstractText>CO<sub>2</sub> &amp; more</AbstractText></Abstract></Article>
      </MedlineCitation><PubmedData><History><PubMedPubDate PubStatus="entrez"><Year>2026</Year><Month>3</Month><Day>7</Day></PubMedPubDate></History></PubmedData>
      </PubmedArticle></PubmedArticleSet>`;
    const [i] = parseEfetchXml(xml);
    expect(i).toMatchObject({
      title: "Dual AAV for GUCY2D-Stargardt",
      abstract: "CO2 & more",
      date: "2026-03-07",
    });
  });
});

describe("ClinicalTrials.gov (ekte svar)", () => {
  const res = JSON.parse(fixture("clinicaltrials-studies.json")) as CtgovResponse;
  const items = (res.studies ?? []).map(ctToItem);

  it("har studier og token for neste side", () => {
    expect(items.length).toBeGreaterThan(0);
    expect(res.nextPageToken).toBeTruthy();
  });

  it("mapper studiefelter", () => {
    for (const i of items) {
      expect(i?.id).toMatch(/^nct:NCT\d{8}$/);
      expect(i?.url).toBe(`https://clinicaltrials.gov/study/${i?.id.slice(4)}`);
      expect(i?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i?.trial?.status).toMatch(/^[A-Z_]+$/);
      expect(i?.trial?.sponsor).toBeTruthy();
      expect(i?.abstract?.length).toBeGreaterThan(20);
    }
    // Fase «NA» filtreres bort; flerfase slås sammen.
    expect(items.some((i) => i?.trial?.phase === "PHASE1/PHASE2")).toBe(true);
    expect(items.every((i) => !i?.trial?.phase?.includes("NA"))).toBe(true);
    // Land er unike.
    for (const i of items) {
      const c = i?.trial?.countries ?? [];
      expect(new Set(c).size).toBe(c.length);
    }
  });
});

describe("Europe PMC (ekte svar)", () => {
  const load = (name: string) =>
    ((JSON.parse(fixture(name)) as EuropePmcResponse).resultList?.result ?? []).map(epToItem);

  it("artikler: PMID-id, ren tekst og dato", () => {
    const items = load("europepmc-search.json");
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i?.id).toMatch(/^(pmid|doi|epmc):/);
      expect(i?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Europe PMC sender tagger både rå og HTML-kodet; ingen av delene skal slippe gjennom.
      expect(i?.title).not.toMatch(/<|&lt;/);
      expect(i?.abstract ?? "").not.toMatch(/<\/?[a-z]+[ >]|&lt;/i);
    }
    expect(items.some((i) => i?.title.includes("UBAP1L gene"))).toBe(true);
    expect(items.filter((i) => i?.id.startsWith("pmid:")).length).toBeGreaterThan(0);
  });

  it("preprints: type preprint, DOI-id og lenke til Europe PMC", () => {
    const items = load("europepmc-preprints.json");
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i?.type).toBe("preprint");
      expect(i?.url).toMatch(/^https:\/\/europepmc\.org\/article\/PPR\//);
      expect(i?.title).not.toMatch(/<|&lt;/);
    }
  });
});

describe("unescapeMarkdown", () => {
  it("fjerner Markdown-escaping fra ClinicalTrials.gov", () => {
    expect(unescapeMarkdown("Background:\n\n\\- Plaquenil \\(HCQ\\) 5\\.0")).toBe(
      "Background:\n\n- Plaquenil (HCQ) 5.0",
    );
  });
});
