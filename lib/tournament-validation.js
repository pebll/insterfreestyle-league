const VALID_RESULTS = new Set(['', '1-0', '0-1', '0.5-0.5']);

function expectedRounds(playerCount, formatType) {
  if (playerCount < 2) return 0;
  const base = playerCount % 2 === 0 ? playerCount - 1 : playerCount;
  return formatType === 'double' ? base * 2 : base;
}

function expectedGamesPerRound(playerCount) {
  return Math.floor(playerCount / 2);
}

function expectedGameCount(playerCount, formatType) {
  return expectedRounds(playerCount, formatType) * expectedGamesPerRound(playerCount);
}

function validateTournament(data, { strictSchedule = true } = {}) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Tournament data must be an object'], warnings };
  }

  const players = Array.isArray(data.players) ? data.players.map(p => String(p).trim()).filter(Boolean) : [];
  const games = Array.isArray(data.games) ? data.games : [];
  const formatType = data.formatType === 'single' ? 'single' : 'double';
  const currentRound = Number(data.currentRound) || 1;

  if (players.length < 2) {
    if (strictSchedule && games.length > 0) {
      errors.push('At least 2 players are required when games exist');
    }
    return { valid: errors.length === 0, errors, warnings, meta: { players: players.length, games: games.length, maxRound: 0 } };
  }

  const lowerNames = players.map(p => p.toLowerCase());
  if (new Set(lowerNames).size !== lowerNames.length) {
    errors.push('Player names must be unique');
  }

  const playerSet = new Set(players);
  const ids = new Set();

  for (const game of games) {
    if (!game || typeof game !== 'object') {
      errors.push('Invalid game entry');
      continue;
    }

    if (!game.id) {
      errors.push('Game missing id');
    } else if (ids.has(game.id)) {
      errors.push(`Duplicate game id: ${game.id}`);
    } else {
      ids.add(game.id);
    }

    if (!playerSet.has(game.white)) {
      errors.push(`Unknown white player in game ${game.id}: "${game.white}"`);
    }
    if (!playerSet.has(game.black)) {
      errors.push(`Unknown black player in game ${game.id}: "${game.black}"`);
    }
    if (game.byePlayer && !playerSet.has(game.byePlayer)) {
      errors.push(`Unknown bye player in game ${game.id}: "${game.byePlayer}"`);
    }
    if (!VALID_RESULTS.has(game.result ?? '')) {
      errors.push(`Invalid result in game ${game.id}: "${game.result}"`);
    }
  }

  if (strictSchedule && players.length >= 2) {
    const maxRound = expectedRounds(players.length, formatType);
    const expectedCount = expectedGameCount(players.length, formatType);

    if (games.length !== expectedCount) {
      errors.push(`Expected ${expectedCount} games for ${players.length} players (${formatType}), got ${games.length}`);
    }

    const roundCounts = {};
    for (const game of games) {
      const round = Number(game.round);
      if (!Number.isInteger(round) || round < 1 || round > maxRound) {
        errors.push(`Game ${game.id} has invalid round ${game.round} (max ${maxRound})`);
      }
      roundCounts[round] = (roundCounts[round] || 0) + 1;
    }

    const perRound = expectedGamesPerRound(players.length);
    for (let r = 1; r <= maxRound; r += 1) {
      if ((roundCounts[r] || 0) !== perRound) {
        errors.push(`Round ${r} has ${roundCounts[r] || 0} games, expected ${perRound}`);
      }
    }

    if (currentRound < 1 || currentRound > maxRound) {
      errors.push(`currentRound ${currentRound} out of range (1-${maxRound})`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, meta: { players: players.length, games: games.length, maxRound: expectedRounds(players.length, formatType) } };
}

function sanitizeTournament(data) {
  const players = Array.isArray(data.players) ? data.players.map(p => String(p).trim()).filter(Boolean) : [];
  const playerSet = new Set(players);
  const formatType = data.formatType === 'single' ? 'single' : 'double';
  const maxRound = expectedRounds(players.length, formatType);

  const games = (Array.isArray(data.games) ? data.games : [])
    .filter(g => g && playerSet.has(g.white) && playerSet.has(g.black))
    .filter(g => {
      const round = Number(g.round);
      return Number.isInteger(round) && round >= 1 && round <= maxRound;
    })
    .map(g => ({
      id: g.id,
      round: Number(g.round),
      board: Number(g.board),
      white: g.white,
      black: g.black,
      result: VALID_RESULTS.has(g.result ?? '') ? (g.result ?? '') : '',
      byePlayer: g.byePlayer && playerSet.has(g.byePlayer) ? g.byePlayer : null
    }));

  return {
    tournamentName: String(data.tournamentName || 'Insterfreestyle League').trim(),
    seasonName: String(data.seasonName || data.tournamentName || 'Season 1').trim(),
    formatType,
    players,
    games,
    currentRound: Math.min(Math.max(Number(data.currentRound) || 1, 1), maxRound || 1),
    updatedAt: data.updatedAt || new Date().toISOString()
  };
}

module.exports = {
  VALID_RESULTS,
  expectedRounds,
  expectedGamesPerRound,
  expectedGameCount,
  validateTournament,
  sanitizeTournament
};
