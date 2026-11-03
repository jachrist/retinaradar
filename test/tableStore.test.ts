/**
 * Integrasjonstest mot Azurite. Kjøres kun når AZURITE_TABLE=1 (start med `npm run azurite`).
 */
import { describe, expect, it } from "vitest";
import { TableSeenStore } from "../src/storage/tableStore.js";

// Egne tabeller per testkjøring, så testen ikke rører den lokale «ekte» tilstanden.
const PREFIX = `Test${Date.now()}`;

describe.runIf(process.env.AZURITE_TABLE === "1")("TableSeenStore (Azurite)", () => {
  it("lagrer og henter sett-poster og siste kjøring", async () => {
    const store = await TableSeenStore.create(
      { connectionString: "UseDevelopmentStorage=true" },
      PREFIX,
    );
    const id = `doi:10.1101/test.${Date.now()}/x`;
    expect((await store.getMany([id])).size).toBe(0);

    await store.markSeen([{ id, source: "europepmc", firstSeen: "2026-11-01T00:00:00.000Z" }]);
    await store.markSeen([
      {
        id: "nct:NCT0TEST",
        source: "clinicaltrials",
        firstSeen: "2026-11-01T00:00:00.000Z",
        status: "RECRUITING",
      },
    ]);
    const got = await store.getMany([id, "nct:NCT0TEST", "pmid:ukjent"]);
    expect(got.get(id)).toEqual({ id, source: "europepmc", firstSeen: "2026-11-01T00:00:00.000Z" });
    expect(got.get("nct:NCT0TEST")?.status).toBe("RECRUITING");
    expect(got.has("pmid:ukjent")).toBe(false);

    const when = new Date("2026-11-02T05:00:00Z");
    await store.setLastSuccessfulRun(when);
    expect(await store.getLastSuccessfulRun()).toEqual(when);

    // createTable skal tåle at tabellene finnes fra før.
    await TableSeenStore.create({ connectionString: "UseDevelopmentStorage=true" }, PREFIX);
  });
});
