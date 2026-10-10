const MARKS = /\p{M}/gu

/**
 * Search form of a text: no diacritics (ă â î ș ț, and the cedilla forms ş ţ found in older
 * texts), lowercase. Used both for indexing and for the query.
 */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(MARKS, '').toLowerCase()
}

/**
 * normalize(), plus for every character of the result the index of the character it came from
 * in the original, so a match found in the normalized text can be cut and marked in the original.
 * `map` has one extra entry at the end: the original length.
 */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = ''
  const map: number[] = []
  let index = 0
  for (const char of text) {
    const normalized = normalize(char)
    for (let k = 0; k < normalized.length; k++) map.push(index)
    out += normalized
    index += char.length
  }
  map.push(index)
  return { text: out, map }
}
