const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const {
  VALID_RESULTS,
  expectedRounds,
  validateTournament,
  sanitizeTournament
} = require('./lib/tournament-validation');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';
const DATA_FILE = path.join(__dirname, 'tournament-data.json');
const SEASONS_DIR = path.join(__dirname, 'seasons');
const SEASONS_INDEX = path.join(SEASONS_DIR, 'index.json');

const PASSWORDS = {
  regular: process.env.INSTERLEAGUE_EDITOR_PASSWORD || 'insterburg',
  admin: process.env.INSTERLEAGUE_ADMIN_PASSWORD || 'insteradmin'
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));

if (BASE_PATH) {
  app.use(BASE_PATH, express.static(__dirname));
} else {
  app.use(express.static(__dirname));
}

function log(event, details = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...details
  }));
}

function apiPath(suffix = '') {
  const base = BASE_PATH ? `${BASE_PATH}/api` : '/api';
  return `${base}${suffix}`;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function getAuthRole(req) {
  const password = req.headers['x-insterleague-password'] || '';
  if (password === PASSWORDS.admin) return 'admin';
  if (password === PASSWORDS.regular) return 'regular';
  return null;
}

function requireAuth(minRole = 'regular') {
  return (req, res, next) => {
    const role = getAuthRole(req);
    if (!role) {
      log('auth.rejected', { ip: getClientIp(req), path: req.path, reason: 'missing_or_invalid_password' });
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (minRole === 'admin' && role !== 'admin') {
      log('auth.rejected', { ip: getClientIp(req), path: req.path, role, reason: 'admin_required' });
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.authRole = role;
    next();
  };
}

async function ensureSeasonsDir() {
  await fs.mkdir(SEASONS_DIR, { recursive: true });
  try {
    await fs.access(SEASONS_INDEX);
  } catch {
    await fs.writeFile(SEASONS_INDEX, '[]', 'utf8');
  }
}

async function readSeasonsIndex() {
  await ensureSeasonsDir();
  try {
    const raw = await fs.readFile(SEASONS_INDEX, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeSeasonsIndex(index) {
  await ensureSeasonsDir();
  await fs.writeFile(SEASONS_INDEX, JSON.stringify(index, null, 2), 'utf8');
}

async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeData(data) {
  data.updatedAt = new Date().toISOString();
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function slugify(name) {
  return String(name || 'season')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'season';
}

app.get(apiPath('/tournament'), async (req, res) => {
  try {
    const data = await readData();
    log('tournament.read', { ip: getClientIp(req), exists: Boolean(data?.players?.length) });
    res.json(data || { exists: false });
  } catch (err) {
    log('tournament.read.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post(apiPath('/tournament'), requireAuth('admin'), async (req, res) => {
  try {
    const incoming = req.body;
    const current = await readData();
    const sanitized = sanitizeTournament(incoming);
    const validation = validateTournament(sanitized, { strictSchedule: true });

    if (!validation.valid) {
      log('tournament.save.rejected', {
        ip: getClientIp(req),
        role: req.authRole,
        errors: validation.errors,
        players: sanitized.players?.length,
        games: sanitized.games?.length
      });
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    if (current?.updatedAt && incoming.expectedUpdatedAt && incoming.expectedUpdatedAt !== current.updatedAt) {
      log('tournament.save.conflict', {
        ip: getClientIp(req),
        role: req.authRole,
        expected: incoming.expectedUpdatedAt,
        actual: current.updatedAt
      });
      return res.status(409).json({
        error: 'Data was modified elsewhere. Reload and try again.',
        updatedAt: current.updatedAt
      });
    }

    if (!incoming.newSeason && current?.players?.length >= 2 && sanitized.players.length < 2) {
      log('tournament.save.rejected', {
        ip: getClientIp(req),
        role: req.authRole,
        reason: 'would_wipe_active_season',
        currentPlayers: current.players.length,
        incomingPlayers: sanitized.players.length
      });
      return res.status(400).json({ error: 'Cannot replace an active season with an incomplete player list. Use Start New Season instead.' });
    }

    if (!incoming.newSeason && current?.games?.length >= 2 && sanitized.players.length >= 2 && sanitized.games.length === 0) {
      return res.status(400).json({ error: 'Cannot remove all games from an active season without archiving first.' });
    }

    const saved = await writeData(sanitized);
    log('tournament.save.full', {
      ip: getClientIp(req),
      role: req.authRole,
      players: saved.players.length,
      games: saved.games.length,
      currentRound: saved.currentRound,
      seasonName: saved.seasonName
    });
    res.json({ success: true, updatedAt: saved.updatedAt });
  } catch (err) {
    log('tournament.save.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.patch(apiPath('/tournament/games/:gameId'), requireAuth('regular'), async (req, res) => {
  try {
    const { gameId } = req.params;
    const { result, expectedUpdatedAt } = req.body || {};
    const current = await readData();

    if (!current?.games?.length) {
      return res.status(404).json({ error: 'No tournament data' });
    }

    if (expectedUpdatedAt && expectedUpdatedAt !== current.updatedAt) {
      log('tournament.patch.conflict', {
        ip: getClientIp(req),
        role: req.authRole,
        gameId,
        expected: expectedUpdatedAt,
        actual: current.updatedAt
      });
      return res.status(409).json({
        error: 'Data was modified elsewhere. Reload and try again.',
        updatedAt: current.updatedAt
      });
    }

    if (!VALID_RESULTS.has(result ?? '')) {
      return res.status(400).json({ error: 'Invalid result value' });
    }

    const gameIndex = current.games.findIndex(g => g.id === gameId);
    if (gameIndex === -1) {
      log('tournament.patch.not_found', { ip: getClientIp(req), gameId });
      return res.status(404).json({ error: 'Game not found' });
    }

    const game = current.games[gameIndex];
    const playerSet = new Set(current.players);

    if (!playerSet.has(game.white) || !playerSet.has(game.black)) {
      log('tournament.patch.invalid_players', { ip: getClientIp(req), gameId, white: game.white, black: game.black });
      return res.status(400).json({ error: 'Game references unknown players' });
    }

    const maxRound = expectedRounds(current.players.length, current.formatType);
    if (game.round > maxRound) {
      log('tournament.patch.invalid_round', { ip: getClientIp(req), gameId, round: game.round, maxRound });
      return res.status(400).json({ error: 'Game is outside valid schedule' });
    }

    if (req.authRole === 'regular') {
      if (game.round > current.currentRound) {
        return res.status(403).json({ error: 'Cannot edit future round games' });
      }
      if (game.result && game.result !== result) {
        return res.status(403).json({ error: 'Cannot change an existing result' });
      }
    }

    const previousResult = game.result;
    current.games[gameIndex] = { ...game, result: result ?? '' };
    const validation = validateTournament(current, { strictSchedule: true });

    if (!validation.valid) {
      log('tournament.patch.rejected', { ip: getClientIp(req), gameId, errors: validation.errors });
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    const saved = await writeData(current);
    log('tournament.patch.result', {
      ip: getClientIp(req),
      role: req.authRole,
      gameId,
      round: game.round,
      white: game.white,
      black: game.black,
      previousResult: previousResult || null,
      newResult: result || null
    });
    res.json({ success: true, updatedAt: saved.updatedAt, game: saved.games[gameIndex] });
  } catch (err) {
    log('tournament.patch.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.patch(apiPath('/tournament/current-round'), requireAuth('admin'), async (req, res) => {
  try {
    const { currentRound, expectedUpdatedAt } = req.body || {};
    const current = await readData();
    if (!current?.games?.length) {
      return res.status(404).json({ error: 'No tournament data' });
    }

    if (expectedUpdatedAt && expectedUpdatedAt !== current.updatedAt) {
      return res.status(409).json({ error: 'Data was modified elsewhere. Reload and try again.', updatedAt: current.updatedAt });
    }

    const maxRound = expectedRounds(current.players.length, current.formatType);
    const round = Number(currentRound);
    if (!Number.isInteger(round) || round < 1 || round > maxRound) {
      return res.status(400).json({ error: `currentRound must be between 1 and ${maxRound}` });
    }

    current.currentRound = round;
    const saved = await writeData(current);
    log('tournament.patch.current_round', { ip: getClientIp(req), currentRound: round });
    res.json({ success: true, updatedAt: saved.updatedAt, currentRound: round });
  } catch (err) {
    log('tournament.patch.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get(apiPath('/seasons'), async (req, res) => {
  try {
    const index = await readSeasonsIndex();
    log('seasons.list', { ip: getClientIp(req), count: index.length });
    res.json(index);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(apiPath('/seasons/:id'), async (req, res) => {
  try {
    const index = await readSeasonsIndex();
    const entry = index.find(s => s.id === req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Season not found' });
    }
    const filePath = path.join(SEASONS_DIR, entry.file);
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw);
    log('seasons.read', { ip: getClientIp(req), seasonId: entry.id, seasonName: entry.seasonName });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(apiPath('/seasons/archive'), requireAuth('admin'), async (req, res) => {
  try {
    const current = await readData();
    if (!current?.players?.length || !current?.games?.length) {
      return res.status(400).json({ error: 'No active season to archive' });
    }

    const validation = validateTournament(current, { strictSchedule: false });
    if (!validation.valid) {
      return res.status(400).json({ error: 'Cannot archive invalid season', details: validation.errors });
    }

    await ensureSeasonsDir();
    const index = await readSeasonsIndex();
    const seasonName = current.seasonName || current.tournamentName || 'Archived Season';
    let id = slugify(seasonName);
    if (index.some(s => s.id === id)) {
      id = `${id}-${Date.now()}`;
    }

    const archiveData = {
      ...current,
      archivedAt: new Date().toISOString()
    };
    const fileName = `${id}.json`;
    await fs.writeFile(path.join(SEASONS_DIR, fileName), JSON.stringify(archiveData, null, 2), 'utf8');

    index.unshift({
      id,
      seasonName,
      tournamentName: current.tournamentName,
      archivedAt: archiveData.archivedAt,
      file: fileName,
      players: current.players.length,
      formatType: current.formatType
    });
    await writeSeasonsIndex(index);

    log('seasons.archive', { ip: getClientIp(req), seasonId: id, seasonName, players: current.players.length });

    res.json({ success: true, archivedSeason: index[0] });
  } catch (err) {
    log('seasons.archive.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post(apiPath('/seasons/import'), requireAuth('admin'), async (req, res) => {
  try {
    const incoming = req.body;
    if (!incoming?.players || !incoming?.games) {
      return res.status(400).json({ error: 'Invalid season file' });
    }

    await ensureSeasonsDir();
    const index = await readSeasonsIndex();
    const seasonName = incoming.seasonName || incoming.tournamentName || 'Imported Season';
    let id = slugify(seasonName);
    if (index.some(s => s.id === id)) {
      id = `${id}-${Date.now()}`;
    }

    const archiveData = {
      ...sanitizeTournament(incoming),
      archivedAt: incoming.archivedAt || new Date().toISOString()
    };
    const fileName = `${id}.json`;
    await fs.writeFile(path.join(SEASONS_DIR, fileName), JSON.stringify(archiveData, null, 2), 'utf8');

    index.unshift({
      id,
      seasonName: archiveData.seasonName,
      tournamentName: archiveData.tournamentName,
      archivedAt: archiveData.archivedAt,
      file: fileName,
      players: archiveData.players.length,
      formatType: archiveData.formatType
    });
    await writeSeasonsIndex(index);

    log('seasons.import', { ip: getClientIp(req), seasonId: id, seasonName });
    res.json({ success: true, archivedSeason: index[0] });
  } catch (err) {
    log('seasons.import.error', { ip: getClientIp(req), error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  log('server.start', { port: PORT, basePath: BASE_PATH || '/' });
  console.log(`Insterleague server running on port ${PORT}${BASE_PATH ? ` with base path: ${BASE_PATH}` : ''}`);
});
