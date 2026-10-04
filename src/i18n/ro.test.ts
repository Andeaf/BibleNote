import { describe, expect, it } from 'vitest'
import { ro } from './ro'

function leaves(value: unknown, path = 'ro'): Array<[string, unknown]> {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaves(child, `${path}.${key}`))
  }
  return [[path, value]]
}

describe('ro strings', () => {
  const entries = leaves(ro)

  it('contains only non-empty strings', () => {
    expect(entries.length).toBeGreaterThan(0)
    for (const [path, value] of entries) {
      expect(typeof value, path).toBe('string')
      expect((value as string).trim().length, path).toBeGreaterThan(0)
    }
  })

  it('uses comma-below diacritics (ș ț), never cedilla (ş ţ)', () => {
    for (const [path, value] of entries) {
      expect(value as string, path).not.toMatch(/[şţŞŢ]/)
    }
  })
})
