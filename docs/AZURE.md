# Oppsett i Azure

Ressursene opprettes i en egen ressursgruppe. Hemmeligheter ligger i Key Vault, og
funksjonsappen bruker managed identity mot Key Vault og Table Storage. Den trenger altså
ingen nøkler eller tilkoblingsstrenger for egne data.

```
rg-retinaradar
├─ Function App (Flex Consumption, Linux, Node 22) + system-tildelt managed identity
├─ Storage account   – AzureWebJobsStorage + tabellene RetinaradarSeen/RetinaradarState
├─ Key Vault (RBAC)  – smtp-password, profile-json (og ev. ncbi-api-key)
└─ Application Insights (opprettes automatisk sammen med funksjonsappen)
```

Kostnad: Ukentlig kjøring på forbruksplan er i praksis gratis. Legg likevel inn et
budsjettvarsel på ressursgruppen (se nederst).

## Forutsetninger

- Azure CLI (`az login`) og tilgang til et abonnement der du kan opprette ressurser og
  tildele roller (Owner, eller Contributor + User Access Administrator)
- Gmail-konto med totrinnsbekreftelse og et **app-passord** (Google-konto → Sikkerhet → App-passord)
- Valgfritt: NCBI API-nøkkel (gratis, gir høyere rate limit for PubMed)

## 1. Variabler

Navn på storage account og Key Vault må være globalt unike. Bytt ut `<suffiks>`.

```bash
SUB="<abonnements-id>"
LOC="norwayeast"
RG="rg-retinaradar"
SUFFIX="<suffiks>"                # f.eks. initialer + tall, kun små bokstaver/tall
ST="stretinaradar${SUFFIX}"       # 3–24 tegn, kun små bokstaver og tall
KV="kv-retinaradar-${SUFFIX}"     # 3–24 tegn
APP="func-retinaradar-${SUFFIX}"

az account set --subscription "$SUB"
```

Sjekk at Flex Consumption finnes i valgt region. Hvis `norwayeast` ikke står på lista,
bruk f.eks. `swedencentral` eller `northeurope`:

```bash
az functionapp list-flexconsumption-locations --output table
```

## 2. Ressursgruppe, storage og Key Vault

```bash
az group create --name "$RG" --location "$LOC"

az storage account create --name "$ST" --resource-group "$RG" --location "$LOC" \
  --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false

az keyvault create --name "$KV" --resource-group "$RG" --location "$LOC" \
  --enable-rbac-authorization true
```

## 3. Funksjonsapp med managed identity

```bash
az functionapp create --name "$APP" --resource-group "$RG" --storage-account "$ST" \
  --flexconsumption-location "$LOC" --runtime node --runtime-version 22

az functionapp identity assign --name "$APP" --resource-group "$RG"
PRINCIPAL=$(az functionapp identity show --name "$APP" --resource-group "$RG" --query principalId -o tsv)
```

## 4. Roller

```bash
ST_ID=$(az storage account show --name "$ST" --resource-group "$RG" --query id -o tsv)
KV_ID=$(az keyvault show --name "$KV" --resource-group "$RG" --query id -o tsv)
ME=$(az ad signed-in-user show --query id -o tsv)

# Appen: lese/skrive tabeller og lese hemmeligheter
az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Storage Table Data Contributor" --scope "$ST_ID"
az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
  --role "Key Vault Secrets User" --scope "$KV_ID"

# Deg selv: legge inn hemmeligheter (også eiere trenger en dataplan-rolle i RBAC-vault)
az role assignment create --assignee-object-id "$ME" --assignee-principal-type User \
  --role "Key Vault Secrets Officer" --scope "$KV_ID"
```

Rolletildelinger kan bruke et par minutter på å tre i kraft.

## 5. Hemmeligheter i Key Vault

Bruk `read -s`, så havner ikke passordet i shell-historikken:

```bash
read -s -p "Gmail app-passord: " SMTP_PW; echo
az keyvault secret set --vault-name "$KV" --name smtp-password --value "$SMTP_PW" -o none
unset SMTP_PW

# Profilen (gen/diagnose) – samme innhold som config/profile.json lokalt
az keyvault secret set --vault-name "$KV" --name profile-json --file config/profile.json -o none

# Valgfritt
# az keyvault secret set --vault-name "$KV" --name ncbi-api-key --value "<nøkkel>" -o none
```

## 6. App-innstillinger

```bash
az functionapp config appsettings set --name "$APP" --resource-group "$RG" --settings \
  "TABLE_STORAGE_ACCOUNT_URL=https://${ST}.table.core.windows.net" \
  "SMTP_HOST=smtp.gmail.com" \
  "SMTP_PORT=465" \
  "SMTP_USER=<din-gmail>@gmail.com" \
  "MAIL_FROM=Retina-radar <<din-gmail>@gmail.com>" \
  "MAIL_TO=<mottaker1>@example.com,<mottaker2>@example.com" \
  "NCBI_EMAIL=<din-gmail>@gmail.com" \
  "SMTP_PASSWORD=@Microsoft.KeyVault(VaultName=${KV};SecretName=smtp-password)" \
  "PROFILE_JSON=@Microsoft.KeyVault(VaultName=${KV};SecretName=profile-json)"
# Valgfritt: "NCBI_API_KEY=@Microsoft.KeyVault(VaultName=${KV};SecretName=ncbi-api-key)"
```

Kontroller i portalen (Function App → Settings → Environment variables) at
Key Vault-referansene har grønn hake. Rød hake betyr som regel at rollen fra steg 4 ikke
har trådt i kraft ennå, eller at hemmeligheten mangler.

## 7. Budsjettvarsel (anbefalt)

Portalen → Cost Management → Budgets → Add. Velg ressursgruppen `rg-retinaradar`, beløp
f.eks. 50 kr/måned og varsel på 80 % til din e-post.

## 8. Deploy fra Cloud Shell

Cloud Shell har Azure Functions Core Tools (`func`) og Node. Kjør fra `retinaradar`-mappen,
med variablene fra steg 1 satt:

```bash
git clone -b fase-0-oppsett https://github.com/jachrist/retinaradar.git   # hvis ikke gjort
cd retinaradar
git pull

node -v            # 20 eller nyere holder for bygging
func --version     # 4.x

npm ci                         # alle avhengigheter, inkludert TypeScript
npm run build                  # kompilerer til dist/
npm prune --omit=dev           # fjerner utviklingsverktøy før opplasting
func azure functionapp publish "$APP" --no-build --javascript
```

`--javascript` forteller `func` at prosjektet er Node. Ellers leser den språket fra
`local.settings.json`, som ikke finnes i Cloud Shell. Med `--no-build` lastes det ferdigbygde resultatet og `node_modules` opp som det er, uten
en ny bygging i Azure. `.funcignore` holder `config/profile.json`, `local.settings.json`,
testene og kildekoden i TypeScript utenfor pakken.

Etter publisering skal begge funksjonene vises:

```
Functions in func-retinaradar-…:
    manualRun - [httpTrigger]
    weeklyRun - [timerTrigger]
```

Vil du bygge videre lokalt etterpå, kjører du `npm ci` igjen for å få tilbake
utviklingsverktøyene.

**Hvis noe feiler:**

- Står det `Can't find app with name`, er `$APP` tom eller feil. Sjekk med `echo $APP`.
- Vises ingen funksjoner etter publisering, finner ikke Functions-verten koden. Sjekk at
  `dist/src/functions/` finnes før publisering, og at `package.json` har
  `"main": "dist/src/functions/*.js"`.
- Hvis Flex Consumption ikke støtter Node 22 i regionen, opprett appen med
  `--runtime-version 20`. Koden kjører på begge.

## 9. Første test i Azure

Hent function key og kjør en dry run. Den henter fra alle kildene og returnerer varselet
som tekst, men sender ingenting og lagrer ingenting:

```bash
KEY=$(az functionapp function keys list --resource-group "$RG" --name "$APP" \
  --function-name manualRun --query default -o tsv)
HOST=$(az functionapp show --resource-group "$RG" --name "$APP" --query defaultHostName -o tsv)

curl -s "https://${HOST}/api/manualRun?dryRun=true&code=${KEY}" | python3 -m json.tool | head -40
```

Forventet: `"status": "ok"`, `fetched` over 0 og `failures: []`. I `preview` ser du
varselteksten.

| Svar                                         | Betyr                                                    | Gjør                       |
| -------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| 401                                          | Feil eller manglende `code`                              | Hent nøkkelen på nytt      |
| 400 med «Verken TABLE_STORAGE_ACCOUNT_URL …» | App-innstillingen mangler                                | Steg 6                     |
| 500 med `AuthorizationPermissionMismatch`    | Rollen på storage mangler eller er ikke aktiv ennå       | Steg 4, vent noen minutter |
| `failures` med `HTTP 429` fra PubMed         | Rate limit                                               | Legg inn NCBI API-nøkkel   |
| Ingen gen-spørringer i loggen                | `PROFILE_JSON` mangler eller Key Vault-referansen er rød | Steg 5 og 6                |

Når dry run ser riktig ut, kjører du en ekte kjøring uten `dryRun`. Da sendes e-posten,
og treffene lagres som sett. Kjør den gjerne to ganger. Andre gang skal `findings` være 0.

```bash
curl -s "https://${HOST}/api/manualRun?code=${KEY}" | python3 -m json.tool | head -20
```

**Logger:** Portalen → Function App → Monitoring → Logs/Application Insights, eller
Log stream for direkte logging.

## Senere: GitHub Actions med OIDC

Automatisk deploy ved push, med føderert legitimasjon og ingen hemmeligheter i GitHub.
Krever en app-registrering med rollen «Website Contributor» på funksjonsappen. Settes opp når
den manuelle deployen virker.
