import { describe, expect, it } from 'vitest'
import { normalize, normalizeWithMap } from './normalize'

describe('normalize', () => {
  it('drops case and every Romanian diacritic, comma-below and cedilla alike', () => {
    expect(normalize('Rugăciune ÎNTÂI Știință Țară')).toBe('rugaciune intai stiinta tara')
    expect(normalize('ştiinţă Ş Ţ')).toBe('stiinta s t')
    expect(normalize('ș ț ş ţ')).toBe(normalize('s t s t'))
  })

  it('treats decomposed input like composed input', () => {
    expect(normalize('șî')).toBe('si')
  })

  it('maps every normalized character back to the original', () => {
    const original = 'Pâine și vin'
    const { text, map } = normalizeWithMap(original)
    expect(text).toBe('paine si vin')
    const at = text.indexOf('si')
    expect(original.slice(map[at], map[at + 2])).toBe('și')
    expect(map.at(-1)).toBe(original.length)
  })
})
