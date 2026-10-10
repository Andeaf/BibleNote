import { describe, expect, it } from 'vitest'
import { jsonEqual } from './jsonEqual'
import { formatDateTime, formatRelative } from './time'

describe('time', () => {
  it('formats a date as "4 oct. 2026 14:32"', () => {
    expect(formatDateTime(new Date(2026, 9, 4, 14, 32))).toBe('4 oct. 2026 14:32')
  })

  it('says how long ago, in Romanian', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(formatRelative('2026-10-10T11:59:30Z', now)).toBeNull()
    expect(formatRelative('2026-10-10T11:55:00Z', now)).toBe('acum 5 minute')
    expect(formatRelative('2026-10-10T10:00:00Z', now)).toBe('acum 2 ore')
    expect(formatRelative('2026-10-09T12:00:00Z', now)).toBe('ieri')
    expect(formatRelative('2026-07-01T12:00:00Z', now)).toBe('acum 3 luni')
  })
})

describe('jsonEqual', () => {
  it('ignores key order (jsonb reorders keys), not values', () => {
    const a = { type: 'doc', content: [{ a: 1, b: [2] }] }
    const b = { content: [{ b: [2], a: 1 }], type: 'doc' }
    expect(jsonEqual(a, b)).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonEqual({ a: null }, {})).toBe(false)
    expect(jsonEqual({ a: undefined }, {})).toBe(true)
  })
})
