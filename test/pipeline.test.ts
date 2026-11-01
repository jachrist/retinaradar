import { describe, expect, it } from "vitest";
import type { Query } from "../src/config/schema.js";
import type { Item } from "../src/model.js";
import type { Digest } from "../src/notify/digest.js";
import type { Notifier } from "../src/notify/notifier.js";
import { mergeHits } from "../src/pipeline/dedupe.js";
import { computeWindow, runPipeline, type RunOptions } from "../src/pipeline/run.js";
import type { AdapterRegistry } from "../src/sources/index.js";
import { MemorySeenStore } from "../src/storage/seenStore.js";
import { article, trial } from "./helpers/items.js";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const NOW = new Date("2026-11-02T05:00:00Z");

class CapturingNotifier implements Notifier {
  sent: Digest[] = [];
  fail = false;
  async send(d: Digest) {
    if (this.fail) throw new Error("SMTP nede");
    this.sent.push(d);
  }
}

/** Adaptere som returnerer faste lister per kilde (kan endres mellom kjøringer). */
function fakeAdapters(data: {
  pubmed?: Item[];
  europepmc?: Item[];
  clinicaltrials?: Item[] | Error;
}) {
  const adapters: AdapterRegistry = {
    pubmed: { source: "pubmed", fetchNew: async () => data.pubmed ?? [] },
    europepmc: { source: "europepmc", fetchNew: async () => data.europepmc ?? [] },
    clinicaltrials: {
      source: "clinicaltrials",
      fetchNew: async () => {
        if (data.clinicaltrials instanceof Error) throw data.clinicaltrials;
        return data.clinicaltrials ?? [];
      },
    },
  };
  return adapters;
}

const queries: Query[] = [
  { id: "pm", source: "pubmed", query: "x", priority: 1, enabled: true },
  { id: "ep", source: "europepmc", query: "x", priority: 2, enabled: true },
  { id: "ct", source: "clinicaltrials", query: { cond: "x" }, priority: 1, enabled: true },
];

function options(over: Partial<RunOptions>): RunOptions {
  return {
    queries,
    adapters: fakeAdapters({}),
    store: new MemorySeenStore(),
    notifier: new CapturingNotifier(),
    log: silent,
    now: NOW,
    overlapDays: 14,
    firstRunDays: 30,
    maxLookbackDays: 90,
    sendEmptyDigest: true,
    ...over,
  };
}

describe("computeWindow", () => {
  const o = { overlapDays: 14, firstRunDays: 30, maxLookbackDays: 90 };
  it("første kjøring: firstRunDays bakover", () => {
    expect(computeWindow(NOW, undefined, o).since.toISOString()).toBe("2026-10-03T05:00:00.000Z");
  });
  it("senere: forrige kjøring minus overlapp", () => {
    const last = new Date("2026-10-26T05:00:00Z");
    expect(computeWindow(NOW, last, o).since.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });
  it("begrenses av maxLookbackDays", () => {
    const last = new Date("2025-01-01T00:00:00Z");
    expect(computeWindow(NOW, last, o).since.toISOString()).toBe("2026-08-04T05:00:00.000Z");
  });
});

describe("mergeHits", () => {
  it("foretrekker PubMed, men fyller inn abstract fra Europe PMC", () => {
    const merged = mergeHits([
      {
        item: article("pmid:1", { source: "europepmc", abstract: "fra EPMC", doi: "10.1/x" }),
        priority: 2,
      },
      { item: article("pmid:1", { title: "PubMed-tittel" }), priority: 1 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      priority: 1,
      item: expect.objectContaining({
        source: "pubmed",
        title: "PubMed-tittel",
        abstract: "fra EPMC",
        doi: "10.1/x",
      }),
    });
  });
});

describe("runPipeline", () => {
  it("er idempotent: andre kjøring gir ingen nye treff", async () => {
    const store = new MemorySeenStore();
    const notifier = new CapturingNotifier();
    const adapters = fakeAdapters({
      pubmed: [article("pmid:1"), article("pmid:2")],
      europepmc: [
        article("pmid:2", { source: "europepmc" }),
        article("ppr:3", { source: "europepmc", type: "preprint" }),
      ],
      clinicaltrials: [trial("NCT1", "RECRUITING")],
    });

    const first = await runPipeline(options({ store, notifier, adapters }));
    expect(first.findings).toBe(4);
    expect(notifier.sent[0]!.publications).toHaveLength(3);
    expect(notifier.sent[0]!.trials).toHaveLength(1);
    expect(store.lastRun).toEqual(NOW);

    const second = await runPipeline(
      options({ store, notifier, adapters, now: new Date("2026-11-09T05:00:00Z") }),
    );
    expect(second.findings).toBe(0);
    expect(second.window.since).toBe("2026-10-19T05:00:00.000Z");
  });

  it("varsler statusendring for kjent studie", async () => {
    const store = new MemorySeenStore();
    await store.markSeen([
      {
        id: "nct:NCT1",
        source: "clinicaltrials",
        firstSeen: "2026-01-01T00:00:00Z",
        status: "NOT_YET_RECRUITING",
      },
    ]);
    const notifier = new CapturingNotifier();
    const r = await runPipeline(
      options({
        store,
        notifier,
        adapters: fakeAdapters({ clinicaltrials: [trial("NCT1", "RECRUITING")] }),
      }),
    );
    expect(r.findings).toBe(1);
    expect(notifier.sent[0]!.trials[0]).toMatchObject({
      kind: "status_changed",
      previousStatus: "NOT_YET_RECRUITING",
    });
    expect(store.records.get("nct:NCT1")).toMatchObject({
      status: "RECRUITING",
      firstSeen: "2026-01-01T00:00:00Z",
    });
  });

  it("en kilde som feiler stopper ikke de andre, og siste kjøring flyttes ikke", async () => {
    const store = new MemorySeenStore();
    const notifier = new CapturingNotifier();
    const r = await runPipeline(
      options({
        store,
        notifier,
        adapters: fakeAdapters({
          pubmed: [article("pmid:1")],
          clinicaltrials: new Error("HTTP 503"),
        }),
      }),
    );
    expect(r.findings).toBe(1);
    expect(r.failures).toEqual([{ queryId: "ct", source: "clinicaltrials", message: "HTTP 503" }]);
    expect(notifier.sent[0]!.failures).toHaveLength(1);
    expect(store.records.has("pmid:1")).toBe(true);
    expect(store.lastRun).toBeUndefined();
  });

  it("markerer ikke som sett hvis sending feiler", async () => {
    const store = new MemorySeenStore();
    const notifier = new CapturingNotifier();
    notifier.fail = true;
    await expect(
      runPipeline(
        options({ store, notifier, adapters: fakeAdapters({ pubmed: [article("pmid:1")] }) }),
      ),
    ).rejects.toThrow("SMTP nede");
    expect(store.records.size).toBe(0);
    expect(store.lastRun).toBeUndefined();
  });

  it("dry run sender ikke og lagrer ingenting", async () => {
    const store = new MemorySeenStore();
    const notifier = new CapturingNotifier();
    const r = await runPipeline(
      options({
        store,
        notifier,
        dryRun: true,
        adapters: fakeAdapters({ pubmed: [article("pmid:1")] }),
      }),
    );
    expect(r.findings).toBe(1);
    expect(r.sent).toBe(false);
    expect(notifier.sent).toHaveLength(0);
    expect(store.records.size).toBe(0);
    expect(store.lastRun).toBeUndefined();
  });

  it("sender ikke tomt varsel når sendEmptyDigest=false", async () => {
    const notifier = new CapturingNotifier();
    const r = await runPipeline(options({ notifier, sendEmptyDigest: false }));
    expect(r.sent).toBe(false);
    expect(notifier.sent).toHaveLength(0);
  });
});
