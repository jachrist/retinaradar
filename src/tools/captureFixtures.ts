/**
 * Henter små, ekte eksempelsvar fra API-ene og lagrer dem i test/fixtures/, og kjører
 * parserne på dem som en røyktest. Bruker kun generelle sykdomstermer (ingen profil/gen).
 *
 *   npm run fixtures
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildStudiesUrl,
  toItem as ctToItem,
  type CtgovResponse,
} from "../sources/clinicaltrials.js";
import {
  buildSearchUrl,
  toItem as epToItem,
  type EuropePmcResponse,
} from "../sources/europepmc.js";
import { createHttpClient } from "../sources/http.js";
import {
  buildEfetchUrl,
  buildEsearchUrl,
  parseEfetchXml,
  parseEsearch,
} from "../sources/pubmed.js";

const OUT = path.resolve("test/fixtures");
const DAY = 86_400_000;
const until = new Date();
const window = { since: new Date(until.getTime() - 180 * DAY), until };
const http = createHttpClient();

async function save(name: string, content: string) {
  await writeFile(path.join(OUT, name), content, "utf8");
  console.log(`  lagret ${name} (${content.length} tegn)`);
}

async function pubmed() {
  console.log("PubMed");
  const esearch = await http.getText(
    buildEsearchUrl('"cone-rod dystrophy"[tiab] OR "Cone-Rod Dystrophies"[MeSH]', window, {
      retmax: 5,
    }),
  );
  await save("pubmed-esearch.json", esearch);
  const { count, ids } = parseEsearch(JSON.parse(esearch));
  console.log(`  esearch: count=${count}, ids=${ids.join(",")}`);
  if (!ids.length) return;
  await new Promise((r) => setTimeout(r, 400));
  const xml = await http.getText(buildEfetchUrl(ids, {}), { accept: "application/xml" });
  await save("pubmed-efetch.xml", xml);
  for (const i of parseEfetchXml(xml)) console.log(`  ${i.id} ${i.date} ${i.title.slice(0, 70)}`);
}

async function europepmc() {
  console.log("Europe PMC");
  for (const [name, q] of [
    ["europepmc-search.json", '"cone-rod dystrophy"'],
    ["europepmc-preprints.json", '"inherited retinal" AND SRC:PPR'],
  ] as const) {
    const text = await http.getText(buildSearchUrl(q, window, { cursorMark: "*", pageSize: 5 }));
    await save(name, text);
    const res = JSON.parse(text) as EuropePmcResponse;
    console.log(`  hitCount=${res.hitCount}, nextCursorMark=${res.nextCursorMark}`);
    for (const r of res.resultList?.result ?? []) {
      const i = epToItem(r);
      console.log(`  ${i?.id} ${i?.type} ${i?.date} ${i?.title.slice(0, 60)}`);
    }
  }
}

async function clinicaltrials() {
  console.log("ClinicalTrials.gov");
  const text = await http.getText(
    buildStudiesUrl({ cond: "retinal dystrophy", overallStatus: ["RECRUITING"] }, window, {
      pageSize: 5,
    }),
  );
  await save("clinicaltrials-studies.json", text);
  const res = JSON.parse(text) as CtgovResponse;
  console.log(`  studies=${res.studies?.length}, nextPageToken=${res.nextPageToken ?? "-"}`);
  for (const s of res.studies ?? []) {
    const i = ctToItem(s);
    console.log(
      `  ${i?.id} ${i?.trial?.status} ${i?.trial?.phase ?? "-"} ${i?.title.slice(0, 50)}`,
    );
  }
}

await mkdir(OUT, { recursive: true });
let failed = false;
for (const step of [pubmed, europepmc, clinicaltrials]) {
  try {
    await step();
  } catch (err) {
    failed = true;
    console.error(`  FEIL: ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
