# BLUE — Music to Connect

A quiet, single-screen Hindi music web player powered by YouTube's IFrame API with real-time anonymous per-song reflections streamed over Server-Sent Events (SSE) and persisted in SQLite.

---

## Features

- **Curated Hindi Playlist**: 100 hand-picked tracks with automatic shuffle queue and session persistence.
- **Minimalist Dark Aesthetic**: Glassmorphic UI with floating playback controls and subtle progress indicator.
- **Anonymous Reflections Wall**: Real-time per-song chat synced via SSE with color-hashed usernames and server-signed identity cookies.
- **Two-Stage Navigation**: 1st previous press restarts the song; consecutive press traverses session history.
- **Media Session API**: Full native lock screen / media key controls support with track artwork.
- **Secure & Robust Backend**: SQLite (`better-sqlite3`), rate-limiting, keepalive pinging, HTTP security headers (`helmet`), and gzip compression (`compression`).

---

## Setup & Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

3. **Start the server**:
   ```bash
   npm start
   ```
   Or run with file watching:
   ```bash
   npm run dev
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | The HTTP port the Express server listens on. | `3000` |
| `ADMIN_TOKEN` | Bearer token required for administrative endpoints (e.g. comment deletion). | `changeme` |
| `COOKIE_SECRET` | Secret key used to sign client author identity cookies. | `changeme` |

---

## API Routes

### User & Identity
- `GET /api/me`: Returns the anonymous pseudonym derived from the signed cookie (`{ author: string }`).

### Reflections & Comments
- `GET /api/comments/:videoId`: Retrieves all non-flagged reflections for the specified track.
- `POST /api/comments/:videoId`: Posts a new reflection for the specified track (author derived server-side).
- `GET /api/comments/:videoId/stream`: Server-Sent Events stream for real-time reflection updates with 20s keepalive ping.
- `POST /api/comments/:videoId/:id/flag`: Flags a reflection as inappropriate (`flagged = 1`).
- `DELETE /api/comments/:videoId/:id`: Deletes a reflection (requires `Authorization: Bearer <ADMIN_TOKEN>`).

### Health & System
- `GET /api/health`: Healthcheck endpoint reporting status and server timestamp.
