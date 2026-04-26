const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = process.env.BASE_PATH || '';  // Set to '/insterleague' if needed
const DATA_FILE = path.join(__dirname, 'tournament-data.json');

app.use(cors());
app.use(express.json());

// Serve static files with base path support
if (BASE_PATH) {
  app.use(BASE_PATH, express.static(__dirname));
} else {
  app.use(express.static(__dirname));
}

async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

const apiPath = BASE_PATH ? `${BASE_PATH}/api/tournament` : '/api/tournament';

app.get(apiPath, async (req, res) => {
  try {
    const data = await readData();
    res.json(data || { exists: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(apiPath, async (req, res) => {
  try {
    const data = req.body;
    data.updatedAt = new Date().toISOString();
    await writeData(data);
    res.json({ success: true, updatedAt: data.updatedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Insterleague server running on port ${PORT}${BASE_PATH ? ` with base path: ${BASE_PATH}` : ''}`);
});
