import { describe, expect, it } from "vitest";
import { buildDigest } from "../src/notify/digest.js";
import { isoWeek, phaseLabel, regionsToCountries } from "../src/notify/labels.js";
import { renderHtml, renderText, subjectFor } from "../src/notify/render.js";
import { article, trial } from "./helpers/items.js";

const NOW = new Date("2026-11-02T05:00:00Z");

describe("render", () => {
  const digest = buildDigest(
    [
      {
        item: article("pmid:1", {
          title: "Gene therapy <script>",
          abstract: "Lang tekst ".repeat(100),
        }),
        kind: "new",
        priority: 2,
      },
      {
        item: article("ppr:2", { source: "europepmc", type: "preprint" }),
        kind: "new",
        priority: 2,
      },
      {
        item: trial("NCT1", "RECRUITING"),
        kind: "status_changed",
        priority: 1,
        previousStatus: "NOT_YET_RECRUITING",
      },
    ],
    [],
    NOW,
  );

  it("lager emnelinje med uke og antall", () => {
    expect(subjectFor(digest)).toBe("Retina-radar uke 45: 1 studie, 2 publikasjoner");
  });

  it("tekst: norske etiketter, fremhevede land først, kortet abstract", () => {
    const text = renderText(digest, { highlightCountries: regionsToCountries(["NO"]) });
    expect(text).toContain("KLINISKE STUDIER (1)");
    expect(text).toContain("[ENDRET STATUS: Ikke startet rekruttering → Rekrutterer]");
    expect(text).toContain("Fase 1/2 · Rekrutterer");
    expect(text).toContain("Land: *Norge*, USA");
    expect(text).toContain("[PREPRINT (ikke fagfellevurdert)]");
    expect(text).toContain("ikke medisinsk rådgivning");
    expect(text.indexOf("KLINISKE STUDIER")).toBeLessThan(text.indexOf("PUBLIKASJONER"));
    const abstractLine = text.split("\n").find((l) => l.includes("Lang tekst"))!;
    expect(abstractLine.length).toBeLessThan(400);
  });

  it("HTML escaper innhold fra kildene", () => {
    const html = renderHtml(digest);
    expect(html).toContain("Gene therapy &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("tomt varsel og kildefeil", () => {
    const empty = buildDigest([], [{ queryId: "pm", source: "pubmed", message: "HTTP 500" }], NOW);
    expect(subjectFor(empty)).toBe("Retina-radar uke 45: ingen nye treff (noen kilder feilet)");
    expect(renderText(empty)).toContain("- pm (pubmed): HTTP 500");
  });
});

describe("labels", () => {
  it("fase og uke", () => {
    expect(phaseLabel("EARLY_PHASE1")).toBe("Fase tidlig 1");
    expect(phaseLabel("PHASE3")).toBe("Fase 3");
    expect(isoWeek(new Date("2026-01-01T12:00:00Z"))).toBe(1);
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe(53);
  });
  it("EU utvides til europeiske land", () => {
    const set = regionsToCountries(["EU"]);
    expect(set.has("Germany")).toBe(true);
    expect(set.has("United States")).toBe(false);
  });
});
