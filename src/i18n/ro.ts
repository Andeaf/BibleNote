/**
 * Every user-facing string of the app, in Romanian.
 * Components import `t` and never contain literal UI text.
 */
export const ro = {
  app: {
    name: 'BibleNote',
    tagline: 'Notițe pentru studiul Bibliei',
  },
  common: {
    loading: 'Se încarcă…',
  },
  config: {
    missingTitle: 'Aplicația nu e configurată.',
    missingHint: 'Lipsesc variabilele de mediu pentru Supabase. Vezi docs/SETUP.md.',
  },
  nav: {
    main: 'Navigare principală',
    folders: 'Foldere',
    search: 'Căutare',
    tags: 'Etichete',
    settings: 'Setări',
  },
  auth: {
    signInGoogle: 'Intră cu Google',
    signInEmail: 'Intră cu email',
    email: 'Email',
    password: 'Parolă',
    or: 'sau',
    noAccessTitle: 'Nu ai acces încă.',
    noAccessHint: 'Cere un link.',
    signOut: 'Deconectare',
    account: 'Cont',
    guest: 'Invitat',
    errors: {
      invalidCredentials: 'Email sau parolă greșită.',
      emailNotConfirmed: 'Contul nu a fost confirmat încă.',
      network: 'Nu există conexiune la internet. Încearcă din nou.',
      generic: 'Nu s-a putut face autentificarea. Încearcă din nou.',
    },
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
