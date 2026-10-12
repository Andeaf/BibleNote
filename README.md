# BibleNote

Notițe pentru studiul Bibliei: foldere, notițe formatate, înregistrări audio, fișiere, etichete,
referințe biblice (Cornilescu) și partajare prin link. Merge pe telefon și pe calculator, se
instalează ca aplicație (PWA), funcționează fără internet și se sincronizează între dispozitive.

Adresa: https://biblenote-app.vercel.app

**Stare:** toate fazele planului sunt gata (0–6); urmează testarea cap-coadă pe dispozitive
(lista din [docs/SETUP.md](docs/SETUP.md)). Planul e în [docs/PLAN.md](docs/PLAN.md), specificația
în [docs/SPEC.md](docs/SPEC.md).

## Cum se folosește

- **Intrarea**: cu Google sau cu email și parolă (conturile de rezervă le creează David). Doar
  emailurile din lista `allowed_emails` pot crea foldere; oricine primește un link intră ca invitat,
  fără cont, doar cu un nume.
- **Instalare**: pe Android și pe calculator, Setări → „Instalează aplicația”. Pe iPhone, în Safari:
  Distribuie → „Adaugă pe ecranul principal” (pașii sunt și în aplicație). Pe iPhone e important:
  instalată, aplicația își păstrează datele; în Safari simplu, telefonul le poate șterge.
- **Foldere**: folderele principale au culoare și emoji și sunt cele care se partajează; în ele,
  subfoldere pe oricâte niveluri. Mutare cu drag & drop pe calculator și cu „Mută în…” pe telefon.
- **Notițe**: se salvează singure. Titluri, îngroșat, cursiv, subliniat, evidențiere în 4 culori,
  liste, liste de verificare, citat, link. Etichetele se scriu sub titlu. Căutarea (jos, „Căutare”)
  găsește în titluri, text, etichete și nume de fișiere, cu sau fără diacritice.
- **Referințe biblice**: „Ioan 3:16”, „1 Cor 13:4-7”, „Rom 8:28,31”, „Ioan 3,16”, „Psalmul 23”
  devin linkuri discrete; un clic arată textul și „Inserează în notiță”. Butonul cu cartea din
  bara notiței caută o referință („ioan 3 16”) și o inserează. Biblia merge și fără internet.
- **Fișiere și înregistrări**: „+” → încarcă (poze, PDF, documente, audio) sau înregistrează.
  Pozele se micșorează singure; un fișier poate avea cel mult 50 MB; înregistrările lungi se
  împart singure în părți. Ce se încarcă fără internet pleacă singur când revine conexiunea.
- **Partajare**: în meniul folderului principal, „Partajare”: un link de citire și unul de editare,
  care se pot opri sau înlocui, și lista persoanelor cu acces, din care poți scoate pe oricine.
- **Coș de gunoi**: ce ștergi ajunge în coș și se poate restaura 30 de zile; apoi se șterge singur.
  Doar proprietarul folderului principal șterge definitiv.
- **Fără internet**: totul se poate citi și scrie; indicatorul de sus arată ce așteaptă să plece.
  Dacă aceeași notiță a fost schimbată pe două dispozitive, nu se pierde nimic: a doua variantă
  devine o notiță separată „(conflict – Nume, dată)”.
- **Setări**: tema (luminoasă, întunecată, automată) și mărimea textului din notițe, la fel pe toate
  dispozitivele; spațiul folosit; exportul; „Nesincronizate”, pentru ce n-a putut fi trimis.
- **Printare**: în meniul unei notițe, „Printează / Salvează ca PDF”.

## Copia de siguranță (backup)

Planul gratuit Supabase nu oferă copii de siguranță descărcabile. Copia e **exportul**: Setări →
„Exportă tot (ZIP)”, de pe calculator (Chrome sau Edge îl scriu direct pe disc). Arhiva are câte un
folder pentru fiecare folder principal, notițele ca fișiere `.md` (Markdown, se deschid cu orice
editor de text) și fișierele cu numele lor. Nu conține coșul, linkurile de partajare și setările.
Pe telefon se pot exporta doar notițele; exportul complet poate avea sute de MB din cauza
înregistrărilor. Recomandare: un export complet pe lună, păstrat pe calculator sau pe un stick.

## Costuri

Zero, cât timp proiectul rămâne în limitele planurilor gratuite:

- **Supabase Free** (Frankfurt): baza de date, autentificarea, fișierele, sincronizarea.
- **Vercel Hobby**: găzduirea aplicației, publicată automat din GitHub.
- **GitHub**: codul (repo privat) și workflow-ul care ține proiectul Supabase treaz.

Un domeniu propriu (în loc de `*.vercel.app`) e opțional și costă de obicei 10–15 € pe an.

## Limite

| Ce | Limita | Ce face aplicația |
|---|---|---|
| Fișiere | 1 GB în total, pe tot proiectul | Setări arată „spațiu folosit / 1 GB”; pozele se comprimă, sunetul e înregistrat la calitate de voce (~48 kbps, ~22 MB pe oră) |
| Un fișier | 50 MB | refuzat înainte de încărcare, cu mesaj; înregistrările se împart la 45 MB |
| Baza de date | 500 MB | notițele sunt text: sute de mii de notițe încap |
| Trafic | 5 GB pe lună | fișierele deschise se păstrează pe dispozitiv (cache de 200 MB), ca să nu se descarce de fiecare dată |
| Pauză | proiectul se oprește după 7 zile fără activitate | `.github/workflows/keepalive.yml` îl atinge la 3 zile |
| Proiecte | 2 proiecte gratuite active pe cont | BibleNote folosește unul |

Alte limite de știut: nu există editare simultană în timp real (apare doar „X editează acum”); pe
iPhone, Google în aplicația instalată poate cere din nou intrarea, iar emailul cu parolă merge
mereu; coșul se golește doar când proprietarul deschide aplicația (până atunci nu se pierde nimic).

## Dezvoltare locală (Windows, CMD)

```cmd
npm install
npm run dev
```

Aplicația pornește la http://localhost:5173. Alte comenzi: `npm run build`, `npm run lint`,
`npm test`, `npm run test:rls` (testul de securitate, pe proiectul real), `npm run build:bible`
(regenerează textul biblic din `data/`). Variabilele de mediu se pun în `.env.local`, după modelul
din `.env.example`.

## Tehnologii

React + TypeScript + Vite, Tailwind, React Router, `vite-plugin-pwa`, Tiptap, Dexie (IndexedDB),
Supabase (Auth, Postgres + RLS, Storage, Realtime), Vercel.

## Documentație

- [docs/SETUP.md](docs/SETUP.md): pașii manuali (Vercel, Supabase, Google OAuth) și ce se testează
  după fiecare fază.
- [docs/PLAN.md](docs/PLAN.md): arhitectura, schema, sincronizarea, fazele.
- [CLAUDE.md](CLAUDE.md): convențiile de cod.

## Atribuiri

- Textul biblic: _Romanian Corrected Cornilescu Version_ (Biblia Cornilescu, ediția corectată),
  domeniu public, din [open-bibles](https://github.com/seven1m/open-bibles)
  (`ron-rccv.usfx.xml`, copiat în `data/`). Diacriticele ş/ţ cu sedilă sunt înlocuite cu ș/ț.
- Fonturi: [Inter](https://rsms.me/inter/) și
  [Source Serif 4](https://github.com/adobe-fonts/source-serif), ambele sub SIL Open Font License,
  găzduite local.
