import { app, type InvocationContext, type Timer } from "@azure/functions";
import { runFromEnvironment } from "../app.js";
import { contextLogger } from "./logger.js";

/** Ukentlig kjøring, mandag 05:00 UTC (NCRONTAB: sek min time dag måned ukedag). */
export async function weeklyRun(_timer: Timer, context: InvocationContext): Promise<void> {
  const result = await runFromEnvironment({ log: contextLogger(context) });
  context.log(
    `Ferdig: ${result.findings} nye/endrede, ${result.failures.length} kildefeil, sendt=${result.sent}`,
  );
}

app.timer("weeklyRun", {
  schedule: "0 0 5 * * 1",
  runOnStartup: false,
  handler: weeklyRun,
});
