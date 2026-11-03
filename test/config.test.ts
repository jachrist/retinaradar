import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  expandQueries,
  loadConfig,
  parseProfile,
  parseQueries,
} from "../src/config/load.js";
import { loadSettings } from "../src/config/settings.js";

describe("config/queries.json i repoet", () => {
  it("er gyldig", async () => {
    const cfg = await loadConfig(path.resolve("config"), { PROFILE_JSON: '{"genes":[]}' });
    expect(cfg.queries.length).toBeGreaterThan(0);
  });
});

describe("parseQueries", () => {
  it("avviser ukjent kilde og manglende query", () => {
    expect(() => parseQueries({ queries: [{ id: "x", source: "google", query: "a" }] })).toThrow(
      ConfigError,
    );
    expect(() =>
      parseQueries({ queries: [{ id: "x", source: "clinicaltrials", query: {} }] }),
    ).toThrow(/cond\/term/);
  });

  it("setter standardverdier", () => {
    const [q] = parseQueries({ queries: [{ id: "a", source: "pubmed", query: "x" }] });
    expect(q).toMatchObject({ priority: 3, enabled: true });
  });
});

describe("parseProfile", () => {
  it("avviser gensymboler med spesialtegn (hindrer injeksjon i søk)", () => {
    expect(() => parseProfile({ genes: ['GUCY2D" OR x'] })).toThrow(ConfigError);
  });
});

describe("expandQueries", () => {
  const queries = parseQueries({
    queries: [
      { id: "generic", source: "pubmed", query: "retina" },
      { id: "gene", source: "pubmed", query: "{GENE}[tiab] AND retina*" },
      { id: "trial-gene", source: "clinicaltrials", query: { term: "{GENE}" } },
      { id: "off", source: "pubmed", query: "x", enabled: false },
    ],
  });

  it("hopper over gen-spørringer uten profil", () => {
    const r = expandQueries(queries, undefined);
    expect(r.queries.map((q) => q.id)).toEqual(["generic"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["gene", "trial-gene", "off"]);
  });

  it("lager én spørring per gen", () => {
    const r = expandQueries(queries, parseProfile({ genes: ["GUCY2D", "CRX"] }));
    expect(r.queries.map((q) => q.id)).toEqual([
      "generic",
      "gene-gucy2d",
      "gene-crx",
      "trial-gene-gucy2d",
      "trial-gene-crx",
    ]);
    expect(r.queries[1]).toMatchObject({ query: "GUCY2D[tiab] AND retina*" });
    expect(r.queries[3]).toMatchObject({ query: { term: "GUCY2D" } });
  });
});

describe("loadSettings", () => {
  it("bruker standardverdier", () => {
    const s = loadSettings({});
    expect(s).toMatchObject({ overlapDays: 14, firstRunDays: 30, sendEmptyDigest: true });
    expect(s.smtp).toBeUndefined();
  });

  it("leser SMTP og flere mottakere", () => {
    const s = loadSettings({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USER: "a@gmail.com",
      SMTP_PASSWORD: "pw",
      MAIL_TO: "a@gmail.com; b@example.org",
    });
    expect(s.smtp).toMatchObject({ port: 465, from: "a@gmail.com" });
    expect(s.smtp?.to).toEqual(["a@gmail.com", "b@example.org"]);
  });

  it("feiler tydelig ved delvis SMTP-oppsett", () => {
    expect(() => loadSettings({ SMTP_HOST: "smtp.gmail.com" })).toThrow(/SMTP_PASSWORD/);
  });
});
