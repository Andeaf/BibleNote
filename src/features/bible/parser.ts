import { BOOKS, referenceName, type BookInfo } from './books'
import counts from './verseCounts.json'

/**
 * Bible references in free text. Pure, no dependencies besides the book
 * table and the verse counts.
 *
 * Recognised in notes (`findReferences`):
 * - `Carte C:V`, `C:V-V`, `C:V,V` (lists and ranges mixed), `C:V-C:V` (across chapters);
 *   ranges with a hyphen or a dash (–, —), with or without spaces around it;
 * - `C,V` (a comma instead of the colon) and `C.V` (a dot directly followed by the verse);
 * - numbered books as "1 Ioan", "1Ioan", "I Ioan", "II Tim" ("1 Ioan 4:8" is never "Ioan 4:8");
 * - a whole chapter only after a full name, of a book not named after a person or of a numbered
 *   book, written with a capital letter: "Psalmul 23", "Romani 8", "1 Corinteni 13";
 * - every chapter and verse is checked against the text: "Ioan 99:1" is not a reference.
 * Names and abbreviations are matched without regard to case and diacritics, except the forms
 * that are also ordinary words ("In", "Is", "Mica"…), which need a capital first letter.
 */

export interface VersePoint {
  chapter: number
  verse: number
}

export interface VerseSpan {
  from: VersePoint
  to: VersePoint
}

export interface BibleRef {
  /** Book id (BookInfo.id). */
  book: string
  chapter: number
  /** The verses in the order written; null for the whole chapter. */
  spans: VerseSpan[] | null
}

export interface FoundRef {
  ref: BibleRef
  /** Offsets in the text: [start, end). */
  start: number
  end: number
}

const VERSE_COUNTS = counts as Record<string, number[]>

const DIACRITICS: Record<string, string> = {
  ă: 'a',
  â: 'a',
  î: 'i',
  ș: 's',
  ş: 's',
  ț: 't',
  ţ: 't',
}

/** Lower case, without diacritics, single spaces: the lookup key of a written name. */
export function foldName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ăâîșşțţ]/g, (char) => DIACRITICS[char] ?? char)
    .replace(/\s+/g, ' ')
    .trim()
}

/** A form as a regex: each diacritic may be left out, ș/ț may come with a cedilla. */
function formPattern(form: string): string {
  const classes: Record<string, string> = {
    ă: '[ăa]',
    â: '[âa]',
    î: '[îi]',
    ș: '[șşs]',
    ț: '[țţt]',
    ' ': '[ \\u00a0]+',
  }
  return [...form.toLowerCase()]
    .map((char) => classes[char] ?? char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('')
}

interface Form {
  book: BookInfo
  full: boolean
  titleCase: boolean
}

/** `${number}|${folded form}` → the book it names (number 0: not numbered). */
const FORMS = new Map<string, Form>()
for (const book of BOOKS) {
  const strict = new Set((book.titleCase ?? []).map(foldName))
  const add = (form: string, full: boolean) => {
    const key = `${book.number ?? 0}|${foldName(form)}`
    if (FORMS.has(key)) throw new Error(`Bible form "${key}" is used twice`)
    FORMS.set(key, { book, full, titleCase: strict.has(foldName(form)) })
  }
  book.names.forEach((name) => add(name, true))
  book.abbreviations.forEach((abbreviation) => add(abbreviation, false))
}

const BOOK_BY_ID = new Map(BOOKS.map((book) => [book.id, book]))

const ALTERNATION = [
  ...new Set(BOOKS.flatMap((book) => [...book.names, ...book.abbreviations]).map(formPattern)),
]
  // Longer forms first: "Psalmul" before "Ps", "Faptele apostolilor" before "Faptele".
  .sort((a, b) => b.length - a.length)
  .join('|')

/** An optional number (1–3, or I–III followed by a space), a name, an optional dot. */
const NAME_SOURCE = `(?:([1-3])[ \\u00a0]?|(III|II|I)[ \\u00a0])?(${ALTERNATION})(?!\\p{L})(\\.)?`

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9'
const isSpace = (char: string | undefined) => char === ' ' || char === '\u00a0'
const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)
const isDash = (char: string | undefined) => char !== undefined && /[-‐-—]/.test(char)
const isUpper = (char: string) => char !== char.toLowerCase() && char === char.toUpperCase()

export function bookById(id: string): BookInfo | undefined {
  return BOOK_BY_ID.get(id)
}

export function chapterCount(bookId: string): number {
  return VERSE_COUNTS[bookId]?.length ?? 0
}

export function verseCount(bookId: string, chapter: number): number {
  return VERSE_COUNTS[bookId]?.[chapter - 1] ?? 0
}

interface NameMatch {
  form: Form
  /** Where the number (or the name) starts, where the name starts, and where the match ends. */
  start: number
  nameStart: number
  end: number
  dot: boolean
}

/**
 * The book name at `match`, resolved with its number. `retryAt` is set when the number does not
 * belong to the name ("2 Romani"): the caller looks again from the name.
 */
function resolveName(
  match: RegExpExecArray,
  strict: boolean,
): { name: NameMatch } | { retryAt: number } | null {
  const [whole, arabic, roman, written = '', dot] = match
  const start = match.index
  const nameStart = start + whole.length - written.length - (dot ? 1 : 0)
  let number = 0
  if (arabic) number = Number(arabic)
  else if (roman) {
    if (strict && roman !== roman.toUpperCase()) return { retryAt: nameStart }
    number = roman.length
  }
  const form = FORMS.get(`${number}|${foldName(written)}`)
  if (!form) return number ? { retryAt: nameStart } : null
  if (strict && form.titleCase) {
    const [first = '', ...rest] = written
    if (!isUpper(first) || rest.join('') !== rest.join('').toLowerCase()) return null
  }
  return { name: { form, start, nameStart, end: start + whole.length, dot: Boolean(dot) } }
}

/** Reads 1–3 digits at `i` (not followed by another digit). */
function readNumber(text: string, i: number): { value: number; end: number } | null {
  let end = i
  while (isDigit(text[end]) && end - i < 3) end++
  if (end === i || isDigit(text[end])) return null
  return { value: Number(text.slice(i, end)), end }
}

/** Book names anywhere (`findReferences`) and at a given position (sticky). */
const nameSearch = new RegExp(NAME_SOURCE, 'giu')
const nameAt = new RegExp(NAME_SOURCE, 'iuy')

/** A numbered book starts at `i` ("…3:16, 1 Ioan 4:8"): the number is not a verse. */
function bookStartsAt(text: string, i: number): boolean {
  nameAt.lastIndex = i
  const match = nameAt.exec(text)
  if (!match || (!match[1] && !match[2])) return false
  const resolved = resolveName(match, false)
  return resolved !== null && 'name' in resolved
}

interface Numbers {
  chapter: number
  spans: VerseSpan[] | null
  end: number
}

/**
 * The chapter and verses after a book name, from `i`. Strict (notes): a space or a dot after
 * the name, `:` `.` `,` between chapter and verse. Lenient (the "Verset" dialog): a space works
 * too, and the name may touch the number.
 */
function readNumbers(text: string, i: number, dot: boolean, lenient: boolean): Numbers | null {
  let at = i
  while (isSpace(text[at])) at++
  if (at === i && !dot && !lenient) return null
  const chapter = readNumber(text, at)
  if (!chapter) return null
  at = chapter.end

  let separator: string | null = null
  const next = text[at]
  if ((next === ':' || next === '.' || next === ',') && isDigit(text[at + 1])) separator = next
  else if (lenient && isSpace(next)) {
    let j = at
    while (isSpace(text[j])) j++
    if (isDigit(text[j])) separator = ' '
  }
  if (!separator) return { chapter: chapter.value, spans: null, end: at }

  at += 1
  while (separator === ' ' && isSpace(text[at])) at++
  const spans: VerseSpan[] = []
  let first = true
  for (;;) {
    const verse = readNumber(text, at)
    if (!verse) return null
    let span: VerseSpan = {
      from: { chapter: chapter.value, verse: verse.value },
      to: { chapter: chapter.value, verse: verse.value },
    }
    at = verse.end

    // A range: "16-18", "4 – 7", or across chapters "5:1-7:29" (alone, never in a list).
    let j = at
    while (isSpace(text[j])) j++
    if (isDash(text[j])) {
      j++
      while (isSpace(text[j])) j++
      const end = isDigit(text[j]) && !bookStartsAt(text, j) ? readNumber(text, j) : null
      if (end) {
        const across =
          first && (separator === ':' || separator === '.') && text[end.end] === separator
            ? readNumber(text, end.end + 1)
            : null
        if (across) {
          span = { from: span.from, to: { chapter: end.value, verse: across.value } }
          spans.push(span)
          return { chapter: chapter.value, spans, end: across.end }
        }
        span = { from: span.from, to: { chapter: chapter.value, verse: end.value } }
        at = end.end
      }
    }
    spans.push(span)
    first = false

    // A list: ",31" or ", 31", unless a numbered book starts there.
    if (text[at] !== ',') break
    let k = at + 1
    if (isSpace(text[k])) k++
    if (!isDigit(text[k]) || bookStartsAt(text, k)) break
    at = k
  }
  return { chapter: chapter.value, spans, end: at }
}

function valid(bookId: string, chapter: number, spans: VerseSpan[] | null): boolean {
  const chapters = chapterCount(bookId)
  if (chapter < 1 || chapter > chapters) return false
  for (const { from, to } of spans ?? []) {
    if (to.chapter < from.chapter || to.chapter > chapters) return false
    if (from.verse < 1 || from.verse > verseCount(bookId, from.chapter)) return false
    if (to.verse < 1 || to.verse > verseCount(bookId, to.chapter)) return false
    if (to.chapter === from.chapter && to.verse < from.verse) return false
  }
  return true
}

/** Every reference in `text`, in order. */
export function findReferences(text: string): FoundRef[] {
  const found: FoundRef[] = []
  if (!/\d/.test(text)) return found
  const re = nameSearch
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const start = match.index
    // The name must start a word: "Ioana", "x1 Ioan" are not references.
    if (isWordChar(text[start - 1])) {
      re.lastIndex = start + 1
      continue
    }
    const resolved = resolveName(match, true)
    if (!resolved) {
      re.lastIndex = start + match[0].length
      continue
    }
    if ('retryAt' in resolved) {
      re.lastIndex = resolved.retryAt
      continue
    }
    const { name } = resolved
    // Only abbreviations take a dot: "Ps. 23:1", never "Ioan. 3:16".
    if (name.dot && name.form.full) {
      re.lastIndex = name.end
      continue
    }
    const numbers = readNumbers(text, name.end, name.dot, false)
    // Skipped whole when invalid: "1 Ioan 4:30" never falls back to "Ioan 4:30".
    re.lastIndex = numbers?.end ?? name.end
    if (!numbers) continue
    const after = text[numbers.end]
    if (isWordChar(after)) continue
    if ((after === ':' || after === '.') && isDigit(text[numbers.end + 1])) continue
    if (!numbers.spans) {
      // A whole chapter: full name, a book that allows it, capital letter, no chapter range.
      if (!name.form.full || !name.form.book.chapterLinks) continue
      if (!isUpper(text[name.nameStart] ?? '')) continue
      let j = numbers.end
      while (isSpace(text[j])) j++
      if (isDash(text[j])) {
        j++
        while (isSpace(text[j])) j++
        if (isDigit(text[j])) continue
      }
    }
    const bookId = name.form.book.id
    if (!valid(bookId, numbers.chapter, numbers.spans)) continue
    found.push({
      ref: { book: bookId, chapter: numbers.chapter, spans: numbers.spans },
      start: name.start,
      end: numbers.end,
    })
  }
  return found
}

/**
 * The "Verset" dialog: the whole input is one reference, written loosely. Any name or
 * abbreviation, any case, a chapter alone for every book, a space between chapter and verse
 * ("ioan 3 16").
 */
export function parseQuery(input: string): BibleRef | null {
  const text = input.trim()
  nameAt.lastIndex = 0
  const match = nameAt.exec(text)
  const resolved = match ? resolveName(match, false) : null
  if (!resolved || 'retryAt' in resolved) return null
  const { name } = resolved
  const numbers = readNumbers(text, name.end, name.dot, true)
  if (!numbers || numbers.end !== text.length) return null
  const bookId = name.form.book.id
  if (!valid(bookId, numbers.chapter, numbers.spans)) return null
  return { book: bookId, chapter: numbers.chapter, spans: numbers.spans }
}

/** Books whose name or abbreviation starts with what was typed ("1 co" → 1 Corinteni). */
export function suggestBooks(input: string, limit = 8): BookInfo[] {
  const typed = /^(?:([1-3]) ?|(iii|ii|i) )?([^\d]*)$/.exec(foldName(input))
  if (!typed) return []
  const [, arabic, roman, rest = ''] = typed
  const number = arabic ? Number(arabic) : (roman?.length ?? 0)
  if (!number && !rest) return []
  const out: BookInfo[] = []
  for (const book of BOOKS) {
    if (number && book.number !== number) continue
    const forms = [...book.names, ...book.abbreviations].map(foldName)
    if (forms.some((form) => form.startsWith(rest))) out.push(book)
    if (out.length >= limit) break
  }
  return out
}

/** "Ioan 3:16-18,20", "Matei 5:1-7:29", "Psalmul 23". */
export function formatRef(ref: BibleRef): string {
  const book = bookById(ref.book)
  const name = book ? referenceName(book) : ref.book
  if (!ref.spans) return `${name} ${ref.chapter}`
  const parts = ref.spans.map(({ from, to }) => {
    if (to.chapter !== from.chapter) return `${from.verse}-${to.chapter}:${to.verse}`
    return to.verse === from.verse ? `${from.verse}` : `${from.verse}-${to.verse}`
  })
  return `${name} ${ref.chapter}:${parts.join(',')}`
}

/** Every verse of the reference, in the order written (a whole chapter: all its verses). */
export function refVerses(ref: BibleRef): VersePoint[] {
  if (!ref.spans) {
    const total = verseCount(ref.book, ref.chapter)
    return Array.from({ length: total }, (_, i) => ({ chapter: ref.chapter, verse: i + 1 }))
  }
  const out: VersePoint[] = []
  for (const { from, to } of ref.spans) {
    for (let chapter = from.chapter; chapter <= to.chapter; chapter++) {
      const first = chapter === from.chapter ? from.verse : 1
      const last = chapter === to.chapter ? to.verse : verseCount(ref.book, chapter)
      for (let verse = first; verse <= last; verse++) out.push({ chapter, verse })
    }
  }
  return out
}
