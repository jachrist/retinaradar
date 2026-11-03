/**
 * Lokal kjøring uten Azure Functions Core Tools:
 *   npm run once -- [--dry-run] [--memory] [--file] [--since=YYYY-MM-DD]
 *
 * Leser Values fra local.settings.json inn i miljøet (uten å overstyre eksisterende).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runFromEnvironment } from "./app.js";
import type { Logger } from "./pipeline/run.js";

const HELP = `Bruk: npm run once -- [valg]
  --dry-run            Hent og vis varsel (skrives til out/), men ikke send og ikke marker som sett
  --memory             Bruk «sett»-register i minnet (ingen Azurite/Table Storage nødvendig)
  --file               Skriv varselet til out/ i stedet for å sende e-post
  --since=YYYY-MM-DD   Overstyr nedre datogrense
  --help               Vis denne hjelpen`;

async function loadLocalSettings(): Promise<void> {
  try {
    const raw = await readFile(path.resolve("local.settings.json"), "utf8");
    const values = (JSON.parse(raw) as { Values?: Record<string, string> }).Values ?? {};
    for (const [k, v] of Object.entries(values)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

const log: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(`ADVARSEL: ${m}`),
  error: (m) => console.error(`FEIL: ${m}`),
};

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => !a.includes("=")));
  if (flags.has("--help")) {
    console.log(HELP);
    return 0;
  }
  const known = new Set(["--dry-run", "--memory", "--file"]);
  const unknown = argv.filter((a) => !known.has(a) && !a.startsWith("--since="));
  if (unknown.length) {
    console.error(`Ukjent valg: ${unknown.join(" ")}\n\n${HELP}`);
    return 2;
  }
  const sinceArg = argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
  const since = sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`Ugyldig dato: ${sinceArg}`);
    return 2;
  }

  await loadLocalSettings();
  const dryRun = flags.has("--dry-run");
  const result = await runFromEnvironment({
    log,
    dryRun,
    since,
    memoryStore: flags.has("--memory"),
    outDir: dryRun || flags.has("--file") ? path.resolve("out") : undefined,
  });
  console.log(
    `\nFerdig: ${result.fetched} hentet, ${result.findings} nye/endrede, ` +
      `${result.failures.length} kildefeil, sendt=${result.sent}`,
  );
  return result.failures.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
