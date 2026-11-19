# AGENTS.md

High-signal context for working on CyberPulse.

---

## Commands

```bash
# Development (frontend + backend with hot reload)
npm run dev                # Frontend: http://localhost:3000, API: http://localhost:3001

# Production build (frontend compiles to dist/)
npm run build              # Must run before Docker production build

# Lint → TypeCheck → Test (in order)
npm run lint
tsc -b                     # TypeScript check (no npm script)
npm run test               # vitest run
npm run test:watch         # vitest watch

# Backend only
npm run server             # npx tsx server/index.ts
npm run server:dev         # npx tsx watch server/index.ts

# Utilities
npm run docs:sources       # Regenerate source tables in README from server/services/seeds.ts
npm run db:generate        # New SQL migration after editing server/db/schema.ts
npm run db:check           # Validate migration history
```

---

## Docker: Two Modes

### Production (static build)

Frontend compiles **into the image** at build time. Any source change requires rebuild.

```bash
docker compose up -d                    # Start
docker compose up -d --build            # Rebuild after any src/ or server/ change
docker compose build --no-cache         # Force clean build if cache is stale
docker compose down -v                  # Wipe everything including database
```

App runs on http://localhost:3001 (frontend served from dist/).

### Development (hot reload)

Source is mounted; changes reflect without rebuild.

```bash
docker compose -f docker-compose.dev.yml up -d      # Frontend: 3000, API: 3001
docker compose -f docker-compose.dev.yml logs -f    # Watch logs
```

If `tsx watch` doesn't pick up changes on macOS/Windows, add `--poll` to the command in `Dockerfile.dev`.

---

## Production Secret Gate

**The server refuses to start with `NODE_ENV=production` unless `CYBERPULSE_SECRET` is set** (see `server/index.ts`). It encrypts company AI keys, webhook URLs and TOTP seeds at rest; back it up.

`CYBERPULSE_API_KEY` is separate and optional: it only enables the machine endpoint `POST /api/mcp`.

---

## Path Alias

`@/*` resolves to `./src/*` (tsconfig.json, vite.config.ts, vitest.config.ts).

```typescript
import { Button } from '@/components/ui/button';
```

---

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend**: Express 5 server in `server/`, runs with `tsx` (no build step)
- **Database**: SQLite via better-sqlite3 + Drizzle ORM (file in `./` locally, `/app/data` in Docker)
- **Scraper**: node-cron every 15 min (`SCRAPE_CRON`), 100+ RSS feeds (see `server/services/seeds.ts`)
- **Build artifact**: `dist/` (frontend only; backend runs as TypeScript via tsx)

### Backend layers

```
server/
  index.ts          entry point: migrations, seed, jobs, listen
  app.ts            Express app: security middleware, static UI, /api router
  config.ts         environment configuration
  api/              routes.ts (every endpoint + its guards), middlewares/ (auth, CSRF, CORS, rate limits, errors)
  controllers/      HTTP in/out: read and validate the request, call a use case or service, shape the response
  useCases/         flows that span several services (login, create company, import CSV, run a channel digest)
  services/         business logic (auth, matcher, digest, scraper, AI, webhooks, schedules)
  repositories/     all database access, one module per entity (Drizzle query builder, no raw SQL elsewhere)
  db/               schema.ts (tables), client.ts (connection + migrations), migrations/ (generated SQL)
  jobs/             cron: scrape, channel scheduler, retention
  lib/              cross-cutting helpers (HTTP errors and input parsing, crypto, event-loop tools)
  tests/            Vitest suites
```

Dependencies point downwards only: api → controllers → useCases → services → repositories → db.

### Event loop

All JavaScript runs on one thread. `await` on I/O does not block it; long synchronous CPU work does. Rules:
- password hashing uses async scrypt (libuv thread pool, at most CPUs − 1 at once);
- RSS feeds are downloaded and XML-parsed on worker threads (`server/services/feeds/`); the worker is plain `.mjs` so it runs under tsx, Vitest and Docker alike;
- scans over many articles go through `forEachChunked` (`server/lib/eventLoop.ts`), which yields between chunks;
- My Stack results are cached per company until the corpus or the stack changes;
- `/api/health` reports `eventLoopDelay` (p50/p99/max in ms since the previous call) to watch it in production.

---

## Database and Migrations

The schema lives in `server/db/schema.ts`. To change it:

1. Edit `schema.ts`.
2. `npm run db:generate -- --name short_description` writes `server/db/migrations/NNNN_short_description.sql`.
3. Review the SQL, commit both files. Migrations run automatically on startup (`getDb()` in `server/db/client.ts`).

Never edit a migration that has already been deployed; add a new one.

Databases created before Drizzle (hand-written migrations v1-v10, marked by a `schema_metadata` table) are converted once on startup by `server/db/legacy.ts`: backup with `VACUUM INTO` next to the file, then rename → create → copy → drop in a single transaction, and the baseline is recorded as applied. Covered by `server/tests/legacy.test.ts` against a fixture generated with the old code.

---

## Tests

Vitest config includes both frontend and backend:

```typescript
include: ['server/**/*.test.ts', 'src/**/*.test.{ts,tsx}']
```

Backend suites live in `server/tests/`; `api.test.ts` boots the real app against a throwaway database.

---

## Adding a New RSS Source

1. Edit `server/services/seeds.ts`, add entry to `RSS_SOURCES` array
2. If using Docker production, **rebuild the image**:
   ```bash
   docker compose up -d --build
   ```
3. Verify with `curl http://localhost:3001/api/sources`
4. Force immediate scrape: `curl -X POST http://localhost:3001/api/scrape`

Source table in README is generated from `server/services/seeds.ts` via `npm run docs:sources` — run it after editing seeds.

---

## Healthcheck

Docker healthcheck uses Node's built-in `fetch`, not curl:

```javascript
fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1))
```

---

## Dockerfile Build Stages

1. **deps**: Installs all deps + C++ toolchain for better-sqlite3; creates separate runtime tree without devDeps
2. **frontend-builder**: Runs `npm run build` (Vite)
3. **production**: Copies runtime node_modules, built frontend (`dist/`), and raw `server/` TypeScript; runs server with `tsx`

The production image **never contains source files from `src/`**, only the compiled `dist/`.

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3001` | Server port |
| `CYBERPULSE_API_KEY` | `null` | Required in production unless `CYBERPULSE_ALLOW_NO_AUTH=true` |
| `CYBERPULSE_CORS_ORIGINS` | localhost variants | Comma-separated; `*` for all origins (not recommended) |
| `SCRAPE_CRON` | `*/15 * * * *` | Cron expression for RSS scraping |
| `NODE_ENV` | `production` (Docker) | |
| `TRUST_PROXY` | unset | Set for reverse proxy / Fly / Railway (e.g., `1`) |

---

## Logs in Docker

```bash
docker compose logs -f                          # All logs
docker compose logs -f | grep SCRAPER          # Scraper activity
docker compose logs -f | grep CRON             # Cron job triggers
docker compose logs -f --timestamps            # With timestamps
docker compose logs --tail=100                 # Last 100 lines
```

---

## Common Gotchas

- **Changes not appearing in Docker**: You're running production mode; the frontend is baked into the image. Either rebuild (`docker compose up -d --build`) or switch to dev mode (`docker-compose.dev.yml`).
- **Server won't start in production**: Set `CYBERPULSE_API_KEY` or add `CYBERPULSE_ALLOW_NO_AUTH=true`.
- **SQLite permission errors**: `chmod -R 777 ./data` or use a named volume instead of bind mount.
- **Port 3001 occupied**: Change the left side of `ports: - "8080:3001"` in docker-compose.yml.
- **Test files not found**: Vitest looks in `server/**/*.test.ts` and `src/**/*.test.{ts,tsx}`.

---

## Monorepo Context

This repo has a parent directory (`/Users/santiago/Proyects/CyberPulse`) with:
- `app/` — this codebase
- `vscode-extension/` — VSCode extension (separate)
- `README.md` / `README.es.md` — root docs

When working in `app/`, stay in this directory; the root README references the app but isn't part of the build.
