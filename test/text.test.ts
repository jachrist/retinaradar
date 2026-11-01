import { describe, expect, it } from "vitest";
import { cleanText, normalizeDoi, truncate } from "../src/pipeline/text.js";
import { toKeys, fromKeys } from "../src/storage/keys.js";
import { redact } from "../src/sources/http.js";

describe("cleanText", () => {
  it("fjerner tagger og dekoder entiteter", () => {
    expect(cleanText("<i>GUCY2D</i>-related &amp; <sup>2</sup> &#946;-cells\n  ok")).toBe(
      "GUCY2D-related & 2 β-cells ok",
    );
  });
  it("tåler tom input", () => expect(cleanText(undefined)).toBe(""));
});

describe("truncate", () => {
  it("kutter på ordgrense", () => {
    expect(truncate("en to tre fire fem", 10)).toBe("en to tre …");
    expect(truncate("kort", 10)).toBe("kort");
  });
});

describe("normalizeDoi", () => {
  it("normaliserer prefiks og store bokstaver", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC.1")).toBe("10.1000/abc.1");
    expect(normalizeDoi("ikke-doi")).toBeUndefined();
  });
});

describe("Table Storage-nøkler", () => {
  it("koder DOI-er uten ulovlige tegn og kan dekodes", () => {
    const id = "doi:10.1101/2026.01.01.123456(v2)#x?";
    const k = toKeys(id);
    expect(k.partitionKey).toBe("doi");
    expect(k.rowKey).not.toMatch(/[/\\#?]/);
    expect(fromKeys(k.partitionKey, k.rowKey)).toBe(id);
  });
  it("avviser id uten navnerom", () => expect(() => toKeys("12345")).toThrow());
});

describe("redact", () => {
  it("skjuler api_key", () => {
    expect(redact("https://x/esearch.fcgi?db=pubmed&api_key=SECRET&x=1")).toBe(
      "https://x/esearch.fcgi?db=pubmed&api_key=***&x=1",
    );
  });
});

describe("createHttpClient", () => {
  it("gir HttpError med status, uten query (og dermed uten api_key)", async () => {
    const { createHttpClient, HttpError } = await import("../src/sources/http.js");
    const http = createHttpClient(async () => new Response("nope", { status: 429 }));
    const err = await http.getText("https://x.org/a?api_key=S").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as Error).message).toBe("HTTP 429 fra x.org/a: nope");
  });

  it("gir nettverksfeil med vertsnavn og årsak", async () => {
    const { createHttpClient } = await import("../src/sources/http.js");
    const http = createHttpClient(async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    });
    await expect(http.getJson("https://example.org/x")).rejects.toThrow(
      "Nettverksfeil mot example.org: ECONNREFUSED",
    );
  });
});
