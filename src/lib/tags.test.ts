import { describe, expect, it } from 'vitest'
import { addTag, cleanTag, collectTags, suggestTags, tagColor, tagKey } from './tags'

describe('tags', () => {
  it('cleans what is typed', () => {
    expect(cleanTag('  #rugăciune  ')).toBe('rugăciune')
    expect(cleanTag('##studiu   biblic')).toBe('studiu biblic')
    expect(cleanTag('x'.repeat(60))).toHaveLength(40)
    expect(cleanTag('#')).toBe('')
  })

  it('treats spellings that differ only in case or diacritics as one tag', () => {
    expect(tagKey('Rugăciune')).toBe(tagKey('#rugaciune'))
    expect(addTag(['rugăciune'], 'RUGACIUNE')).toEqual(['rugăciune'])
    expect(addTag([], 'profetii', ['profeții'])).toEqual(['profeții'])
    expect(addTag(['a'], '  ')).toEqual(['a'])
  })

  it('gives a stable colour from the letters', () => {
    expect(tagColor('Rugăciune')).toBe(tagColor('rugaciune'))
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(tagColor))
    expect(colors.size).toBeGreaterThan(3)
    for (const c of colors) expect(c).toBeGreaterThanOrEqual(0)
  })

  it('collects tags with counts, one spelling per tag', () => {
    const used = collectTags([
      { tags: ['Rugăciune', 'profeții'] },
      { tags: ['rugăciune'] },
      { tags: ['rugăciune', 'rugaciune'] },
    ])
    expect(used).toEqual([
      { key: 'profetii', count: 1, tag: 'profeții' },
      { key: 'rugaciune', count: 3, tag: 'rugăciune' },
    ])
  })

  it('suggests known tags that start with the input, then those that contain it', () => {
    const known = ['rugăciune', 'profeții', 'părinți', 'rugă de seară']
    expect(suggestTags(known, 'rug', [])).toEqual(['rugăciune', 'rugă de seară'])
    expect(suggestTags(known, 'ți', [])).toEqual(['profeții', 'părinți'])
    expect(suggestTags(known, 'rug', ['Rugaciune'])).toEqual(['rugă de seară'])
  })
})
