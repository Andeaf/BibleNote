/**
 * The 66 books of the Romanian Corrected Cornilescu Version, in order, with the names and
 * abbreviations the reference parser recognises (docs/PLAN.md §5.9). No imports: the build
 * script (`scripts/build-bible.ts`) reads this file too and checks every name against the
 * source.
 *
 * Forms are written with their diacritics; the parser also accepts them without diacritics
 * and with ş/ţ (cedilla), never with a diacritic the name does not have ("Români" is not
 * "Romani"). Numbered books list their names without the number: "1 Corinteni" is
 * `{ number: 1, names: ['Corinteni'] }`.
 */
export interface BookInfo {
  /** USFX id, also the file name: public/bible/rccv/<id>.json. */
  id: string
  /** 1–3 for numbered books ("1 Corinteni", "I Corinteni", "1Cor"). */
  number?: number
  /** The title in the source, without the number. */
  name: string
  /** The name used in references when it differs from the title: "Psalmul 23". */
  refName?: string
  /** Full names, recognised in references and, where allowed, for whole chapters. */
  names: string[]
  /** Short forms: recognised only with a chapter and a verse ("Mt 5:3"). */
  abbreviations: string[]
  /**
   * Forms that are also ordinary words ("in", "mica", "gen"): recognised only when written
   * with a capital first letter and the rest in lower case ("In 3:16", not "in 3:16").
   */
  titleCase?: string[]
  /**
   * A full name followed by a chapter alone links the whole chapter ("Psalmul 23"). Not for
   * books named after a person ("Ioan 3", "Luca 15"); always for numbered books.
   */
  chapterLinks: boolean
}

export const BOOKS: readonly BookInfo[] = [
  // Old Testament
  {
    id: 'GEN',
    name: 'Geneza',
    names: ['Geneza'],
    abbreviations: ['Gen'],
    titleCase: ['Gen'],
    chapterLinks: true,
  },
  {
    id: 'EXO',
    name: 'Exodul',
    names: ['Exodul', 'Exod'],
    abbreviations: ['Ex'],
    titleCase: ['Ex'],
    chapterLinks: true,
  },
  {
    id: 'LEV',
    name: 'Leviticul',
    names: ['Leviticul', 'Levitic'],
    abbreviations: ['Lev'],
    titleCase: ['Lev'],
    chapterLinks: true,
  },
  {
    id: 'NUM',
    name: 'Numeri',
    names: ['Numeri', 'Numerii'],
    abbreviations: ['Num'],
    chapterLinks: true,
  },
  {
    id: 'DEU',
    name: 'Deuteronomul',
    names: ['Deuteronomul', 'Deuteronom'],
    abbreviations: ['Deut', 'Dt'],
    chapterLinks: true,
  },
  {
    id: 'JOS',
    name: 'Iosua',
    names: ['Iosua'],
    abbreviations: ['Ios'],
    titleCase: ['Ios'],
    chapterLinks: false,
  },
  {
    id: 'JDG',
    name: 'Judecători',
    names: ['Judecătorii', 'Judecători'],
    abbreviations: ['Jud'],
    titleCase: ['Jud'],
    chapterLinks: true,
  },
  {
    id: 'RUT',
    name: 'Rut',
    names: ['Rut'],
    abbreviations: [],
    titleCase: ['Rut'],
    chapterLinks: false,
  },
  {
    id: '1SA',
    number: 1,
    name: 'Samuel',
    names: ['Samuel'],
    abbreviations: ['Sam'],
    chapterLinks: true,
  },
  {
    id: '2SA',
    number: 2,
    name: 'Samuel',
    names: ['Samuel'],
    abbreviations: ['Sam'],
    chapterLinks: true,
  },
  {
    id: '1KI',
    number: 1,
    name: 'Împărați',
    names: ['Împărați'],
    abbreviations: ['Împ'],
    chapterLinks: true,
  },
  {
    id: '2KI',
    number: 2,
    name: 'Împărați',
    names: ['Împărați'],
    abbreviations: ['Împ'],
    chapterLinks: true,
  },
  {
    id: '1CH',
    number: 1,
    name: 'Cronici',
    names: ['Cronici'],
    abbreviations: ['Cron', 'Cr'],
    chapterLinks: true,
  },
  {
    id: '2CH',
    number: 2,
    name: 'Cronici',
    names: ['Cronici'],
    abbreviations: ['Cron', 'Cr'],
    chapterLinks: true,
  },
  { id: 'EZR', name: 'Ezra', names: ['Ezra'], abbreviations: ['Ezr'], chapterLinks: false },
  { id: 'NEH', name: 'Neemia', names: ['Neemia'], abbreviations: ['Neem'], chapterLinks: false },
  {
    id: 'EST',
    name: 'Estera',
    names: ['Estera'],
    abbreviations: ['Est'],
    titleCase: ['Est'],
    chapterLinks: false,
  },
  {
    id: 'JOB',
    name: 'Iov',
    names: ['Iov'],
    abbreviations: [],
    titleCase: ['Iov'],
    chapterLinks: false,
  },
  {
    id: 'PSA',
    name: 'Psalmii',
    refName: 'Psalmul',
    names: ['Psalmii', 'Psalmul', 'Psalmi', 'Psalm'],
    abbreviations: ['Ps'],
    chapterLinks: true,
  },
  {
    id: 'PRO',
    name: 'Proverbe',
    names: ['Proverbele', 'Proverbe'],
    abbreviations: ['Prov'],
    chapterLinks: true,
  },
  {
    id: 'ECC',
    name: 'Eclesiastul',
    names: ['Eclesiastul', 'Eclesiast'],
    abbreviations: ['Ecl'],
    chapterLinks: true,
  },
  {
    id: 'SNG',
    name: 'Cântarea cântărilor',
    names: ['Cântarea cântărilor'],
    abbreviations: ['Cânt'],
    titleCase: ['Cânt'],
    chapterLinks: true,
  },
  {
    id: 'ISA',
    name: 'Isaia',
    names: ['Isaia'],
    abbreviations: ['Is'],
    titleCase: ['Is'],
    chapterLinks: false,
  },
  { id: 'JER', name: 'Ieremia', names: ['Ieremia'], abbreviations: ['Ier'], chapterLinks: false },
  {
    id: 'LAM',
    name: 'Plângerile lui Ieremia',
    names: ['Plângerile lui Ieremia', 'Plângerile', 'Plângeri'],
    abbreviations: ['Plâng'],
    titleCase: ['Plâng'],
    chapterLinks: true,
  },
  {
    id: 'EZK',
    name: 'Ezechiel',
    names: ['Ezechiel', 'Iezechiel'],
    abbreviations: ['Ezec', 'Ez'],
    chapterLinks: false,
  },
  { id: 'DAN', name: 'Daniel', names: ['Daniel'], abbreviations: ['Dan'], chapterLinks: false },
  {
    id: 'HOS',
    name: 'Osea',
    names: ['Osea'],
    abbreviations: ['Os'],
    titleCase: ['Os'],
    chapterLinks: false,
  },
  { id: 'JOL', name: 'Ioel', names: ['Ioel'], abbreviations: [], chapterLinks: false },
  { id: 'AMO', name: 'Amos', names: ['Amos'], abbreviations: [], chapterLinks: false },
  {
    id: 'OBA',
    name: 'Obadia',
    names: ['Obadia'],
    abbreviations: ['Obad', 'Ob'],
    chapterLinks: false,
  },
  { id: 'JON', name: 'Iona', names: ['Iona'], abbreviations: [], chapterLinks: false },
  {
    id: 'MIC',
    name: 'Mica',
    names: ['Mica'],
    abbreviations: [],
    titleCase: ['Mica'],
    chapterLinks: false,
  },
  { id: 'NAM', name: 'Naum', names: ['Naum'], abbreviations: [], chapterLinks: false },
  { id: 'HAB', name: 'Habacuc', names: ['Habacuc'], abbreviations: ['Hab'], chapterLinks: false },
  { id: 'ZEP', name: 'Țefania', names: ['Țefania'], abbreviations: ['Țef'], chapterLinks: false },
  { id: 'HAG', name: 'Hagai', names: ['Hagai'], abbreviations: ['Hag'], chapterLinks: false },
  { id: 'ZEC', name: 'Zaharia', names: ['Zaharia'], abbreviations: ['Zah'], chapterLinks: false },
  {
    id: 'MAL',
    name: 'Maleahi',
    names: ['Maleahi'],
    abbreviations: ['Mal'],
    titleCase: ['Mal'],
    chapterLinks: false,
  },
  // New Testament
  {
    id: 'MAT',
    name: 'Matei',
    names: ['Matei'],
    abbreviations: ['Mat', 'Mt'],
    titleCase: ['Mat'],
    chapterLinks: false,
  },
  {
    id: 'MRK',
    name: 'Marcu',
    names: ['Marcu'],
    abbreviations: ['Marc', 'Mc'],
    chapterLinks: false,
  },
  { id: 'LUK', name: 'Luca', names: ['Luca'], abbreviations: ['Luc', 'Lc'], chapterLinks: false },
  {
    id: 'JHN',
    name: 'Ioan',
    names: ['Ioan'],
    abbreviations: ['In'],
    titleCase: ['In'],
    chapterLinks: false,
  },
  {
    id: 'ACT',
    name: 'Faptele apostolilor',
    names: ['Faptele apostolilor', 'Faptele'],
    // "Fapt." is the form of the Cornilescu editions with cross-references. With a capital only:
    // "de fapt 10:30" ("in fact, 10:30") must stay text.
    abbreviations: ['Fapte', 'Fapt', 'Fap'],
    titleCase: ['Fapte', 'Fapt'],
    chapterLinks: true,
  },
  { id: 'ROM', name: 'Romani', names: ['Romani'], abbreviations: ['Rom'], chapterLinks: true },
  {
    id: '1CO',
    number: 1,
    name: 'Corinteni',
    names: ['Corinteni'],
    abbreviations: ['Cor'],
    chapterLinks: true,
  },
  {
    id: '2CO',
    number: 2,
    name: 'Corinteni',
    names: ['Corinteni'],
    abbreviations: ['Cor'],
    chapterLinks: true,
  },
  { id: 'GAL', name: 'Galateni', names: ['Galateni'], abbreviations: ['Gal'], chapterLinks: true },
  {
    id: 'EPH',
    name: 'Efeseni',
    names: ['Efeseni'],
    abbreviations: ['Efes', 'Ef'],
    chapterLinks: true,
  },
  {
    id: 'PHP',
    name: 'Filipeni',
    names: ['Filipeni'],
    abbreviations: ['Filip', 'Fil'],
    chapterLinks: true,
  },
  { id: 'COL', name: 'Coloseni', names: ['Coloseni'], abbreviations: ['Col'], chapterLinks: true },
  {
    id: '1TH',
    number: 1,
    name: 'Tesaloniceni',
    names: ['Tesaloniceni'],
    abbreviations: ['Tes'],
    chapterLinks: true,
  },
  {
    id: '2TH',
    number: 2,
    name: 'Tesaloniceni',
    names: ['Tesaloniceni'],
    abbreviations: ['Tes'],
    chapterLinks: true,
  },
  {
    id: '1TI',
    number: 1,
    name: 'Timotei',
    names: ['Timotei'],
    abbreviations: ['Tim'],
    chapterLinks: true,
  },
  {
    id: '2TI',
    number: 2,
    name: 'Timotei',
    names: ['Timotei'],
    abbreviations: ['Tim'],
    chapterLinks: true,
  },
  { id: 'TIT', name: 'Tit', names: ['Tit'], abbreviations: [], chapterLinks: false },
  {
    id: 'PHM',
    name: 'Filimon',
    names: ['Filimon'],
    abbreviations: ['Filim', 'Flm'],
    chapterLinks: false,
  },
  { id: 'HEB', name: 'Evrei', names: ['Evrei'], abbreviations: ['Evr'], chapterLinks: true },
  { id: 'JAS', name: 'Iacov', names: ['Iacov'], abbreviations: ['Iac'], chapterLinks: false },
  {
    id: '1PE',
    number: 1,
    name: 'Petru',
    names: ['Petru'],
    abbreviations: ['Pet', 'Pt'],
    chapterLinks: true,
  },
  {
    id: '2PE',
    number: 2,
    name: 'Petru',
    names: ['Petru'],
    abbreviations: ['Pet', 'Pt'],
    chapterLinks: true,
  },
  {
    id: '1JN',
    number: 1,
    name: 'Ioan',
    names: ['Ioan'],
    abbreviations: ['In'],
    titleCase: ['In'],
    chapterLinks: true,
  },
  {
    id: '2JN',
    number: 2,
    name: 'Ioan',
    names: ['Ioan'],
    abbreviations: ['In'],
    titleCase: ['In'],
    chapterLinks: true,
  },
  {
    id: '3JN',
    number: 3,
    name: 'Ioan',
    names: ['Ioan'],
    abbreviations: ['In'],
    titleCase: ['In'],
    chapterLinks: true,
  },
  { id: 'JUD', name: 'Iuda', names: ['Iuda'], abbreviations: ['Iud'], chapterLinks: false },
  {
    id: 'REV',
    name: 'Apocalipsa',
    names: ['Apocalipsa'],
    abbreviations: ['Apoc'],
    chapterLinks: true,
  },
]

/** "1 Corinteni", "Psalmii": the title of the book, with its number. */
export function displayName(book: BookInfo): string {
  return book.number ? `${book.number} ${book.name}` : book.name
}

/** The name written in references: "Psalmul 23:1", "1 Corinteni 13:4". */
export function referenceName(book: BookInfo): string {
  const name = book.refName ?? book.name
  return book.number ? `${book.number} ${name}` : name
}
