import { HttpRequest, InvocationContext } from "@azure/functions";
import { describe, expect, it } from "vitest";
import { manualRun } from "../src/functions/manualRun.js";

describe("manualRun", () => {
  it("svarer ok og leser dryRun fra query", async () => {
    const request = new HttpRequest({
      method: "GET",
      url: "http://localhost/api/manualRun?dryRun=true",
    });
    const context = new InvocationContext({ functionName: "manualRun" });

    const response = await manualRun(request, context);

    expect(response.status).toBe(200);
    expect(response.jsonBody).toMatchObject({ status: "ok", dryRun: true });
  });
});
