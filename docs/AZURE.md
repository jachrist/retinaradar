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

## Deretter: deploy

Dette gjøres i neste steg, når du sier fra:

- **Manuelt fra egen maskin:** `npm run build && func azure functionapp publish "$APP"`.
  `.funcignore` holder `config/profile.json` og `local.settings.json` utenfor pakken.
- **Eller GitHub Actions med OIDC** (føderert legitimasjon, ingen hemmeligheter i GitHub).
  Krever en app-registrering med rollen «Website Contributor» på funksjonsappen.

Første test etter deploy: Kall `manualRun` med `?dryRun=true` (function key finner du under
Function App → Functions → manualRun → Function Keys). Kjør deretter én ekte kjøring.
