# Tossarr

A Tinder-style swipe interface for your Sonarr/Radarr libraries. Point it at one or more
instances, then swipe through everything you own: **right to keep, left to toss**.

- Kept items quietly re-enter the deck after a configurable interval (default 30 days), so
  new seasons and movies don't get buried.
- Left-swiped items land in a trash bin — undoable until you confirm. Confirming permanently
  deletes the item from the upstream instance (**metadata and media files**), with an
  irreversibility warning.
- Multiple Sonarr/Radarr instances at once, added and managed from the web UI.
- Automatic periodic sync (default every 6 hours) plus a manual "Sync now".
- Single container, single port, SQLite storage — no other services required.

## Quick start (Docker)

The image is published to GitHub Container Registry on every push to `main`:

```sh
docker pull ghcr.io/tucktuckg00se/tossarr:latest
docker run -d \
  --name tossarr \
  -p 8901:8901 \
  -v /path/to/appdata/tossarr:/config \
  ghcr.io/tucktuckg00se/tossarr:latest
```

Or build from source:

```sh
docker build -t tossarr .
docker run -d --name tossarr -p 8901:8901 -v /path/to/appdata/tossarr:/config tossarr
```

Open http://localhost:8901, add your Sonarr/Radarr instance(s) with their API keys on the
setup screen, and start swiping.

### Installing on Unraid

Easiest path is the bundled template. In **Docker** (or Community Applications → Add
Container), open the top-right menu and choose **Import from URL**, then paste:

```
https://raw.githubusercontent.com/tucktuckg00se/tossarr/main/tossarr.xml
```

(You can also download `tossarr.xml` from this repo and import it as a file.) Then create an
appdata folder (e.g. `/mnt/user/appdata/tossarr`) and start the container. Two things to know:

- The container runs as a non-root user (UID 1000), so the appdata folder must be writable by
  that UID before first run — in Unraid's UI, set the folder's permissions to allow all users,
  or on the console: `chmod -R 777 /mnt/user/appdata/tossarr`.
- The container must be able to reach your Sonarr/Radarr instances. Either put Tossarr on the
  same Docker network as those containers (and use their service names) or point it at
  host-side URLs/ports.

If pulling `ghcr.io/tucktuckg00se/tossarr` fails with an authentication error, the package is
private: go to the repo's **Packages** page on GitHub and switch it to public (or add your
GitHub credentials to Unraid under Docker → Registry).

## Configuration

All settings are optional. Precedence: **environment variable > `settings.json` > default**.
The sync interval and reappear days can also be changed from the Settings page, which writes
`settings.json` into the config directory.

| Variable              | Default   | Description                                        |
| --------------------- | --------- | -------------------------------------------------- |
| `TOSSARR_PORT`        | `8901`    | Port for the web UI and API                        |
| `SYNC_INTERVAL_HOURS` | `6`       | How often libraries are re-synced from each source |
| `KEEP_REAPPEAR_DAYS`  | `30`      | Days before a kept item re-enters the deck         |
| `TOSSARR_CONFIG_DIR`  | `/config` | Where `settings.json` and `tossarr.db` live        |

## How it works

- **The deck** shows every undecided item from all enabled sources as full-screen posters.
  Drag to swipe (or use the buttons / arrow keys). The deck has an All / Shows / Movies filter.
- **Two-stage removal.** A left swipe only marks an item _pending_ — nothing is deleted yet,
  and you can undo it. Confirming a pending item calls the upstream delete endpoint with
  `removeFromDb=true&deleteFiles=true`, which removes metadata and media files. Items that are
  already gone upstream (404) count as success. Confirmed removals stay in the
  **Browse → Removed** log; they cannot be restored.
- **Reappearance.** Kept items return to the deck after `KEEP_REAPPEAR_DAYS`. From the
  caught-up screen you can reset all decisions at any time — kept and pending items go back
  into the deck, confirmed removals are preserved.
- **Sync** runs at startup, on an interval, and on demand. It upserts new items and prunes
  ones that disappeared upstream (tombstoned items are never pruned).

## Local development

Requires Node ≥ 20.

```sh
npm ci
npm run dev        # API server on :8901 + Vite on :5173 (proxies /api)
```

In a second terminal, start the bundled fixture servers — a fake Sonarr with 8 shows and a
fake Radarr with 10 movies:

```sh
npm run dev:mocks  # Sonarr mock on :8989, Radarr mock on :8787
```

Then add them via the setup screen:

| Source | URL                     | API key                   |
| ------ | ----------------------- | ------------------------- |
| Sonarr | `http://localhost:8989` | `tossarr-mock-sonarr-key` |
| Radarr | `http://localhost:8787` | `tossarr-mock-radarr-key` |

The mocks serve all posters as SVG, record destructive calls, and expose their state at
`GET /__mock/state` on either port — handy for verifying that confirms actually hit upstream.

Other scripts:

| Script              | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `npm run build`     | Build the web app (`server/public`) and server |
| `npm start`         | Run the built server                           |
| `npm test`          | Vitest suite (unit + full-app route tests)     |
| `npm run typecheck` | TypeScript checks for server and web           |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Prettier                                       |

There is also a `docker-compose.dev.yml` that runs the app plus the mock servers in
containers if you prefer that loop.

## API overview

A small JSON REST API under `/api`:

- `GET /api/health` — liveness probe (used by the Docker healthcheck)
- `GET|PUT /api/settings` — sync interval, reappear days
- `GET|POST /api/sources`, `PATCH|DELETE /api/sources/:id`, `POST /api/sources/test`
- `GET /api/library?filter=all|show|movie&limit=…` — next deck batch + pending count
- `GET /api/browse?list=kept|pending|removed&limit=…&offset=…` — decision lists with totals
- `POST /api/decisions/:itemId` (`{decision: keep|remove}`), `POST /api/decisions/:itemId/undo`,
  `POST /api/decisions/:itemId/confirm`, `POST /api/decisions/confirm-all`,
  `POST /api/decisions/reset`, `DELETE /api/decisions/:itemId`
- `GET /api/posters/:sourceId/:extId` — poster proxy with SVG fallback
- `POST /api/sync` — trigger a background sync

## Project layout

```
server/src/        Fastify app: routes, SQLite layer, sync engine, Sonarr/Radarr clients
server/src/mock/   Fixture Sonarr/Radarr servers for local dev and tests
web/src/           React 19 + Vite SPA (deck, browse, trash, settings)
tossarr.xml        Unraid container template (import via Add Container)
icon.svg/icon.png  App icon used by the template and docs
PRD.md             Product requirements
PLAN.md            Milestone plan (M0–M7)
```

## License

See [LICENSE](LICENSE).
