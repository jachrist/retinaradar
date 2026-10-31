# Retina-radar

Automatisk overvåking av forskning, kliniske studier og nyheter om arvelig netthinnesykdom (stav/tapp-dystrofi), med ukentlig varsel om nye og relevante funn.

> Personlig prosjekt. Verktøyet gir informasjon og er ikke medisinsk rådgivning. Alle vurderinger av behandling og studiedeltakelse skal gjøres sammen med behandlende øyelege/genetiker.

---

## 1. Bakgrunn og mål

Min kone har en arvelig netthinnesykdom (stav/tapp-dystrofi) der celler sentralt i netthinnen brytes ned. Sykdommen skyldes en recessiv mutasjon. Jeg vil følge med på forskning som kan bedre situasjonen, blant annet:

- genterapi og genredigering (f.eks. CRISPR, antisense-oligonukleotider)
- kunstig netthinne / synsproteser
- optogenetikk
- stamcelle- og celleerstatningsterapi
- legemidler som bremser nedbrytningen

Vanlige søkemotorer og KI-chat gir støy og er ikke systematiske. Målet er en **liten, forutsigbar pipeline** som:

1. henter nye publikasjoner, preprints og kliniske studier fra åpne kilder
2. husker hva som allerede er sett (kun nytt varsles)
3. filtrerer og rangerer etter relevans
4. sender et kort ukentlig sammendrag på norsk

**Ikke mål (foreløpig):** autonom agent som surfer fritt på nettet, diagnostikk, pasientdata av noe slag.

## 2. Designvalg

- **Tradisjonell pipeline, ikke agent.** Overvåkingen skal være deterministisk og billig. Kildene har åpne API-er.
- **KI brukes bare som et valgfritt lag** for relevansvurdering og norsk sammendrag, ett API-kall per treff, med fast prompt og strukturert JSON-svar.
- **Idempotent.** Å kjøre jobben to ganger skal ikke gi doble varsler.
- **Konfigurasjon i data, ikke i kode.** Søkestrenger og nettsteder ligger i JSON-filer slik at de kan justeres uten å endre logikk.
- **Ingen personopplysninger eller helsedata lagres.** Kun offentlige referanser (PMID, DOI, NCT-nummer, URL).

## 3. Foreslått arkitektur

```
Azure Function (timer-trigger, ukentlig)
  ├─ Kilde-adaptere: pubmed, europepmc, clinicaltrials, rss
  ├─ Normalisering til felles modell (Item)
  ├─ Deduplisering mot Azure Table Storage (sett før?)
  ├─ Valgfritt: relevansvurdering + norsk sammendrag (LLM)
  └─ Varsling: e-post / Teams (direkte eller via Power Automate)
```

**Teknologi** (følger det jeg allerede bruker)

- Azure Functions (Node.js, TypeScript foretrukket)
- Azure Table Storage for «sett»-registeret
- Azure Key Vault for hemmeligheter (API-nøkler)
- Power Automate for å sende varsel til e-post/Teams (alternativt direkte fra funksjonen)
- Konfigurasjon i `config/*.json`, miljøvariabler i Function App settings

**Felles datamodell (`Item`)**

```ts
type Item = {
  id: string;            // f.eks. "pmid:12345678", "nct:NCT01234567", "doi:10...."
  source: "pubmed" | "europepmc" | "clinicaltrials" | "rss";
  type: "article" | "preprint" | "trial" | "news";
  title: string;
  abstract?: string;
  url: string;
  date: string;          // ISO 8601
  tags?: string[];       // f.eks. gen, terapitype
  trial?: { phase?: string; status?: string; countries?: string[]; sponsor?: string };
  relevance?: { score: number; reason: string; category: string }; // fra LLM-steget
};
```

## 4. Kilder

### 4.1 API-er (hovedkilder)

| Kilde | Bruk | Merknad |
|---|---|---|
| **PubMed E-utilities** (`eutils.ncbi.nlm.nih.gov/entrez/eutils/`) | Fagfellevurderte artikler | Bruk `esearch` + `esummary`/`efetch`. Registrer API-nøkkel hos NCBI for høyere rate limit. Filtrer med `datetype=edat` og `mindate`/`maxdate` for «nytt siden sist». |
| **Europe PMC REST** (`ebi.ac.uk/europepmc/webservices/rest/search`) | Artikler og **preprints** (bioRxiv/medRxiv) | Bruk `format=json` og datofilter. Dekker preprints som PubMed ikke har. |
| **ClinicalTrials.gov API v2** (`clinicaltrials.gov/api/v2/studies`) | Kliniske studier | Mest interessant for «hva er på vei mot pasienter». Søk på tilstand/term, følg `lastUpdatePostDate` og statusendringer (f.eks. «Recruiting»). |
| **EU Clinical Trials (CTIS)** og **WHO ICTRP** | Europeiske/internasjonale studier | Sjekk om det finnes brukbart API/eksport. Ellers manuell kontroll eller senere fase. |

### 4.2 Organisasjoner og nyhetsstrømmer (RSS/nettsider)

Verifiser at hver URL fortsatt fungerer og om det finnes RSS før de legges i `config/sources.json`:

- Foundation Fighting Blindness (fightingblindness.org), forskningsnyheter
- Retina International (retina-international.org)
- Eurordis og Orphanet (orpha.net), sjeldne sykdommer i Europa
- RetNet (sph.uth.edu/retnet), oversikt over gener ved netthinnesykdommer
- Norges Blindeforbund (blindeforbundet.no)
- Sjeldne diagnoser / Frambu (sjeldnediagnoser.no), norsk fagformidling
- Oslo universitetssykehus, øyeavdelingen, og Nasjonal kompetansetjeneste for arvelige netthinnesykdommer (verifiser navn/URL)
- Selskaper med relevante studier: følges via ClinicalTrials.gov (sponsor-felt) og nyhetsstrømmer
- Regulatorer: EMA (godkjenninger og høringer) og FDA, kun som sjekk for faktiske godkjenninger

### 4.3 Sider uten RSS (senere fase)

Enkel «endringsdeteksjon»: hent side, trekk ut tekst, lagre hash i Table Storage, varsle ved endring. Egner seg for noen få kuraterte sider.

## 5. Søketermer

> **TODO (fylles inn av meg):** Genet/varianten som er påvist hos min kone, og om diagnosen er *tapp-stav-* eller *stav-tapp-dystrofi*. Genspesifikke søk gir langt bedre treff enn generelle, og avgjør hva som er relevant for studier. Hold dette i `config/profile.json` som kun er lokal konfigurasjon, ikke sjekket inn i et offentlig repo.

### 5.1 Sykdomsterminologi (engelsk, brukes i søk)

- `"cone-rod dystrophy"`, `"cone rod dystrophy"`, `CORD`
- `"rod-cone dystrophy"`, `"retinitis pigmentosa"` (tilgrensende, ofte samme studier)
- `"inherited retinal dystrophy"`, `"inherited retinal disease"`, `IRD`
- `"retinal dystrophy"`, `"macular dystrophy"`
- Ved aktuelt gen: `"<GENSYMBOL>"` kombinert med `retina*` (f.eks. ABCA4, CRX, GUCY2D, PROM1, CDHR1, RPGRIP1 avhengig av diagnose)

MeSH-termer for PubMed: `"Cone-Rod Dystrophies"[MeSH]`, `"Retinal Dystrophies"[MeSH]`, `"Retinitis Pigmentosa"[MeSH]`

### 5.2 Terapi- og teknologitermer

- Genterapi: `"gene therapy"`, `"gene augmentation"`, `AAV`, `"subretinal"`, `"intravitreal"`
- Genredigering: `CRISPR`, `"gene editing"`, `"base editing"`, `"prime editing"`
- RNA-terapi: `"antisense oligonucleotide"`, `"exon skipping"`, `"splicing"`
- Optogenetikk: `optogenetic*`
- Synsprotese: `"retinal prosthesis"`, `"retinal implant"`, `"visual prosthesis"`, `"photovoltaic"`
- Celleterapi: `"stem cell"`, `"retinal pigment epithelium"`, `RPE`, `"photoreceptor transplantation"`
- Legemidler: `"visual cycle"`, `neuroprotect*`, `"complement inhibition"`

### 5.3 Eksempel på søkestrenger

**PubMed**

```
("cone-rod dystrophy"[tiab] OR "Cone-Rod Dystrophies"[MeSH] OR "inherited retinal dystrophy"[tiab])
AND ("gene therapy"[tiab] OR CRISPR[tiab] OR "gene editing"[tiab] OR "retinal prosthesis"[tiab] OR optogenetic*[tiab])
```

**Gen-spesifikt (erstatt med riktig gen)**

```
(<GENSYMBOL>[tiab]) AND (retina*[tiab] OR dystrophy[tiab])
```

**ClinicalTrials.gov** (`query.cond` + `query.term`)

```
cond:  "cone-rod dystrophy" OR "retinal dystrophy" OR "inherited retinal disease"
term:  "gene therapy" OR CRISPR OR prosthesis OR optogenetic
filter: overallStatus = RECRUITING, NOT_YET_RECRUITING, ACTIVE_NOT_RECRUITING
```

Søkestrenger skal ligge i `config/queries.json` med felter for kilde, streng og prioritet.

## 6. Relevansvurdering med KI (valgfritt steg)

For hvert nye treff sendes tittel + sammendrag til en språkmodell med fast prompt som returnerer **kun JSON**:

```json
{
  "score": 0,
  "category": "genterapi | genredigering | synsprotese | celleterapi | legemiddel | grunnforskning | annet",
  "stage": "dyr/laboratorie | klinisk fase 1/2 | klinisk fase 3 | godkjent | oversikt",
  "matches_profile": true,
  "summary_no": "2-3 setninger på norsk",
  "reason": "kort begrunnelse"
}
```

Krav:

- Modellnavn og API-nøkkel hentes fra konfigurasjon/Key Vault, ikke hardkodet.
- Prompten skal be modellen skille tydelig mellom dyrestudier, tidlig klinisk fase og godkjent behandling, og **ikke overselge** resultater.
- Bruk norske medisinske fagtermer i sammendraget der det finnes etablerte begreper (f.eks. netthinne, genterapi, stav/tapp).
- Treff under en terskel (f.eks. score < 4) hoppes over i varselet, men logges.
- Hvis LLM-kallet feiler, sendes treffet uansett uten sammendrag. Overvåkingen skal ikke avhenge av KI.

## 7. Varsling

Ukentlig sammendrag, sortert etter relevans:

1. **Kliniske studier**: nye, endret status, rekrutterer i Norge/Norden/Europa
2. **Publikasjoner og preprints**: høyest score først
3. **Nyheter fra organisasjoner**

Hvert element: tittel, kilde, dato, trinn (stage), kort norsk sammendrag, lenke. Kanal: e-post og/eller Teams-melding. Eget raskt varsel (ikke bare ukentlig) for nye studier som matcher gen og rekrutterer i Europa kan vurderes.

## 8. Trinnvis plan for Claude Code

Be Claude Code jobbe fase for fase og stoppe for gjennomgang mellom hver.

**Fase 0, oppsett**
- Initialiser Azure Functions-prosjekt (Node.js/TypeScript), lint, tester (vitest eller jest)
- Mappestruktur: `src/sources/`, `src/pipeline/`, `src/notify/`, `config/`, `test/`
- Lokal utvikling med `local.settings.json` (ikke i git)

**Fase 1, kjerne uten KI**
- Adaptere for PubMed, Europe PMC og ClinicalTrials.gov med enhetstester mot lagrede eksempelsvar
- Normalisering til `Item`
- Table Storage for «sett»-register (partisjonsnøkkel = kilde, radnøkkel = id)
- Enkel e-postoppsummering (ren tekst/HTML)
- Timer-trigger + HTTP-trigger for manuell kjøring

**Fase 2, flere kilder og robusthet**
- RSS-adapter og endringsdeteksjon for utvalgte sider
- Rate limiting, retry med backoff, tydelig logging (Application Insights)
- Håndtering av at samme arbeid dukker opp som preprint og senere som artikkel (match på DOI/tittel)

**Fase 3, KI-lag**
- Relevansvurdering og norsk sammendrag (se pkt. 6)
- Kostnadsgrense per kjøring og logging av token-bruk

**Fase 4, varsling**
- Power Automate-flyt eller direkte e-post/Teams
- Konfigurerbar frekvens og terskel

**Fase 5, utvidelser (valgfritt)**
- Enkel nettside/rapportarkiv
- Agent-basert oppdagelse av nye kilder
- Sporing av enkeltstudier over tid (statusendringer)

## 9. Sikkerhet og drift

- Alle hemmeligheter i Key Vault, tilgang via managed identity
- Ingen persondata eller helseopplysninger i repo, logger eller lagring
- `config/profile.json` (gen/diagnose) holdes utenfor versjonskontroll hvis repoet er offentlig
- Respekter vilkår, rate limits og `robots.txt` for alle kilder
- Kostnad skal være ubetydelig (ukentlig kjøring, forbruksplan)

## 10. Åpne spørsmål

- [ ] Hvilket gen/variant og hvilken nøyaktig diagnose gjelder? (styrer søk og filtrering)
- [ ] Skal varsel gå til e-post, Teams, eller begge?
- [ ] Hvilke land/regioner er praktisk aktuelle for studiedeltakelse?
- [ ] Skal KI-laget være med fra start, eller legges til etter at kjernen fungerer?
- [ ] Offentlig eller privat repo?

## 11. Instruksjoner til Claude Code

- Start med å lese denne filen og foreslå en konkret plan for Fase 0 og 1 før du skriver kode.
- Spør meg om gen/diagnose og andre åpne spørsmål (pkt. 10) når det er nødvendig for å gå videre.
- Hold løsningen enkel. Ikke innfør en agent eller ekstra infrastruktur uten at det er begrunnet.
- Skriv tester for hver kilde-adapter, og verifiser faktiske API-parametere mot offisiell dokumentasjon fremfor å anta dem.
- Kode og identifikatorer på engelsk. Brukerrettet tekst (varsler, sammendrag) på norsk.
