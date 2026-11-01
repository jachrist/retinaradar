# Plan og beslutninger – fase 0 og 1

## Beslutninger

| Tema      | Valg                                                                        |
| --------- | --------------------------------------------------------------------------- |
| Runtime   | Azure Functions v4-programmeringsmodell, Node 22, TypeScript (strict, ESM)  |
| Test/lint | Vitest, ESLint (flat config) + Prettier, CI i GitHub Actions                |
| Lagring   | Azure Table Storage (Azurite lokalt)                                        |
| Varsling  | SMTP via Gmail med app-passord (nodemailer), bak et `Notifier`-interface    |
| Repo      | Offentlig. `config/profile.json` og `local.settings.json` er i `.gitignore` |
| Drift     | Kjøres lokalt først. Ny ressursgruppe i Azure (Bicep) settes opp senere     |

## Fase 0 – oppsett ✅ (ferdig)

- Prosjektstruktur, TypeScript, lint, format, test, CI
- Plassholder-HTTP-funksjon `manualRun`
- `config/queries.json`, `config/profile.example.json`, `local.settings.example.json`

## Fase 1 – kjerne uten KI (implementert, delvis verifisert)

| Del                                     | Fil(er)                         | Status                                    |
| --------------------------------------- | ------------------------------- | ----------------------------------------- |
| Konfig + validering, `{GENE}`-utvidelse | `src/config/`                   | ✅ testet                                 |
| PubMed (esearch → efetch XML)           | `src/sources/pubmed.ts`         | ⚠️ URL-er testet, ikke kjørt mot live API |
| Europe PMC (search, cursorMark)         | `src/sources/europepmc.ts`      | ⚠️ URL-er testet, ikke kjørt mot live API |
| ClinicalTrials.gov v2 (/studies)        | `src/sources/clinicaltrials.ts` | ⚠️ URL-er testet, ikke kjørt mot live API |
| Sammenslåing på tvers av kilder         | `src/pipeline/dedupe.ts`        | ✅ testet                                 |
| «Sett»-register + siste kjøring         | `src/storage/`                  | ✅ testet, også mot Azurite               |
| Pipeline (vindu, idempotens, feil)      | `src/pipeline/run.ts`           | ✅ testet                                 |
| Varsel (norsk tekst + HTML)             | `src/notify/`                   | ✅ testet                                 |
| SMTP (Gmail)                            | `src/notify/notifier.ts`        | ⚠️ ikke testet mot ekte SMTP              |
| Timer- og HTTP-trigger                  | `src/functions/`                | ✅ enhetstestet, `func start` ikke kjørt  |
| Lokal CLI                               | `src/cli.ts`                    | ✅ kjørt mot Azurite                      |

### Hvordan det virker

- **Vindu:** fra forrige vellykkede kjøring minus `OVERLAP_DAYS` (14). Første kjøring går `FIRST_RUN_DAYS` (30) bakover, og vinduet er aldri lenger enn `MAX_LOOKBACK_DAYS` (90).
- **Dedup:** samme artikkel fra PubMed og Europe PMC får samme id (`pmid:…`) og slås sammen. Er treffet allerede i registeret, varsles det ikke på nytt.
- **Studier:** Siste status lagres. Når den endres (f.eks. fra «Ikke startet rekruttering» til «Rekrutterer»), varsles det som «ENDRET STATUS».
- **Feil:** En kilde som feiler, stopper ikke de andre, og feilen vises nederst i e-posten. «Siste vellykkede kjøring» flyttes bare når ingen kilder feilet, så neste vindu dekker hullet. Treff markeres som sett først etter at e-posten er sendt.
- **Tomt varsel:** sendes som standard, som et livstegn (`SEND_EMPTY_DIGEST=false` slår det av).
- **Land:** Profilens `regions` (f.eks. `["NO","EU"]`) fremheves og listes først i studieoppføringene.

### Avvik fra README

- **PartitionKey er id-ens navnerom** (`pmid`, `doi`, `nct`, `epmc`), ikke kilden. Ellers ville samme artikkel fra PubMed og Europe PMC blitt varslet to ganger.
- **Profilen kan også gis som miljøvariabelen `PROFILE_JSON`**, slik at den ikke må deployes som fil fra et offentlig repo.
- **Table Storage bruker foreløpig tilkoblingsstreng.** Managed identity kommer med Azure-oppsettet.

## Åpne punkter (krever nettverkstilgang til API-ene)

Utviklingsmiljøet fikk ikke nå `eutils.ncbi.nlm.nih.gov`, `www.ebi.ac.uk` eller `clinicaltrials.gov`, og heller ikke dokumentasjonssidene deres. Følgende antakelser må derfor verifiseres:

1. **PubMed:** `datetype=edat` med `mindate`/`maxdate` i formatet `YYYY/MM/DD`; strukturen i efetch-XML (entrez-dato i `PubmedData/History`).
2. **Europe PMC:** `FIRST_PDATE:[YYYY-MM-DD TO YYYY-MM-DD]` som datofilter. Det kan finnes et bedre felt for indekseringsdato. `resultType=core` skal gi `abstractText`, og `nextCursorMark` brukes til paginering.
3. **ClinicalTrials.gov:** `filter.advanced=AREA[LastUpdatePostDate]RANGE[YYYY-MM-DD,YYYY-MM-DD]`, `pageToken`/`nextPageToken`, og verdiene i `phases`.
4. **Parsertester mot ekte svar:** Kjør `npm run fixtures` (lagrer svar i `test/fixtures/` og skriver ut hva parserne fant), og skriv deretter tester mot de lagrede filene.
5. **SMTP mot Gmail** og **`func start`** må prøves lokalt.

## Kom i gang lokalt

```bash
npm install
cp local.settings.example.json local.settings.json   # fyll inn SMTP_USER, SMTP_PASSWORD (app-passord), MAIL_TO
cp config/profile.example.json config/profile.json   # fyll inn gen(er) og regioner

npm test
npm run azurite                                       # lokal Table Storage (eget terminalvindu)

npm run fixtures                                      # røyktest mot API-ene + lagre eksempelsvar
npm run once -- --dry-run                             # hent og skriv varsel til out/, uten å sende/lagre
npm run once -- --file                                # full kjøring, men varsel til out/ i stedet for e-post
npm run once                                          # full kjøring med e-post
npm run once -- --memory --dry-run                    # uten Azurite

npm start                                             # Azure Functions lokalt (krever Core Tools v4)
curl "http://localhost:7071/api/manualRun?dryRun=true"
```

Kjør `npm run once` to ganger på rad: Den andre kjøringen skal gi 0 nye treff.
