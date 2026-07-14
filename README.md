# Insterfreestyle League

Local tournament management system with password-protected editing.

## Features

- **Public viewing**: Anyone can see standings and schedules
- **Password-protected editing**:
  - Regular users (`insterburg`): Patch individual game results only (no full overwrite)
  - Admin (`insteradmin`): Full control — create tournaments, manage rounds, seasons, export/import
- **Season management**: Name seasons, archive finished seasons, browse past seasons read-only
- **Server-side validation**: Rejects unknown players, invalid schedules, and accidental full wipes
- **Structured logs**: JSON logs to stdout for Docker (`docker logs insterleague`)
- **Export/Import**: Backup and restore tournament data as JSON files
- **Auto-save**: Score changes persist via authenticated patch requests

## Running Locally (Development)

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

3. Open browser to `http://localhost:3000`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `BASE_PATH` | `` | URL prefix (e.g. `/insterleague`) |
| `INSTERLEAGUE_ADMIN_PASSWORD` | `insteradmin` | Admin password (server-enforced) |
| `INSTERLEAGUE_EDITOR_PASSWORD` | `insterburg` | Editor password (server-enforced) |

**Important:** Set strong passwords in production via environment variables. The UI still prompts for these passwords, but the server now validates them on every write.

## Docker Deployment

### Option 1: Simple Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t insterleague .
docker run -d -p 3000:3000 \
  -v $(pwd)/tournament-data.json:/app/tournament-data.json \
  -v $(pwd)/seasons:/app/seasons \
  -e INSTERLEAGUE_ADMIN_PASSWORD=your-secure-admin-password \
  -e INSTERLEAGUE_EDITOR_PASSWORD=your-secure-editor-password \
  --name insterleague insterleague
```

### Option 2: Docker Compose

```yaml
version: '3.8'

services:
  insterleague:
    build: .
    container_name: insterleague
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./tournament-data.json:/app/tournament-data.json
      - ./seasons:/app/seasons
    environment:
      - NODE_ENV=production
      - INSTERLEAGUE_ADMIN_PASSWORD=your-secure-admin-password
      - INSTERLEAGUE_EDITOR_PASSWORD=your-secure-editor-password
```

Run:
```bash
docker-compose up -d
```

## Passwords

- **View only**: No password needed (public)
- **Edit scores** (unfilled from current & past rounds): editor password
- **Admin** (full control + seasons + export/import): admin password

Change defaults via `INSTERLEAGUE_ADMIN_PASSWORD` and `INSTERLEAGUE_EDITOR_PASSWORD` environment variables.

## Data Storage

- **Active season**: `tournament-data.json`
- **Past seasons**: `seasons/*.json` with index in `seasons/index.json`

Mount both paths as Docker volumes to persist data across restarts.

### Admin season workflow

1. Set **Season Name** (e.g. "Season 1") in admin panel
2. **Archive Season** — saves a read-only copy to past seasons (current season stays active)
3. **Start New Season** — archives current season, then clears for a new one
4. **Import Past Season** — add an old JSON export to the archive library (read-only browsing)

Everyone can switch between **Current Season** and archived seasons via the dropdown in the header. Archived seasons are view-only.

## API (writes require password header)

Send `X-Insterleague-Password: <password>` on all write requests.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/tournament` | public | Load active season |
| POST | `/api/tournament` | admin | Full replace (validated) |
| PATCH | `/api/tournament/games/:id` | editor/admin | Update one result |
| PATCH | `/api/tournament/current-round` | admin | Change current round |
| GET | `/api/seasons` | public | List archived seasons |
| GET | `/api/seasons/:id` | public | Load archived season |
| POST | `/api/seasons/archive` | admin | Archive current season |
| POST | `/api/seasons/import` | admin | Import JSON into archive |

## Docker Logs

All significant events are logged as JSON lines to stdout:

```bash
docker logs -f insterleague
docker logs insterleague 2>&1 | grep tournament.patch
docker logs insterleague 2>&1 | grep rejected
```

Example events:
- `tournament.save.full` — admin saved full state
- `tournament.patch.result` — score changed (includes game id, players, old/new result, IP)
- `tournament.save.rejected` / `tournament.patch.rejected` — validation blocked bad data
- `tournament.save.conflict` — stale tab tried to overwrite newer data
- `auth.rejected` — unauthenticated or wrong password
- `seasons.archive` / `seasons.import` — season library changes

## Fixing corrupted data

If bad games appear (e.g. unknown player names), use **Export Data**, remove invalid entries, and **Import Data** as admin. The server now rejects saves where game players aren't on the roster.

The cleaned Season 1 export in this repo (`tournament-Insterfreestyle-League---Season-1-2026-07-14.json`) has 45 valid games after removing ghost entries.
