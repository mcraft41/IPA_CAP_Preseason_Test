/**
 * Cap Room backend — now doing double duty.
 *
 * PART 1 — STATS/ROSTER RELAY (original purpose)
 * The Claude.ai artifact version of the league lives in a browser (window.storage) with
 * no outside door for a script to write through. The companion script pushes weekly
 * stats and roster pulls here; the Commissioner tab in that artifact checks here.
 *
 * PART 2 — STANDALONE LEAGUE HOSTING (for people without Claude access)
 * This server ALSO serves the full league app as a plain web page (public/league.html)
 * and stores ALL of its data (settings, players, lineups, scores) here as simple
 * key/value pairs. Deploy this once, share the resulting URL with anyone — no Claude
 * account, no artifact link, no download required. They just open the URL like any
 * other website.
 *
 * RUN LOCALLY
 *   npm install
 *   SYNC_API_KEY=pick-a-secret node server.js
 *   Then open http://localhost:3000 in a browser.
 *
 * DEPLOY FOR FREE (Render.com example — see README.md for step-by-step)
 *   Build command: npm install
 *   Start command: node server.js
 *   Environment variable: SYNC_API_KEY = pick-a-secret
 *   Share the resulting https://your-app.onrender.com URL with your league.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SYNC_API_KEY || 'change-me';
const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.kv = db.kv || {};
    return db;
  }
  catch (e) { return { stats: {}, rosters: {}, kv: {} }; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': (MIME[ext] || 'application/octet-stream') });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + filePath);
  }
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function requireApiKey(req, res) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    sendJSON(res, 401, { error: 'Missing or incorrect X-Api-Key header.' });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','stats','latest']

  if (req.method === 'OPTIONS') { sendJSON(res, 204, {}); return; }

  if (url.pathname === '/health') { sendJSON(res, 200, { ok: true }); return; }

  // ---- Standalone league app: serve the page and its data ----
  // GET / or /league.html — the actual app, servable to anyone with the URL, no Claude needed.
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/league.html')) {
    serveStatic(res, path.join(__dirname, 'public', 'league.html'));
    return;
  }

  // GET /api/kv/:key — read one piece of league data (settings, players, a week's lineups, etc.)
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'kv' && parts.length === 3) {
    const key = decodeURIComponent(parts[2]);
    const db = loadDB();
    if (!(key in db.kv)) { sendJSON(res, 200, { found: false }); return; }
    sendJSON(res, 200, { found: true, value: db.kv[key] });
    return;
  }

  // POST /api/kv/:key  { value }  — write one piece of league data. Open to anyone with the
  // URL, same as the Claude-artifact version's "shared" storage — there's no login system,
  // so anyone who can reach this server can submit a lineup or (in principle) write other
  // keys too. That matches the original app's trust model; it's not meant to hold anything
  // sensitive.
  if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'kv' && parts.length === 3) {
    const key = decodeURIComponent(parts[2]);
    try {
      const body = await readBody(req);
      if (!('value' in body)) { sendJSON(res, 400, { error: 'Expected { value: ... }.' }); return; }
      const db = loadDB();
      db.kv[key] = body.value;
      saveDB(db);
      sendJSON(res, 200, { ok: true });
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON body: ' + e.message });
    }
    return;
  }

  // ---- POST /api/stats  { season, week, data }  (requires X-Api-Key) ----
  if (req.method === 'POST' && url.pathname === '/api/stats') {
    if (!requireApiKey(req, res)) return;
    try {
      const body = await readBody(req);
      const { season, week, data } = body;
      if (!season || !week || !data) { sendJSON(res, 400, { error: 'Expected { season, week, data }.' }); return; }
      const db = loadDB();
      db.stats[String(season)] = db.stats[String(season)] || {};
      db.stats[String(season)][String(week)] = { data, syncedAt: new Date().toISOString() };
      saveDB(db);
      sendJSON(res, 200, { ok: true, season, week, playerCount: Object.keys(data).length });
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON body: ' + e.message });
    }
    return;
  }

  // ---- GET /api/stats/latest?season=2026 ----
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'stats' && parts[2] === 'latest') {
    const season = url.searchParams.get('season');
    const db = loadDB();
    const seasonStats = db.stats[String(season)] || {};
    const weeks = Object.keys(seasonStats).map(Number).sort((a, b) => b - a);
    if (!weeks.length) { sendJSON(res, 200, { found: false }); return; }
    const latestWeek = weeks[0];
    sendJSON(res, 200, { found: true, season: Number(season), week: latestWeek, ...seasonStats[latestWeek] });
    return;
  }

  // ---- GET /api/stats/:season/:week ----
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'stats' && parts.length === 4) {
    const [, , season, week] = parts;
    const db = loadDB();
    const entry = db.stats[season] && db.stats[season][week];
    if (!entry) { sendJSON(res, 200, { found: false }); return; }
    sendJSON(res, 200, { found: true, season: Number(season), week: Number(week), ...entry });
    return;
  }

  // ---- POST /api/roster  { season, players }  (requires X-Api-Key) ----
  if (req.method === 'POST' && url.pathname === '/api/roster') {
    if (!requireApiKey(req, res)) return;
    try {
      const body = await readBody(req);
      const { season, players } = body;
      if (!season || !Array.isArray(players)) { sendJSON(res, 400, { error: 'Expected { season, players: [...] }.' }); return; }
      const db = loadDB();
      db.rosters[String(season)] = { players, syncedAt: new Date().toISOString() };
      saveDB(db);
      sendJSON(res, 200, { ok: true, season, playerCount: players.length });
    } catch (e) {
      sendJSON(res, 400, { error: 'Invalid JSON body: ' + e.message });
    }
    return;
  }

  // ---- GET /api/roster/latest?season=2026 ----
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'roster' && parts[2] === 'latest') {
    const season = url.searchParams.get('season');
    const db = loadDB();
    const entry = db.rosters[String(season)];
    if (!entry) { sendJSON(res, 200, { found: false }); return; }
    sendJSON(res, 200, { found: true, season: Number(season), ...entry });
    return;
  }

  sendJSON(res, 404, { error: 'Not found. See README.md for available endpoints.' });
});

server.listen(PORT, () => {
  console.log(`Cap Room sync backend listening on port ${PORT}`);
  if (API_KEY === 'change-me') {
    console.warn('WARNING: SYNC_API_KEY is not set — using the insecure default. Set it before going live.');
  }
});
