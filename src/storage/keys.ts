/**
 * Table Storage tillater ikke / \ # ? eller kontrolltegn i PartitionKey/RowKey, og DOI-er
 * inneholder ofte «/». Vi deler id-en i navnerom (partisjon) og resten (rad), og
 * prosent-koder resten.
 *
 * Partisjonen er id-ens navnerom (pmid, doi, nct, epmc), ikke kilden: Da finner vi samme
 * artikkel som «sett» uansett om den kom fra PubMed eller Europe PMC.
 */
export function toKeys(id: string): { partitionKey: string; rowKey: string } {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) throw new Error(`Ugyldig id «${id}»`);
  return {
    partitionKey: id.slice(0, i),
    rowKey: encodeURIComponent(id.slice(i + 1)).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ),
  };
}

export function fromKeys(partitionKey: string, rowKey: string): string {
  return `${partitionKey}:${decodeURIComponent(rowKey)}`;
}
