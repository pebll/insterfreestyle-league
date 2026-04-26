# Insterfreestyle League

Local tournament management system with password-protected editing.

## Features

- **Public viewing**: Anyone can see standings and schedules
- **Password-protected editing**:
  - Regular users (`insterburg`): Edit current round scores only
  - Admin (`insteradmin`): Full control - create tournaments, edit any scores
- **Local storage**: All data stored in local JSON file on your server
- **Auto-save**: Changes persist automatically

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

## Docker Deployment

### Option 1: Simple Dockerfile

Create a `Dockerfile`:

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
docker run -d -p 3000:3000 -v $(pwd)/tournament-data.json:/app/tournament-data.json --name insterleague insterleague
```

### Option 2: Docker Compose

Create a `docker-compose.yml`:

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
    environment:
      - NODE_ENV=production
```

Run:
```bash
docker-compose up -d
```

### Option 3: With Caddy Reverse Proxy

If you already have Caddy running, add this to your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  insterleague:
    build: .
    container_name: insterleague
    restart: unless-stopped
    volumes:
      - ./tournament-data.json:/app/tournament-data.json
    environment:
      - NODE_ENV=production
    networks:
      - caddy

networks:
  caddy:
    external: true
```

Then add this to your Caddyfile:
```caddy
insterleague.yourdomain.com {
    reverse_proxy insterleague:3000
    encode gzip
}
```

Reload Caddy:
```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Passwords

- **View only**: No password needed (public)
- **Edit scores** (current round): `insterburg`
- **Admin** (full control): `insteradmin`

Change these in `index.html` lines with `PASSWORDS` object.

## Data Storage

All tournament data is stored in `tournament-data.json`. Make sure to:
- Keep this file backed up
- Mount it as a volume in Docker to persist data across container restarts
