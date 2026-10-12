import { describe, expect, it } from 'vitest'
import { BOOKS } from './books'
import {
  chapterCount,
  findReferences,
  formatRef,
  parseQuery,
  refVerses,
  suggestBooks,
  verseCount,
} from './parser'

/** [the text matched, the reference it means] for every reference found. */
const refs = (text: string) =>
  findReferences(text).map(({ ref, start, end }) => [text.slice(start, end), formatRef(ref)])

/** The single reference in `text`, as a label, or null when there is none. */
const one = (text: string) => {
  const found = refs(text)
  expect(found.length).toBeLessThanOrEqual(1)
  return found[0]?.[1] ?? null
}

describe('the verse counts', () => {
  it('cover 66 books, 1189 chapters and 31102 verses', () => {
    expect(BOOKS).toHaveLength(66)
    const chapters = BOOKS.reduce((sum, book) => sum + chapterCount(book.id), 0)
    let verses = 0
    for (const book of BOOKS) {
      for (let c = 1; c <= chapterCount(book.id); c++) verses += verseCount(book.id, c)
    }
    expect([chapters, verses]).toEqual([1189, 31102])
    expect([chapterCount('PSA'), verseCount('JHN', 3), verseCount('PSA', 119)]).toEqual([
      150, 36, 176,
    ])
  })
})

describe('the formats of the spec', () => {
  it.each([
    ['Ioan 3:16', 'Ioan 3:16'],
    ['Ioan 3:16-18', 'Ioan 3:16-18'],
    ['1 Cor 13:4-7', '1 Corinteni 13:4-7'],
    ['Rom 8:28,31', 'Romani 8:28,31'],
    ['Ioan 3,16', 'Ioan 3:16'],
    ['Ioan 3,16-18', 'Ioan 3:16-18'],
  ])('%s', (text, label) => {
    expect(refs(text)).toEqual([[text, label]])
  })

  it('finds references inside a sentence, with punctuation around them', () => {
    expect(refs('Citește Ioan 3:16, apoi (Rom 8:28) și „Mt 5:3”.')).toEqual([
      ['Ioan 3:16', 'Ioan 3:16'],
      ['Rom 8:28', 'Romani 8:28'],
      ['Mt 5:3', 'Matei 5:3'],
    ])
  })
})

describe('numbered books', () => {
  it.each([
    ['1 Corinteni 13:4', '1 Corinteni 13:4'],
    ['I Corinteni 13:4', '1 Corinteni 13:4'],
    ['II Tim 3:16', '2 Timotei 3:16'],
    ['III Ioan 1:4', '3 Ioan 1:4'],
    ['1Cor 13:4', '1 Corinteni 13:4'],
    ['2Tim 3:16', '2 Timotei 3:16'],
    ['1 In 4:8', '1 Ioan 4:8'],
    ['1 Imparati 3:9', '1 Împărați 3:9'],
    ['2 Cron 7:14', '2 Cronici 7:14'],
    ['1 Pt 2:9', '1 Petru 2:9'],
    ['1 Tes 5:17', '1 Tesaloniceni 5:17'],
  ])('%s', (text, label) => {
    expect(refs(text)).toEqual([[text, label]])
  })

  it('"1 Ioan 4:8" is never "Ioan 4:8", even when the verse does not exist', () => {
    expect(refs('1 Ioan 4:8')).toEqual([['1 Ioan 4:8', '1 Ioan 4:8']])
    // 1 John 4 has 21 verses; John 4:30 exists but must not be found inside it.
    expect(refs('1 Ioan 4:30')).toEqual([])
    expect(refs('II Ioan 1:30')).toEqual([])
  })

  it('a number that does not belong to the book is left out', () => {
    expect(refs('2 Romani 8:28')).toEqual([['Romani 8:28', 'Romani 8:28']])
    expect(refs('4 Ioan 3:16')).toEqual([['Ioan 3:16', 'Ioan 3:16']])
  })

  it('without the number, a numbered-only book is nothing', () => {
    expect(refs('Corinteni 13:4')).toEqual([])
    expect(refs('Samuel 3:10')).toEqual([])
  })

  it('roman numerals are upper case and need a space', () => {
    expect(refs('IICor 3:16')).toEqual([])
    expect(refs('ii Tim 3:16')).toEqual([])
  })
})

describe('Romanian forms and abbreviations', () => {
  it.each([
    ['Fapte 2:38', 'Faptele apostolilor 2:38'],
    ['Faptele apostolilor 2:38', 'Faptele apostolilor 2:38'],
    ['Faptele Apostolilor 2:38', 'Faptele apostolilor 2:38'],
    ['Psalmul 23:1', 'Psalmul 23:1'],
    ['Psalmii 23:1', 'Psalmul 23:1'],
    ['Ps. 23:1', 'Psalmul 23:1'],
    ['Ps 23:1', 'Psalmul 23:1'],
    ['Ps.23:1', 'Psalmul 23:1'],
    ['Mt 5:3', 'Matei 5:3'],
    ['Mt. 5:3', 'Matei 5:3'],
    ['Mc 1:15', 'Marcu 1:15'],
    ['Lc 15:11', 'Luca 15:11'],
    ['In 3:16', 'Ioan 3:16'],
    ['Evr 11:1', 'Evrei 11:1'],
    ['Apoc 21:4', 'Apocalipsa 21:4'],
    ['Gen 1:1', 'Geneza 1:1'],
    ['Ex 20:3', 'Exodul 20:3'],
    ['Is 53:5', 'Isaia 53:5'],
    ['Iov 19:25', 'Iov 19:25'],
    ['Mica 6:8', 'Mica 6:8'],
    ['Prov 3:5-6', 'Proverbe 3:5-6'],
    ['Eclesiastul 3:1', 'Eclesiastul 3:1'],
    ['Cântarea cântărilor 2:4', 'Cântarea cântărilor 2:4'],
    ['Plângerile lui Ieremia 3:22-23', 'Plângerile lui Ieremia 3:22-23'],
    ['Iezechiel 36:26', 'Ezechiel 36:26'],
    ['Țefania 3:17', 'Țefania 3:17'],
    ['Fil 4:13', 'Filipeni 4:13'],
    ['Filim 1:6', 'Filimon 1:6'],
    ['Iuda 1:3', 'Iuda 1:3'],
  ])('%s', (text, label) => {
    expect(refs(text)).toEqual([[text, label]])
  })

  it('accepts names without diacritics or with cedillas, in any case', () => {
    expect(one('Tefania 3:17')).toBe('Țefania 3:17')
    expect(one('Ţefania 3:17')).toBe('Țefania 3:17')
    expect(one('Plangerile 3:22')).toBe('Plângerile lui Ieremia 3:22')
    expect(one('Cantarea cantarilor 2:4')).toBe('Cântarea cântărilor 2:4')
    expect(one('Judecatori 6:12')).toBe('Judecători 6:12')
    expect(one('ioan 3:16')).toBe('Ioan 3:16')
    expect(one('IOAN 3:16')).toBe('Ioan 3:16')
    expect(one('1 cor 13:4')).toBe('1 Corinteni 13:4')
  })

  it('never accepts a diacritic the name does not have', () => {
    expect(refs('Români 8:28')).toEqual([])
    expect(refs('Mică 2:1')).toEqual([])
  })

  it('the forms that are also words need a capital letter', () => {
    for (const text of ['in 3:16', 'IN 3:16', 'is 53:5', 'mica 6:8', 'gen 1:1', 'ex 20:3']) {
      expect(refs(text), text).toEqual([])
    }
    expect(refs('de ex. 2:1')).toEqual([])
    expect(refs('fapte 2:38')).toEqual([])
    expect(refs('iOS 17.2 și IOS 16.4')).toEqual([])
  })
})

describe('separators, ranges and lists', () => {
  it.each([
    ['1 Corinteni 13:4–7', '1 Corinteni 13:4-7'],
    ['1 Corinteni 13:4—7', '1 Corinteni 13:4-7'],
    ['1 Corinteni 13:4 – 7', '1 Corinteni 13:4-7'],
    ['1 Corinteni 13:4 - 7', '1 Corinteni 13:4-7'],
    ['Ioan 3.16', 'Ioan 3:16'],
    ['Ioan 3.16-18', 'Ioan 3:16-18'],
    ['Rom 8:28, 31', 'Romani 8:28,31'],
    ['Ioan 3:16-18,20', 'Ioan 3:16-18,20'],
    ['Ioan 3,16,17', 'Ioan 3:16,17'],
    ['Matei 5:1-7:29', 'Matei 5:1-7:29'],
    ['Ioan 3:16\u00a0-\u00a018', 'Ioan 3:16-18'],
    ['Ioan\u00a03:16', 'Ioan 3:16'],
  ])('%s', (text, label) => {
    expect(refs(text)).toEqual([[text, label]])
  })

  it('a list or a range stops where the next reference starts', () => {
    expect(refs('Ioan 3:16, 1 Ioan 4:8')).toEqual([
      ['Ioan 3:16', 'Ioan 3:16'],
      ['1 Ioan 4:8', '1 Ioan 4:8'],
    ])
    expect(refs('Rom 8:28,1 Cor 13:4')).toEqual([
      ['Rom 8:28', 'Romani 8:28'],
      ['1 Cor 13:4', '1 Corinteni 13:4'],
    ])
    expect(refs('Ioan 3:16 - 2 Cor 5:17')).toEqual([
      ['Ioan 3:16', 'Ioan 3:16'],
      ['2 Cor 5:17', '2 Corinteni 5:17'],
    ])
  })

  it('a dot or a comma followed by a space ends the reference', () => {
    expect(refs('Am citit Ioan 3:16. Apoi')).toEqual([['Ioan 3:16', 'Ioan 3:16']])
    expect(refs('Ioan 3. 16')).toEqual([])
    expect(refs('Ioan 3, 16')).toEqual([])
  })

  it('stops before more digits or letters that would change the meaning', () => {
    expect(refs('Ioan 3:16a')).toEqual([])
    expect(refs('Ioan 3:16:2')).toEqual([])
    expect(refs('Ioan 3.16.2')).toEqual([])
    expect(refs('Ioan 3:1234')).toEqual([])
    expect(refs('Ioana 3:16')).toEqual([])
    expect(refs('xIoan 3:16')).toEqual([])
    expect(refs('Ioan3:16')).toEqual([])
  })
})

describe('chapters and verses must exist', () => {
  it.each(['Ioan 99:1', 'Ioan 3:99', 'Ioan 3:18-16', 'Ioan 0:1', 'Ioan 3:0', 'Psalmul 151:1'])(
    '%s',
    (text) => {
      expect(refs(text)).toEqual([])
    },
  )

  it('a range across chapters checks both ends', () => {
    expect(refs('Matei 5:1-29:1')).toEqual([])
    expect(refs('Matei 5:1-7:30')).toEqual([])
    expect(refs('Matei 7:1-5:29')).toEqual([])
  })

  it('never takes times or plain numbers for references', () => {
    expect(refs('La ora 10:30 ne vedem, De fapt 10:30 e prea devreme. Am 7:10 minute.')).toEqual([])
  })
})

describe('whole chapters', () => {
  it.each([
    ['Psalmul 23', 'Psalmul 23'],
    ['Psalmii 23', 'Psalmul 23'],
    ['Romani 8', 'Romani 8'],
    ['Evrei 11', 'Evrei 11'],
    ['Apocalipsa 21', 'Apocalipsa 21'],
    ['Geneza 1', 'Geneza 1'],
    ['Faptele apostolilor 2', 'Faptele apostolilor 2'],
    ['1 Corinteni 13', '1 Corinteni 13'],
    ['I Corinteni 13', '1 Corinteni 13'],
    ['1Corinteni 13', '1 Corinteni 13'],
    ['1 Ioan 4', '1 Ioan 4'],
    ['2 Timotei 3', '2 Timotei 3'],
  ])('%s', (text, label) => {
    expect(refs(text)).toEqual([[text, label]])
  })

  it('a chapter in a sentence, with a colon after it', () => {
    expect(refs('Psalmul 23: Domnul este păstorul meu.')).toEqual([['Psalmul 23', 'Psalmul 23']])
    expect(refs('Am citit Romani 8 și Evrei 11.')).toEqual([
      ['Romani 8', 'Romani 8'],
      ['Evrei 11', 'Evrei 11'],
    ])
  })

  it('not for books named after a person', () => {
    for (const text of [
      'Ioan 3',
      'Luca 15',
      'Marcu 4',
      'Matei 5',
      'Iacov 1',
      'Iuda 1',
      'Daniel 3',
      'Iov 38',
      'Isaia 53',
      'Iosua 1',
      'Rut 1',
      'Estera 4',
      'Iona 2',
      'Mica 6',
      'Tit 2',
      'Filimon 1',
    ]) {
      expect(refs(text), text).toEqual([])
    }
  })

  it('not with abbreviations, short forms or a lower-case name', () => {
    for (const text of [
      'Ps 23',
      'Ps. 23',
      'Rom 8',
      'Evr 11',
      'Apoc 21',
      '1 Cor 13',
      '1 In 4',
      'Fapte 2',
      'psalmul 23',
      'romani 8',
      'evrei 11',
      '1 corinteni 13',
    ]) {
      expect(refs(text), text).toEqual([])
    }
  })

  it('not when the chapter does not exist or a range of chapters follows', () => {
    expect(refs('Psalmul 151')).toEqual([])
    expect(refs('Romani 17')).toEqual([])
    expect(refs('3 Ioan 4')).toEqual([])
    expect(refs('Evrei 11-12')).toEqual([])
    expect(refs('Evrei 11 – 12')).toEqual([])
    expect(refs('Romani 8a')).toEqual([])
  })

  it('a verse that does not exist is not a chapter link either', () => {
    expect(refs('Romani 8:40')).toEqual([])
  })
})

describe('the verses of a reference', () => {
  it('lists every verse in the order written', () => {
    const verses = (text: string) =>
      refVerses(findReferences(text)[0]?.ref ?? { book: '', chapter: 0, spans: [] }).map(
        (v) => `${v.chapter}:${v.verse}`,
      )
    expect(verses('Ioan 3:16-18,20')).toEqual(['3:16', '3:17', '3:18', '3:20'])
    expect(verses('Matei 5:47-6:2')).toEqual(['5:47', '5:48', '6:1', '6:2'])
    expect(verses('Psalmul 23')).toHaveLength(6)
  })
})

describe('the "Verset" dialog', () => {
  it.each([
    ['ioan 3 16', 'Ioan 3:16'],
    ['Ioan 3:16', 'Ioan 3:16'],
    ['ioan 3', 'Ioan 3'],
    ['luca 15', 'Luca 15'],
    ['ps 23', 'Psalmul 23'],
    ['in 3:16', 'Ioan 3:16'],
    ['1 cor 13', '1 Corinteni 13'],
    ['1cor 13 4-7', '1 Corinteni 13:4-7'],
    ['  rom 8:28,31  ', 'Romani 8:28,31'],
  ])('%s', (text, label) => {
    const ref = parseQuery(text)
    expect(ref && formatRef(ref)).toBe(label)
  })

  it('anything else, or a chapter that does not exist, is nothing', () => {
    for (const text of ['', 'ioan', 'ioan 22', 'ioan 3:99', 'ioan 3:16 și', 'Corinteni 13']) {
      expect(parseQuery(text), text).toBeNull()
    }
  })

  it('suggests books while the name is typed', () => {
    const names = (text: string) => suggestBooks(text).map((b) => `${b.number ?? ''}${b.id}`)
    expect(names('co')).toEqual(['11CO', '22CO', 'COL'])
    expect(names('1 co')).toEqual(['11CO'])
    expect(names('ii t')).toEqual(['22TH', '22TI'])
    expect(names('ps')).toEqual(['PSA'])
    expect(names('ioan 3')).toEqual([])
    expect(names('')).toEqual([])
  })
})

describe('the book table', () => {
  it('every name and abbreviation is found as itself', () => {
    for (const book of BOOKS) {
      for (const form of [...book.names, ...book.abbreviations]) {
        const written = `${book.number ? `${book.number} ` : ''}${form} 1:1`
        expect(findReferences(written)[0]?.ref.book, written).toBe(book.id)
      }
    }
  })
})
