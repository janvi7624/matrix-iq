# MatrixIQ

MatrixIQ is NANTA TECH LIMITED's internal business platform — an interconnected network linking teams, tasks, and information across CRM, sales/quotations, projects, TMS (technical/engineering task management), HR, and operations.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, `output: 'standalone'`), React 19, TypeScript
- Sequelize 6 + PostgreSQL (Supabase-hosted)
- Tailwind v4 + CSS Modules, with a `--mx-*` design-token layer in `app/globals.css`
- Vitest for unit tests

> **Before making changes**, read [`AGENTS.md`](./AGENTS.md) — this Next.js version has breaking changes vs. typical training data.

## Getting Started

```bash
npm install
cp .env.example .env.local   # fill in ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET, DATABASE_URL, etc.
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (+ `postbuild` copies static assets into the standalone output) |
| `npm start` | Run the built standalone server (`node .next/standalone/server.js`) |
| `npm run lint` | ESLint |
| `npm test` | Run unit tests once |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:coverage` | Run unit tests with coverage |
| `npm run typecheck` | Type-check `lib/` and `tests/` |
| `npm run db:migrate` | Run Sequelize migrations |
| `npm run db:migrate:undo` | Revert the last migration |
| `npm run db:seed:all` | Run Sequelize seeders |

## Layout

```
app/            Routes (App Router) and API route handlers (app/api/**)
components/     Feature view components; components/ui/ holds shared primitives
lib/            Business logic, *Store.ts data-access modules, auth/permissions
db/             Sequelize models, migrations, and config
tests/          Vitest unit tests
```
