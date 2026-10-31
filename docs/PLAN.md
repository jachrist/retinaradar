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

## Fase 0 – oppsett ✅

- Prosjektstruktur, TypeScript, lint, format, test, CI
- Plassholder-HTTP-funksjon `manualRun`
- `config/queries.json`, `config/profile.example.json`, `local.settings.example.json`

## Fase 1 – kjerne uten KI

1. **Konfigurasjon:** lasting og validering (zod) av `queries.json` og `profile.json`. `{GENE}` fylles fra profilen, og spørringer med plassholder hoppes over uten profil.
2. **Adaptere** med felles kontrakt `fetchNew(query, since): Promise<Item[]>`:
   - PubMed: `esearch` (edat + mindate/maxdate, usehistory) → `efetch` XML (abstract). Rate limit, valgfri API-nøkkel.
   - Europe PMC: `search` (json, resultType=core, cursorMark). Treff med PMID får id `pmid:…` → dedup mot PubMed.
   - ClinicalTrials.gov v2: `/studies` med `query.cond`/`query.term`/`filter.overallStatus`, datofilter på LastUpdatePostDate, `pageToken`.
   - Parametere verifiseres mot offisiell dokumentasjon. Testene kjøres mot lagrede svar i `test/fixtures/`.
3. **Normalisering** til `Item`, ID-prioritet pmid > doi > nct > ppr, ISO-datoer, HTML vaskes bort.
4. **«Sett»-register:** PartitionKey = kilde, RowKey = kodet id (DOI-er inneholder `/`). Studiestatus lagres slik at statusendringer kan merkes «endret».
5. **Idempotens:** henter fra forrige vellykkede kjøring minus 14 dagers overlapp. Treff markeres som sett først etter at e-posten er sendt. En kilde som feiler stopper ikke de andre.
6. **Varsel:** tekst + HTML på norsk, gruppert etter studier, publikasjoner og nyheter. `--dry-run` skriver til konsoll/fil.
7. **Triggere:** timer (mandag 05:00 UTC) og HTTP (`?dryRun=true`).

**Ferdig når:** en lokal kjøring mot Azurite gir et fornuftig sammendrag, og kjøring nr. 2 gir null nye treff.

## Kom i gang lokalt

```bash
npm install
cp local.settings.example.json local.settings.json   # fyll inn SMTP_* m.m.
cp config/profile.example.json config/profile.json   # valgfritt i starten
npm test
npx azurite --silent --location .azurite &            # lokal Table Storage
npm start                                             # krever Azure Functions Core Tools v4
curl "http://localhost:7071/api/manualRun?dryRun=true"
```
