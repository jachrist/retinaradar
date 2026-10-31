import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";

/**
 * Manuell kjøring av pipelinen. Fase 0: kun en plassholder som bekrefter at
 * funksjonsappen starter. Selve pipelinen kobles på i fase 1.
 */
export async function manualRun(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const dryRun = request.query.get("dryRun") === "true";
  context.log(`manualRun kalt (dryRun=${dryRun})`);
  return {
    status: 200,
    jsonBody: { status: "ok", dryRun, message: "Pipeline er ikke implementert ennå (fase 1)." },
  };
}

app.http("manualRun", {
  methods: ["GET", "POST"],
  authLevel: "function",
  handler: manualRun,
});
