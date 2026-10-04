/**
 * Every user-facing string of the app, in Romanian.
 * Components import `t` and never contain literal UI text.
 */
export const ro = {
  app: {
    name: 'BibleNote',
    tagline: 'Notițe pentru studiul Bibliei',
  },
  nav: {
    main: 'Navigare principală',
    folders: 'Foldere',
    search: 'Căutare',
    tags: 'Etichete',
    settings: 'Setări',
  },
  folders: {
    title: 'Foldere',
    empty: 'Niciun folder încă. Creează primul folder ca să începi.',
  },
  search: {
    title: 'Căutare',
    empty: 'Caută în titluri, conținut, etichete și nume de fișiere. Merge și offline.',
  },
  tags: {
    title: 'Etichete',
    empty: 'Etichetele notițelor tale vor apărea aici.',
  },
  settings: {
    title: 'Setări',
    version: 'Versiune',
  },
  pwa: {
    updateTitle: 'E disponibilă o versiune nouă.',
    reload: 'Reîncarcă',
    later: 'Mai târziu',
  },
  notFound: {
    title: 'Pagina asta nu există.',
    back: 'Înapoi la foldere',
  },
} as const

export const t = ro
