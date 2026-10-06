/**
 * Every user-facing string of the app, in Romanian.
 * Components import `t` and never contain literal UI text. Leaves are strings or functions
 * that return a string (for texts with a value inside).
 */
export const ro = {
  app: {
    name: 'BibleNote',
    tagline: 'Notițe pentru studiul Bibliei',
  },
  common: {
    loading: 'Se încarcă…',
    save: 'Salvează',
    create: 'Creează',
    cancel: 'Anulează',
    back: 'Înapoi',
    menu: 'Meniu',
    close: 'Închide',
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
    empty: 'Niciun folder încă. Creează primul folder principal ca să începi.',
    emptyShared: 'Folderele primite prin link vor apărea aici.',
    emptyFolder: 'Folderul e gol. Creează un subfolder ca să începi.',
    mine: 'Folderele mele',
    shared: 'Partajate cu mine',
    newSpace: 'Folder principal nou',
    newFolder: 'Subfolder nou',
    rename: 'Redenumește',
    appearance: 'Culoare și emoji',
    move: 'Mută în…',
    trash: 'Mută în coș',
    trashTitle: (name: string) => `Muți „${name}” în coș?`,
    trashFolderHint: 'Folderul și tot ce conține ajung în coș. Le poți restaura de acolo.',
    trashSpaceHint:
      'Folderul principal și tot conținutul ajung în coș, iar persoanele cu care l-ai partajat nu îl mai văd.',
    sortBy: 'Sortare',
    sortName: 'Nume',
    sortDate: 'Dată',
    dialogCreateSpace: 'Folder principal nou',
    dialogCreateFolder: 'Subfolder nou',
    dialogEdit: 'Modifică folderul',
    nameLabel: 'Nume',
    emojiLabel: 'Emoji',
    colorLabel: 'Culoare',
    colorOption: (index: number) => `Culoarea ${index}`,
    noEmoji: 'Fără emoji',
    moveTitle: 'Mută în…',
    moveRoot: 'Rădăcina folderului principal',
    moveConfirm: 'Mută',
    notFound: 'Folderul nu există sau a fost mutat în coș.',
    backToFolders: 'Înapoi la foldere',
    breadcrumb: 'Calea folderului',
    dropHere: 'Lasă aici',
    roleViewer: 'doar citire',
  },
  sync: {
    offline: 'Offline',
    syncing: 'Se sincronizează…',
    upToDate: 'Sincronizat',
    failedCount: (n: number) =>
      n === 1 ? '1 modificare nesincronizată' : `${n} modificări nesincronizate`,
    accessLost: (name: string) => `Nu mai ai acces la „${name}”.`,
    movedToRoot: (name: string) =>
      `Folderul părinte nu mai există, așa că „${name}” a fost mutat în rădăcină.`,
    failed: (name: string) => `„${name}” nu s-a putut sincroniza. Vezi Setări.`,
    errors: {
      noRows: 'Serverul a refuzat modificarea: nu mai ai drepturi sau elementul a fost șters.',
      folderDeleted: 'Folderul țintă a fost mutat în coș între timp.',
      folderNotInSpace: 'Folderul țintă e în alt folder principal.',
      cycle: 'Un folder nu poate fi mutat în interiorul lui.',
      generic: (code: string) => `Eroare de sincronizare (${code}).`,
    },
  },
  tables: {
    spaces: 'Folder principal',
    folders: 'Folder',
    notes: 'Notiță',
    files: 'Fișier',
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
    unsynced: 'Nesincronizate',
    unsyncedEmpty: 'Toate modificările sunt sincronizate.',
    retry: 'Reîncearcă',
    discard: 'Renunță',
    signOutTitle: 'Te deconectezi?',
    signOutUnsynced: (n: number) =>
      `Ai ${n} ${n === 1 ? 'modificare nesincronizată' : 'modificări nesincronizate'}. Dacă te deconectezi acum, se pierd.`,
    signOutHint:
      'Datele locale de pe acest dispozitiv se șterg. Pe celelalte dispozitive rămâi conectat.',
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
