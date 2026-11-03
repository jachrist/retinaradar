import { HttpRequest, InvocationContext } from "@azure/functions";
import { describe, expect, it, vi } from "vitest";
import { ConfigError } from "../src/config/load.js";
import { createManualRun } from "../src/functions/manualRun.js";
import { buildDigest } from "../src/notify/digest.js";
import type { RunResult } from "../src/pipeline/run.js";

const ctx = () => new InvocationContext({ functionName: "manualRun" });
const req = (qs: string) =>
  new HttpRequest({ method: "GET", url: `http://localhost/api/manualRun${qs}` });

const result = (dryRun: boolean): RunResult => ({
  window: { since: "a", until: "b" },
  fetched: 3,
  findings: 0,
  failures: [],
  sent: !dryRun,
  dryRun,
  digest: buildDigest([], [], new Date("2026-11-02T05:00:00Z")),
});

describe("manualRun", () => {
  it("sender dryRun og since videre og returnerer forhåndsvisning", async () => {
    const runner = vi.fn(async () => result(true));
    const res = await createManualRun(runner)(req("?dryRun=true&since=2026-10-01"), ctx());
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, since: new Date("2026-10-01T00:00:00Z") }),
    );
    expect(res.status).toBe(200);
    expect(res.jsonBody).toMatchObject({ status: "ok", dryRun: true, fetched: 3 });
    expect((res.jsonBody as { preview: string }).preview).toContain("ingen nye treff");
  });

  it("400 ved ugyldig dato og ved konfigfeil", async () => {
    expect((await createManualRun(vi.fn())(req("?since=igår"), ctx())).status).toBe(400);
    const failing = vi.fn(async () => {
      throw new ConfigError("mangler");
    });
    expect((await createManualRun(failing)(req(""), ctx())).status).toBe(400);
  });
});
