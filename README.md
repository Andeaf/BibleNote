# BibleNote

Notițe pentru studiul Bibliei: foldere, notițe formatate, înregistrări audio, fișiere, etichete,
referințe biblice (Cornilescu) și partajare prin link. Merge pe telefon și pe desktop, se instalează
ca aplicație (PWA) și funcționează offline, cu sincronizare între dispozitive.

**Stare: în lucru.** Faza 0 (setup) e gata; urmează datele și sincronizarea. Planul complet e în
[docs/PLAN.md](docs/PLAN.md), specificația în [docs/SPEC.md](docs/SPEC.md).

## Tehnologii

React + TypeScript + Vite, Tailwind, React Router, `vite-plugin-pwa`, Tiptap, Dexie (IndexedDB),
Supabase (Auth, Postgres + RLS, Storage, Realtime, regiunea EU), Vercel. Totul pe planuri gratuite.

## Dezvoltare locală (Windows, CMD)

```cmd
npm install
npm run dev
```

Aplicația pornește la http://localhost:5173. Alte comenzi: `npm run build`, `npm run lint`,
`npm test`. Variabilele de mediu se pun în `.env.local`, după modelul din `.env.example`.

## Documentație

- [docs/SETUP.md](docs/SETUP.md): pașii manuali (Vercel, Supabase, Google OAuth).
- [docs/PLAN.md](docs/PLAN.md): arhitectura, schema, sincronizarea, fazele.
- [CLAUDE.md](CLAUDE.md): convențiile de cod.

## Atribuiri

- Fonturi: [Inter](https://rsms.me/inter/) și
  [Source Serif 4](https://github.com/adobe-fonts/source-serif), ambele sub SIL Open Font License,
  găzduite local.
- Textul biblic (din faza 5): _Romanian Corrected Cornilescu Version_, domeniu public, din
  [open-bibles](https://github.com/seven1m/open-bibles).
