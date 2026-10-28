# Tossarr — Implementation Plan

Companion to `PRD.md`. Single-repo TypeScript monorepo (one package), two build targets: Fastify API server and Vite-built React frontend served as its static assets.

## 1. Repository Layout

```
tossarr/
├── PRD.md                    # product requirements (lives in the repo)
├── PLAN.md                   # this implementation plan (lives in the repo)
├── package.json              # single package; scripts for dev/build/test
├── Dockerfile                # multi-stage: web build → node:22-alpine runtime
├── docker-compose.dev.yml    # local dev: tossarr + mock sonarr/radarr fixtures
├── tossarr.xml               # local Unraid Docker template (not a CA submission)
├── .env.example
├── README.md                 # docker run instructions, env vars, setup guide
├── server/
│   ├── src/
│   │   ├── index.ts          # bootstrap: config → db → sync queue → fastify listen
│   │   ├── app.ts            # buildApp: routes + static serving + SPA fallback
│   │   ├── config.ts         # env + /config/settings.json load/save (env wins)
│   │   ├── context.ts        # AppContext {db, config, triggerSync} injected into routes
│   │   ├── db.ts             # better-sqlite3 init, migrations, queries
│   │   ├── types.ts          # shared types incl. MediaClient interface
│   │   ├── items.ts          # toItem(): row → API Item (posterUrl via proxy)
│   │   ├── util.ts           # errorMessage, clampInt, maskApiKey/isMaskedKey
│   │   ├── svg.ts            # posterSvg() generated placeholder
│   │   ├── sync.ts           # fetch → normalize → upsert/prune per source
│   │   ├── removals.ts       # confirmRemoval: upstream delete + tombstone
│   │   ├── clients/
│   │   │   ├── index.ts      # createClient({kind,url,apiKey}) factory
│   │   │   ├── http.ts       # HttpClient: X-Api-Key auth, timeout, 404=success deletes
│   │   │   ├── sonarr.ts     # GET /api/v3/series, DELETE /api/v3/series/{id}
│   │   │   └── radarr.ts     # GET /api/v3/movie?hasFile=true, DELETE /api/v3/movie/{id}
│   │   ├── mock/             # fixture-backed fake Sonarr/Radarr API (dev only)
│   │   │   ├── fixtures.ts   # 8 shows + 10 movies
│   │   │   ├── sonarr.ts     # :8989, key tossarr-mock-sonarr-key, /__mock/state
│   │   │   ├── radarr.ts     # :8787, key tossarr-mock-radarr-key, /__mock/state
│   │   │   └── server.ts     # runs both (npm run dev:mocks)
│   │   └── routes/
│   │       ├── settings.ts   # GET/PUT /api/settings
│   │       ├── sources.ts    # GET/POST/PUT/DELETE /api/sources, POST /api/sources/test
│   │       ├── library.ts    # GET /api/library
│   │       ├── decisions.ts  # POST /api/decisions/:itemId, undo, confirm (+confirm-all), reset, DELETE /api/decisions/:itemId
│   │       ├── browse.ts     # GET /api/browse
│   │       ├── posters.ts    # GET /api/posters/:sourceId/:extId (proxy + fallback)
│   │       └── sync.ts       # POST /api/sync (manual resync, background)
│   └── test/                 # vitest: sync upsert, decision logic, route tests (mock API)
├── web/
│   ├── index.html
│   ├── vite.config.ts        # build outDir → server/public; dev proxy → :8901
│   └── src/
│       ├── main.tsx
│       ├── App.tsx           # screen router: setup | deck | browse (state-based)
│       ├── api.ts            # typed fetch client
│       ├── styles.css        # dark theme, card stack, animations
│       └── components/
│           ├── Setup.tsx     # first-run config + connection test
│           ├── Deck.tsx      # card stack, pointer drag, commit logic
│           ├── Card.tsx      # poster, title, year, type badge, overview, meta
│           ├── Browse.tsx    # Kept / To Remove (confirm) / Removed tabs
│           └── CaughtUp.tsx  # stats + resync + reset
```

## 2. Data Model (SQLite at `/config/tossarr.db`)

```sql
CREATE TABLE sources(
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,          -- user label, e.g. 'TV', 'Anime'
  kind       TEXT NOT NULL CHECK (kind IN ('sonarr','radarr')),
  url        TEXT NOT NULL,
  api_key    TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items(
  id            TEXT PRIMARY KEY,   -- '<sourceId>:<externalId>', e.g. '2:456'
  source_id     INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,      -- 'show' | 'movie'
  title         TEXT NOT NULL,
  year          INTEGER,
  poster_path   TEXT,               -- path relative to that source's root
  overview      TEXT,
  meta_json     TEXT,               -- {"episodeCount": n} or {"sizeOnDisk": bytes}
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_items_type ON items(type);

CREATE TABLE decisions(
  item_id     TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  decision    TEXT NOT NULL CHECK (decision IN ('keep','remove')),
  confirmed   INTEGER NOT NULL DEFAULT 0,  -- 'remove' only: 1 = final removal
  next_due    TEXT,                          -- 'keep' only: when it re-enters the deck
  decided_at  TEXT NOT NULL
);

CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);  -- last_sync per source, sync stats
```

Decision undo is handled in the API layer: `POST /api/decisions/undo` pops the most recent decision row (ordered by `decided_at`) and returns the item so the UI can re-show it on top of the deck. No separate history table needed for v1; the 20-deep undo stack is a client-side queue of `{itemId, previousDecision}` pairs backed by the single row per item.

## 3. API Contract (all JSON unless noted)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | liveness → `{ok:true}` |
| `GET /api/settings` | app settings (sync interval, reappear days) |
| `PUT /api/settings` | save settings, triggers sync |
| `GET /api/sources` | list sources with item counts, keys masked (`abcd…`) |
| `POST /api/sources/test` | `{kind, url, apiKey}` → `{ok, itemCount?, error?}` |
| `POST /api/sources` | create source `{name, kind, url, apiKey}`, triggers sync for it |
| `PUT /api/sources/:id` | update name/key/enabled (masked key = unchanged) |
| `DELETE /api/sources/:id` | remove source + its items and decisions |
| `GET /api/library?filter=all\|movie\|show&limit=20` | next deck batch: undecided + kept items past their reappear due date, random order → `{items:[Item], totalPending}` |
| `POST /api/decisions/:itemId` | body `{decision:'keep'\|'remove'}` — keep sets `next_due`; remove inserts a pending row → `{itemId, decision, decidedAt, nextDue?}` |
| `POST /api/decisions/undo` | → `{item: Item}` (404 when nothing to undo) |
| `POST /api/decisions/:itemId/confirm` | confirm a pending removal → upstream delete with `deleteFiles=true`, mark confirmed; upstream failure leaves it pending and surfaces the error |
| `POST /api/decisions/confirm-all` | confirm every pending removal (sequential, per-item results) → `{confirmed, failed:[{itemId,title,error?}]}` |
| `DELETE /api/decisions/:itemId` | restore a **pending** item (clears decision); confirmed deletions are irreversible |
| `GET /api/browse?list=kept\|pending\|removed&limit=50&offset=0` | browse lists → `{items:[Item]}` |
| `POST /api/sync` | manual resync of all enabled sources, runs in background → `{ok:true}` (poll `/api/sources` for `lastSync`) |
| `POST /api/decisions/reset` | clear all decisions (caught-up screen) |
| `GET /api/posters/:sourceId/:extId` | image proxy → bytes + `Cache-Control: public, max-age=86400`; on upstream failure → generated SVG placeholder |

`Item` shape: `{id, sourceId, sourceName, type, title, year, posterUrl, overview, meta}` where `posterUrl` is always the local `/api/posters/...` path.

Deck batching: server returns up to 20 eligible items (undecided + due-to-reappear kept) per call; frontend pre-fetches the next batch while the current card is on screen, so swiping never waits on the network.

## 4. Sync Design

- Triggered per enabled source on startup, on source add/update, manually, and on an interval (`SYNC_INTERVAL_HOURS`, default 6). Disabled sources are skipped but not pruned.
- For each enabled source of kind `sonarr`: `GET /api/v3/series` → items `{id:'<sourceId>:<seriesId>', type:'show', title, year: firstAiredYear.slice(0,4) ?? null, poster_path: posterImage.url, overview: overview||'', meta:{episodeCount: numberOfEpisodes}}`.
- For each enabled source of kind `radarr`: `GET /api/v3/movie?hasFile=true` → same shape with `type:'movie'`, `meta:{sizeOnDisk}`.
- Upsert by `id`; prune rows within a source whose id is no longer upstream there, **except items with a confirmed removal** (kept as tombstones so the Removed log survives resyncs). Other decisions cascade-delete — item left the library.
- All HTTP through a tiny client helper: timeout 15s, one retry, auth via `X-Api-Key` header, errors surfaced as sync status in `meta`.

### Confirmed Removal (the only destructive path)

- Radarr: `DELETE {url}/api/v3/movie/{extId}?removeFromDb=true&deleteFiles=true&addImportExclusion=false` · Sonarr: `DELETE {url}/api/v3/series/{extId}?removeFromDb=true&deleteFiles=true&addImportExclusion=false`, both with the source's `X-Api-Key`.
- Success (or upstream 404 — already gone) → set `confirmed=1`; the item row stays as a tombstone so the Removed tab can still show it. Other errors leave the item pending and surface per-item.
- No undo after confirmation. UI warns before confirm (item count + "this permanently deletes files"); confirm-all requires a second confirmation.

## 5. Frontend Design Notes

- **Layout (revised 2026-10-27):** fullscreen cover + bottom menu. The deck stage fills the viewport above a fixed bottom nav (Deck · Browse · Trash+badge · Settings); no top tabs. The current poster is full-bleed: blurred/dimmed copy as background, sharp poster `object-fit: contain` centered. No peeking card stack.
- **Deck.tsx** owns a queue of items (current + prefetch buffer). Pointer events (`pointerdown/move/up`, `setPointerCapture`) drive drag; transform = `translateX(dx) rotate(dx*0.04deg)` (smaller angle for the larger surface); commit when `|dx|>120` or velocity >0.5px/ms in direction; otherwise spring back (CSS transition).
- Fly-out: on commit, animate off-screen with 300ms ease-in, then pop the item and promote the next card; push decision to API (optimistic — UI updates immediately, toast + auto-restore on failure).
- Keyboard: `ArrowLeft`/`j` = remove, `ArrowRight`/`l` = keep, `u`/`Backspace` = undo. Decision buttons (✕ / ✓ + undo) float above the bottom nav and mirror swipes.
- Screens are state-routed in `App.tsx`: no sources → `Setup` (add-source flow); otherwise fullscreen pages behind the bottom nav. Setup stays reachable for managing sources.
- No router library, no component library; plain CSS with custom properties for the theme.

## 6. Docker & Unraid Packaging

- **Dockerfile:** stage 1 `node:22-alpine` builds web (`vite build`) and server (esbuild/tsc) → stage 2 copies `server/dist`, `server/public`, `package.json` (prod deps only), `USER node`, `EXPOSE 8901`, `HEALTHCHECK CMD wget -qO- http://localhost:8901/api/health`.
- **tossarr.xml** template variables: `TOSSARR_PORT` (8901), `SYNC_INTERVAL_HOURS`, `KEEP_REAPPEAR_DAYS`; container path `/config` → `<Config>/tossarr`. Media sources are configured in the web UI after first boot.
- **README:** `docker run -d --name tossarr -p 8901:8901 -v /path/to/appdata/tossarr:/config ghcr.io/tucker/tossarr`, plus the Unraid template install path and a note that Sonarr/Radarr URLs must be reachable from inside Docker (e.g. `http://sonarr:8989` on the same network, or host IP).

## 7. Milestones & Task Breakdown

**M0 — Scaffold (½ day)** ✅
- [x] Move `PRD.md` and `PLAN.md` from the planning folder into the repo root
- [x] `git init` + `.gitignore` (node_modules, dist) + initial commit
- [x] Init project: package.json, tsconfig, eslint/prettier, vitest
- [x] Dockerfile multi-stage + `docker-compose.dev.yml` (app + mock API)
- [x] Dev loop working: `npm run dev` runs server (tsx watch) + vite with proxy

**M1 — Backend core (1 day)** ✅
- [x] `config.ts`: env + /config/settings.json (port, sync interval, reappear days)
- [x] `db.ts`: schema + migrations + query helpers (sources, items, decisions)
- [x] Sources CRUD API with key masking
- [x] Sonarr/Radarr clients (20s timeout; single attempt — no retry implemented)
- [x] `sync.ts`: normalize/upsert/prune + scheduler (coalescing queue; one sync at a time)
- [x] Mock fixture servers — one fake Sonarr + one fake Radarr instance, delete endpoints included (call-recording) — so dev/tests exercise multi-source + the confirm flow without real apps
- [x] Unit tests: sync upsert/prune/tombstones, decision CRUD, undo ordering, config precedence, masking/clamp utils

**M2 — API routes (½ day)** ✅
- [x] settings (get/put), sources CRUD + test, library batching, decisions + undo + confirm (+confirm-all) + reset, browse, manual sync, health
- [x] Poster proxy with fallback SVG + cache headers
- [x] Route tests against mock clients (full app via `fastify.inject`, live mocks on ephemeral ports)

**M3 — Frontend shell + setup (½ day)** ✅
- [x] Vite app, dark theme base styles, `api.ts` client (`web/src/api.ts`, typed for the full API surface)
- [x] Setup screen: add-source flow (name, type, URL, key) with test-connection + item counts; manage/disable/remove sources later (Settings tab → Sources panel)
- [x] App screen routing (setup vs main tabs: Deck / Browse / Settings — Deck & Browse are placeholders until M4/M5)

**M4 — Deck & swipe (1 day)** ✅
- [x] Shell restructure: fullscreen stage + bottom menu (Deck · Browse · Trash+badge · Settings); top tabs retired (`App.tsx` state-routes pages; `BottomNav.tsx` owns the `Page` type, inline stroke SVG icons, pending badge on Trash)
- [x] Fullscreen cover: blurred full-bleed background + 2:3 poster card at ~76% stage height, title/year/type/source/meta overlays top, 3-line-clamped overview above the decision bar
- [x] Pointer drag + rotation (`dx * 0.04deg`) + commit/spring-back physics (commit at |dx|>120px or >0.5px/ms flick in direction); 300ms ease-in fly-out; KEEP/NOPE badges fade with drag
- [x] Decision buttons (✕ / ✓ + undo) floating above the menu + keyboard shortcuts (←/j, →/l, u/Backspace; inputs skipped)
- [x] Prefetch next batch when ≤5 remain (deduped by id); optimistic decisions — success filters the card out of the queue, failure toasts and springs the card back (queue never advanced); undo unshifts the returned item to the front
- [x] Trash page (`PendingPage.tsx`): pending list with thumbs + decided-at, per-item confirm behind a `window.confirm` irreversibility warning (502 stays pending), restore = clearDecision, confirm-all via armed double-confirm button (5s disarm)
- [x] Server: `/api/browse` returns `total` (nav badge + M5 pagination); also fixed `deckBatch.totalPending`, which counted deck-eligible items instead of pending removals — now an honest `COUNT(*) FROM decisions WHERE decision='remove' AND confirmed=0`

**M5 — Browse & caught-up (½ day)** ✅
- [x] Browse screen (`BrowsePage.tsx`): Kept / Removed tabs (segmented control) with thumbnail rows + offset pagination over `/api/browse` `total` ("Showing 1–50 of N", Newer/Older); pending stays on the Trash page. Shared `timeAgo` extracted to `web/src/time.ts`
- [x] CaughtUp screen (`CaughtUp.tsx`, rendered by Deck when the queue is empty): stat chips (kept / pending / removed — kept & removed via cheap `limit=1` browse totals), "Sync now" (existing resync polling), "Reset decisions" behind a `window.confirm` → `POST /api/decisions/reset` (confirmed removals preserved)
- [x] Deck filter toggle: All / Shows / Movies segmented control overlaid at top center of the deck (also on the caught-up screen); reloads the queue via `getLibrary(filter)` and is honored by prefetch + resync polling; title overlay shifted down to make room

**M6 — Polish (½ day)** ✅
- [x] Loading skeletons: shimmer placeholders for the deck card, Browse rows, and Trash rows (empty states + error toasts already shipped in M4/M5)
- [x] Mobile pass: `viewport-fit=cover` + `theme-color` in the HTML shell; safe-area insets on the deck filter and toast; `touch-action: manipulation` + `overscroll-behavior: none` + no tap highlight (no double-tap-zoom delay, no pull-to-refresh fighting swipes); ~40px seg buttons; Trash actions drop to their own row under 480px; tighter page padding on phones; card shows a placeholder background while posters load. Desktop centering was already in place (`.page` max-width + flex-centered stage)
- [x] ARIA: visually-hidden `role="status"` live region announces each card change (title, year, type); filter/tab buttons switched from tab roles to plain buttons with `aria-pressed`; decision buttons keep their existing labels; nav/seg/nav text no longer selectable on rapid taps

**M7 — Packaging & docs (½ day)** ✅
- [x] `tossarr.xml` local Unraid template (import via Add Container; no Community Apps submission) — v2 format following the official CA starter + a real-world GHCR template (tofarr): full image path in `<Repository>`, package URL in `<Registry>`, port config maps host→8901 without injecting `TOSSARR_PORT` env, `sh` shell for alpine. Port + config-dir configs only — everything else is set in the web UI (avoids env-over-settings precedence surprises). App icon (`icon.svg`/`icon.png`) referenced from the template
- [x] README: docker run, env vars, Unraid install, troubleshooting (Docker network reachability) — written ahead of schedule during M5; polished alongside packaging (pull-from-GHCR quick start, template import steps, package visibility note)
- [x] Image build + push to GHCR — GitHub Actions workflow (`.github/workflows/docker.yml`) builds linux/amd64 and pushes `latest`/`main`/sha tags on every push to main plus versioned tags for `v*`; first build green (run 40638563288). Note: set the package public under repo → Packages so Unraid can pull without registry credentials
- [x] Final manual test on a real Sonarr/Radarr (PLAN §8 checklist) — safe items verified 2026-10-28 against the live instances (setup, desktop swipe physics, undo×20, browse/restore, failed-confirm, poster fallback); destructive confirm + caught-up reset deferred to the user (see §8)

**Total estimate: ~4–5 focused days.**

## 8. Testing Strategy

- **Unit (vitest):** sync normalization/upsert/prune (incl. tombstone preservation), decision + undo + confirm/confirm-all logic, settings merge/masking — all against in-memory SQLite and fixture JSON captured from the real Sonarr v3 / Radarr v3 API shapes.
- **Integration:** route tests run the full app (`buildApp` + `fastify.inject`) against live mock Sonarr/Radarr servers on ephemeral ports — real HTTP, no external network. Suite: 85 tests in `server/test/`, ~0.5s.
- **Manual checklist** (run 2026-10-28 against real Sonarr `…:8989` + Radarr `…:7878`; safe items scripted net-zero):
  - [x] Setup flow — both real sources added via the web UI, test-connection green, sync pulled 144 shows + 599 movies, posters proxy as real JPEGs
  - [x] Swipe on desktop — drag physics verified (commit / flick / spring-back, KEEP/NOPE badges); phone touch feel-check left to the user
  - [x] Undo chain of 20 — 20 keeps undone in strict LIFO order, all back in the deck (net-zero)
  - [x] Browse / restore — swipe left → pending list → restore → back in the deck (net-zero)
  - [x] Failed-confirm stays pending — source pointed at a dead port; confirm returned `502 "Cannot reach source …"`, item stayed pending, URL restored
  - [x] Poster proxy failure fallback — unit-tested (non-image upstream → generated SVG); live posters confirmed as real JPEGs
  - [ ] Confirm a pending removal against real Radarr/Sonarr (verify metadata + files gone) — destructive; user picks the item
  - [ ] Caught-up reset — wipes all keeps; user's call
  - [ ] Sync after upstream changes (add/remove a movie in Radarr → resync) — optional, user

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sonarr/Radarr unreachable from Docker network (host vs container DNS) | Setup screen surfaces the exact error; README documents `host.docker.internal`/LAN IP options |
| Large libraries slow poster loads | Lazy image loading, 20-item deck batches, proxy cache headers, generated fallback |
| `better-sqlite3` native build on alpine | Prebuilt binaries exist for musl Node 22; verify in M0 Dockerfile stage |
| Accidental destructive behavior | Two-stage removal (pending list + explicit confirm), double-confirm on confirm-all, upstream deletes only via the confirm endpoint, covered by mock tests |
