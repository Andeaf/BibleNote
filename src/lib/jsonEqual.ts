/**
 * Deep equality for JSON values, ignoring object key order. Postgres stores `jsonb` with its own
 * key order, so a note's content can come back from the server with the keys moved around.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((item, i) => jsonEqual(item, other[i]))
  }
  const left = Object.entries(a as Record<string, unknown>).filter(([, v]) => v !== undefined)
  const right = b as Record<string, unknown>
  const rightCount = Object.values(right).filter((v) => v !== undefined).length
  return left.length === rightCount && left.every(([key, value]) => jsonEqual(value, right[key]))
}
