import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { runFromEnvironment, type AppOptions } from "../app.js";
import { ConfigError } from "../config/load.js";
import { renderText } from "../notify/render.js";
import type { RunResult } from "../pipeline/run.js";
import { contextLogger } from "./logger.js";

type Runner = (o: AppOptions) => Promise<RunResult>;

/**
 * Manuell kjøring: POST/GET /api/manualRun[?dryRun=true][&since=YYYY-MM-DD].
 * Ved dryRun returneres varselteksten i svaret, og ingenting sendes eller lagres.
 */
export function createManualRun(runner: Runner = runFromEnvironment) {
  return async function manualRun(
    request: HttpRequest,
    context: InvocationContext,
  ): Promise<HttpResponseInit> {
    const dryRun = request.query.get("dryRun") === "true";
    const sinceParam = request.query.get("since");
    const since = sinceParam ? new Date(`${sinceParam}T00:00:00Z`) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      return { status: 400, jsonBody: { error: `Ugyldig since: ${sinceParam}` } };
    }

    try {
      const r = await runner({ log: contextLogger(context), dryRun, since });
      return {
        status: 200,
        jsonBody: {
          status: "ok",
          dryRun: r.dryRun,
          window: r.window,
          fetched: r.fetched,
          findings: r.findings,
          failures: r.failures,
          sent: r.sent,
          ...(dryRun ? { preview: renderText(r.digest) } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      context.error(`manualRun feilet: ${message}`);
      return { status: err instanceof ConfigError ? 400 : 500, jsonBody: { error: message } };
    }
  };
}

export const manualRun = createManualRun();

app.http("manualRun", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: manualRun,
});
