// Escoba de 15 online: a tiny game server with no dependencies.
// Run with:  node server.js   (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('./public/rules.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 6;
const IDLE_MS = 12 * 60 * 60 * 1000; // tables vanish after 12 idle hours

const games = new Map();   // code -> state
const streams = new Map(); // code -> Set of {res, pid}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    if (!games.has(c)) return c;
  }
}
const cleanName = n => String(n || '').trim().slice(0, 20);
const cleanId = p => /^[a-z0-9]{6,40}$/i.test(String(p || '')) ? String(p) : null;

// What one player is allowed to see: their own hand, but only card counts for everyone else.
function viewFor(s, pid) {
  const v = { ...s, deck: undefined, deckCount: (s.deck || []).length, hands: {} };
  if (s.opts && !s.opts.history) v.log = [];
  // Keep secrets off the wire: taken piles and whether the last capture really made 15.
  v.captures = undefined;
  if (s.lastCapture) v.lastCapture = { by: s.lastCapture.by };
  for (const p of s.order || []) {
    const h = (s.hands && s.hands[p]) || [];
    v.hands[p] = p === pid ? h : h.map(() => 'x');
  }
  return v;
}

function broadcast(code) {
  const s = games.get(code);
  const set = streams.get(code);
  if (!set) return;
  for (const c of set) {
    const payload = s ? viewFor(s, c.pid) : { gone: true };
    c.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function apply(s, pid, a) {
  const seated = !!(s.players && s.players[pid]);
  switch (a.type) {
    case 'join': {
      if (s.status !== 'lobby') return 'This game already started.';
      const name = cleanName(a.name); if (!name) return 'Type your name first.';
      if (!seated && Object.keys(s.players).length >= MAX_PLAYERS) return `This table is full (${MAX_PLAYERS} players).`;
      s.players[pid] = { name, joinedAt: seated ? s.players[pid].joinedAt : Date.now() };
      return null;
    }
    case 'unseat': {
      if (s.status !== 'lobby') return 'The game already started.';
      delete s.players[pid];
      if (s.host === pid) { const next = Object.entries(s.players).sort((x, y) => x[1].joinedAt - y[1].joinedAt)[0]; s.host = next ? next[0] : null; }
      return null;
    }
    case 'start': {
      if (s.host !== pid) return 'Only the host can deal.';
      if (s.status !== 'lobby') return 'Already dealt.';
      s.order = Object.entries(s.players).sort((x, y) => x[1].joinedAt - y[1].joinedAt).map(x => x[0]).slice(0, MAX_PLAYERS);
      if (s.order.length < 2) return 'Needs at least 2 players.';
      s.scores = {}; s.order.forEach(p => (s.scores[p] = 0));
      s.dealerIdx = s.order.length - 1; s.round = 0; s.log = [];
      E.newRound(s); return null;
    }
    case 'challenge': return E.challenge(s, pid);
    case 'count': return E.countCards(s, pid);
    case 'steal': {
      const take = Array.isArray(a.take) ? a.take.map(String) : [];
      return E.steal(s, pid, take);
    }
    case 'play': {
      const take = Array.isArray(a.take) ? a.take.map(String) : [];
      return E.play(s, pid, String(a.card || ''), take);
    }
    case 'next': {
      if (!s.order.includes(pid)) return 'Only players can deal.';
      if (s.status !== 'roundover') return 'Not yet.';
      s.dealerIdx = (s.dealerIdx + 1) % s.order.length; E.newRound(s); return null;
    }
    case 'rematch': {
      if (!s.order.includes(pid)) return 'Only players can start a rematch.';
      if (s.status !== 'gameover') return 'Not yet.';
      s.order.forEach(p => (s.scores[p] = 0)); s.round = 0; s.winner = null;
      s.dealerIdx = (s.dealerIdx + 1) % s.order.length; s.log = []; E.newRound(s); return null;
    }
    case 'close': {
      if (s.host !== pid) return 'Only the host can close the table.';
      return 'CLOSE';
    }
  }
  return 'Unknown action.';
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/api/lobby') {
    const list = [...games.values()].filter(g => g.status === 'lobby')
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)
      .map(g => ({ code: g.code, target: g.target, opts: g.opts, names: Object.values(g.players).map(p => p.name) }));
    return json(res, 200, list);
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    const pid = cleanId(url.searchParams.get('pid'));
    if (!games.has(code)) return json(res, 404, { error: `No table with code ${code}.` });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const client = { res, pid };
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(client);
    res.write(`data: ${JSON.stringify(viewFor(games.get(code), pid))}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); streams.get(code)?.delete(client); });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/create') {
    const b = await readBody(req);
    const pid = cleanId(b.pid), name = cleanName(b.name);
    if (!pid || !name) return json(res, 400, { error: 'Type your name first.' });
    const code = newCode(), now = Date.now();
    const target = [15, 21, 31].includes(+b.target) ? +b.target : 15;
    const opts = { history: !!b.history, hints: !!b.hints };
    games.set(code, { code, host: pid, status: 'lobby', target, opts, createdAt: now, updatedAt: now, players: { [pid]: { name, joinedAt: now } }, rev: 0 });
    return json(res, 200, { code });
  }

  if (req.method === 'POST' && url.pathname === '/api/action') {
    const b = await readBody(req);
    const code = String(b.code || '').toUpperCase(), pid = cleanId(b.pid);
    const s = games.get(code);
    if (!s) return json(res, 404, { error: 'This table no longer exists.' });
    if (!pid) return json(res, 400, { error: 'Reload the page and try again.' });
    const err = apply(s, pid, b);
    if (err === 'CLOSE') { games.delete(code); broadcast(code); streams.delete(code); return json(res, 200, { ok: true }); }
    if (err) return json(res, 400, { error: err });
    s.rev = (s.rev || 0) + 1; s.updatedAt = Date.now();
    if (s.last && !s.last.rev) s.last.rev = s.rev;
    broadcast(code);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET') {
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(PUBLIC, path.normalize(file));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return fs.readFile(full, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(405); res.end();
});

setInterval(() => {
  const now = Date.now();
  for (const [c, g] of games) if (now - g.updatedAt > IDLE_MS) { games.delete(c); broadcast(c); streams.delete(c); }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Escoba server running on http://localhost:${PORT}`));
