# Swiparr — Product Requirements Document

**Status:** Draft v1 · **Date:** 2026-10-27 · **Owner:** tucker

## 1. Overview

Swiparr is a Dockerized web app for Unraid that turns your Sonarr and Radarr libraries — any number of instances of each — into a Tinder-style swipe deck. It pulls random shows and movies you already own, presents them as poster cards, and lets you swipe right to **keep** or left to send an item to a **pending-removal list**. It's a lightweight curation tool for discovering what's in your library and trimming down what you actually want to watch.

## 2. Goals

- **G1 — Fast setup:** Point it at Sonarr and Radarr with API keys; first swipe within ~2 minutes of starting the container.
- **G2 — Fun, fast swipe UX:** Fluid drag with rotation on phone, tablet, and desktop (touch, mouse, and keyboard).
- **G3 — Safe by default:** Removal is two-stage. Left-swiping only moves an item to a pending-removal list; nothing becomes final until you explicitly confirm it there. Confirmation permanently deletes the item from Radarr/Sonarr, including media files — the only destructive operation in Swiparr, and it always requires this deliberate step.
- **G4 — One container, one volume:** Single Docker image, single `/config` volume, no external services required.

## 3. Non-Goals (v1)

- No *automatic* deletion from Sonarr/Radarr — any upstream deletion requires explicit confirmation in the pending-removal list.
- No multi-user support or authentication (assumes trusted LAN; documented).
- No integrations with Plex/Jellyfin/Overrrain/watched-state (v2 ideas).
- No recommendation engine — random is the point.

## 4. Users & Context

Single user running Unraid with Sonarr and Radarr (any number of instances). Primary use: casual browsing on a phone or tablet (bed, couch) or desktop browser. Sessions are short; the app must feel snappy from first tap.

## 5. Functional Requirements

| ID | Requirement |
|----|-------------|
| FR1 | **Setup flow.** First-run screen to add one or more media sources — each with a name, type (Sonarr or Radarr), URL, and API key. Per-source "Test connection" validates and shows item count. Sources can be added, disabled, or removed later; the deck aggregates all enabled sources. |
| FR2 | **Library sync.** On startup and every 6 hours (configurable), sync each enabled source — Sonarr via `GET /api/v3/series`, Radarr via `GET /api/v3/movie?hasFile=true` — upserting into SQLite. Sync is idempotent; items deleted upstream are pruned from that source (confirmed-removal records survive as a log). |
| FR3 | **Deck.** Random card stack of undecided items. Card shows: poster, title, year, type badge (Movie/Show), overview snippet, and light meta (episode count or size on disk). |
| FR4 | **Swipe.** Drag with rotation following pointer; release past threshold (~120px) or with sufficient velocity commits the decision — right = keep, left = move to pending removal. Card flies out; next card springs forward. On-screen ✕ / ✓ buttons mirror swipes for accessibility. Keyboard: `←`/`→` (or J/L) decide, `U`/`Backspace` undo. |
| FR4a | **Kept items reappear.** Kept items return to the deck after a configurable interval (default 30 days) so the library keeps circulating; swiping them again updates their decision. |
| FR5 | **Undo.** Undo last decision from a stack of up to 20, via button or key. |
| FR6 | **Browse screen.** Three lists with thumbnails: **Kept**, **To Remove** (pending), and **Removed** (confirmed). The To Remove list supports per-item confirm, restore, and "confirm all". Confirming permanently deletes the item from Radarr/Sonarr (metadata + files) behind a warning showing what will be deleted; the Removed list is a log of confirmed deletions — those items cannot be restored. |
| FR7 | **Caught-up state.** When there are no undecided or due-to-reappear items in the deck: show stats (kept/pending/removed counts, library size), "Resync" button, and "Reset decisions" (with confirmation). |
| FR8 | **Deck filter.** Toggle at top of deck: All / Movies / Shows. |
| FR9 | **Poster proxy.** Server proxies poster images from Sonarr/Radarr (`/api/posters/:source/:id`) to avoid CORS/mixed-content issues across Unraid ports; sets cache headers and a generated fallback image on failure. |

## 6. UX Details

- Dark theme, mobile-first layout; deck centered at max-width ~420px on desktop.
- Portrait 2:3 poster cards; two "peeking" cards stacked behind with scale/offset for depth.
- Decision badges ("KEEP ✓" / "NOPE ✕") fade in over the card as drag progresses.
- Poster load failure → gradient placeholder with title text (never a broken image).
- All swipe actions have button equivalents; elements carry ARIA labels.

## 7. Technical Requirements

- **Stack:** TypeScript throughout. Node 20 + Fastify backend serving REST API and the built frontend as static assets. React 18 + Vite frontend, no heavy UI framework (custom CSS). `better-sqlite3` for storage.
- **Container:** Multi-stage Dockerfile (build web → copy into server image), non-root user, healthcheck on `/api/health`, default port **8901** (env-overridable).
- **Config volume:** `/config` holds `settings.json` and `swiparr.db`.
- **Env vars:** `SWIPARR_PORT`, `SYNC_INTERVAL_HOURS`, `KEEP_REAPPEAR_DAYS`. Media sources are configured in the web UI (stored in `/config`) since their count is variable; env pins take precedence over saved settings where they exist.
- **Unraid packaging:** A local Docker template file (`swiparr.xml`, importable via Unraid's *Add Container → Import Docker Template*) with variables for port and sync interval (media sources are configured in the web UI after first boot), plus a README with plain `docker run` instructions. **No Community Apps submission** — the template is for local use only; publishing to CA is explicitly out of scope unless requested later.

## 8. Security & Safety

- No auth — document the trusted-LAN assumption; note reverse-proxy/TLS as user responsibility.
- API keys are never echoed back in full by any endpoint (masked after first 4 chars).
- Pending removals are reversible until confirmed; confirmed deletions permanently remove metadata + files from Radarr/Sonarr and cannot be undone in Swiparr. The UI states this explicitly at confirm time (item count + warning), and "confirm all" requires a second confirmation.

## 9. Success Criteria

1. Setup → first swipe in under 2 minutes on a typical Unraid box.
2. Swipe commit feels instant (<50ms from release to fly-out) even with a 10k+ item library (deck queries are indexed, posters lazy-loaded via proxy).
3. No accidental data loss: everything is reversible (undo/restore) up to the explicit confirm step; confirmed deletion is the only irreversible action and always requires a deliberate confirmation. Sync never destroys user decisions.
4. Runs comfortably alongside other Unraid services (<100MB RAM at idle).

## 10. Open Questions

Resolved (2026-10-27): any number of Sonarr/Radarr instances · kept items reappear after a configurable interval (default 30 days) · left-swipes go to a pending-removal list requiring explicit confirmation · confirming a removal permanently deletes the item from Radarr/Sonarr, including media files.

1. **Image registry:** local build on Unraid vs. GHCR — leaning local-first.

## 11. Future Ideas (v2+)

- Optional "add import exclusion" on confirmed deletes so re-added files aren't picked back up by Radarr/Sonarr.
- Watched-state integration (Overrrain/Plex) to skip or badge watched items.
- Genre/tag filters, search within the deck.
- PWA manifest so it can be installed on a phone home screen.
- "Weekly kept" digest of what you swiped right on.
